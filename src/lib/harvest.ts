/**
 * The session state machine and the harvest phase - milestone 4.
 *
 * `db` is a parameter on every function here that isn't a React hook, for the
 * same reason as room.ts: this file's write sequences (submitHarvestItem's
 * three-step contract in particular) need to run against the rules emulator
 * in harvest.test.ts, not just be asserted about in firestore.rules directly.
 *
 * **Every phase transition is an explicit host write, never a client-side
 * timer flipping it automatically.** DESIGN: "every phase needs a timeout or
 * a host override." `GameDoc.phaseEndsAt` only drives the on-screen countdown
 * (see Harvest.tsx) - nothing here or in firestore.rules compares it against
 * anything, so a client clock running fast or slow (the exact bug that broke
 * room codes on 2026-09-07) can make the number on screen wrong but can never
 * make the game do the wrong thing. The host's own tap is what moves the
 * gathering forward, every time.
 */
import {
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { HARVEST_PROMPTS, PROMPTS_PER_GATHERING } from '../content/prompts'
import { db } from './firebase'
import { errorCode, step } from './room'
import {
  paths,
  HARVEST_WINDOW_MS,
  HARVEST_EXTEND_MS,
  type GameDoc,
  type GamePhase,
  type ItemAuthorDoc,
  type ItemDoc,
  type PromptSubmissionDoc,
} from './model'

/** Picks `PROMPTS_PER_GATHERING` distinct prompt ids from the pool, without
 *  repetition within the draw. `random` is a parameter so harvest.test.ts can
 *  make the draw deterministic - the same reason room.ts's `nextCode` is. */
export function pickHarvestPromptIds(random: () => number = Math.random): string[] {
  const pool = HARVEST_PROMPTS.map((p) => p.id)
  const picked: string[] = []
  while (picked.length < PROMPTS_PER_GATHERING && pool.length > 0) {
    const index = Math.floor(random() * pool.length)
    picked.push(pool.splice(index, 1)[0])
  }
  return picked
}

/**
 * Opens the gathering's first game: creates its GameDoc and moves the
 * session from `lobby` into `playing`, pointing `currentGameId` at it.
 *
 * The game is created first, then the session is updated - there is no
 * cross-check tying them together the way roomCodes' create checks its
 * session (nothing security-relevant depends on currentGameId; see
 * BACKLOG.md, "sessions update lets the host freely rewrite roomCode/
 * groupId/currentGameId - routine"), so the order here is just "create the
 * thing being pointed at before pointing at it," not a security requirement.
 */
export async function startHarvestGame(
  firestore: Firestore,
  sessionId: string,
  promptIds: string[],
  nextId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const gameId = nextId()
  const now = Date.now()
  const game: GameDoc = {
    type: 'who-said-that',
    phase: 'harvesting',
    promptIds,
    order: 0,
    startedAt: now,
    phaseEndsAt: now + HARVEST_WINDOW_MS,
  }
  await step('create-game', () => setDoc(doc(firestore, paths.game(sessionId, gameId)), game))
  await step('start-session-game', () =>
    updateDoc(doc(firestore, paths.session(sessionId)), {
      phase: 'playing',
      currentGameId: gameId,
    }),
  )
  return gameId
}

/**
 * Submits one item to one prompt: three sequential writes, in the order
 * ITEM_WRITE_ORDER documents (src/lib/model.ts) - each one is what makes the
 * next one legal under firestore.rules.
 *
 * **A retry resumes the existing slot rather than starting over**, which the
 * first version of this function got wrong. The slot is keyed by the player's
 * uid and can never be updated (that is what blocks duplicates), so a client
 * that died after reserving it but before writing its item could never
 * submit that prompt again: every retry, however fresh its item id, was
 * denied at the first write. An independent review on 2026-09-08 found it,
 * and the milestone's own gate - a device deliberately killed mid-phase - is
 * exactly the scenario that produces it. So the slot's recorded `itemId` is
 * the id a retry continues with, and only a caller with no slot at all mints
 * a new one.
 *
 * A second submission for a prompt already answered is therefore not an
 * error: the item exists, the answer stands, and this returns having done
 * nothing. What "duplicate blocking" (MILESTONES.md) prevents is a *second
 * item*, and it is the immutable slot that prevents it.
 */
export async function submitHarvestItem(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
  promptId: string,
  uid: string,
  text: string,
  nextItemId: () => string = () => crypto.randomUUID(),
): Promise<void> {
  const existing = await step('read-submission-slot', () =>
    getMySubmission(firestore, sessionId, gameId, promptId, uid),
  )
  const itemId = existing?.itemId ?? nextItemId()
  const now = Date.now()

  if (existing) {
    const item = await step('read-existing-item', () =>
      getDoc(doc(firestore, paths.item(sessionId, itemId))),
    )
    if (item.exists()) return
  } else {
    await step('reserve-submission-slot', () =>
      setDoc(doc(firestore, paths.promptSubmission(sessionId, gameId, promptId, uid)), {
        itemId,
        submittedAt: now,
      } satisfies PromptSubmissionDoc),
    )
  }

  try {
    await step('claim-authorship', () =>
      setDoc(doc(firestore, paths.itemAuthor(sessionId, itemId)), {
        authorPlayerId: uid,
        gameId,
        promptId,
      } satisfies ItemAuthorDoc),
    )
  } catch (error) {
    // On a first attempt this is a real failure and must surface. When
    // resuming, the claim may already exist from the attempt that died - and
    // `itemAuthors` is deliberately unreadable before the reveal, so there is
    // no way to tell "already mine" from "denied". The item write below is
    // the arbiter either way: its rule refuses unless a claim naming this
    // caller exists for this exact id.
    if (!existing) throw error
    console.warn('[FlashPlay] resuming a stranded submission slot:', errorCode(error))
  }

  await step('write-item', () =>
    setDoc(doc(firestore, paths.item(sessionId, itemId)), {
      gameId,
      text,
      promptId,
      revealed: false,
      createdAt: now,
    } satisfies ItemDoc),
  )
}

/** How far this player's submission for one prompt actually got. `incomplete`
 *  means a slot was reserved but its item never landed - a device killed
 *  mid-write, the case milestone 4's gate exists to test. The UI must not
 *  read a slot alone as "submitted": that told a stranded player their answer
 *  was in when nothing of it existed. submitHarvestItem() resumes from here. */
export async function getSubmissionState(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
  promptId: string,
  uid: string,
): Promise<'none' | 'incomplete' | 'complete'> {
  const slot = await getMySubmission(firestore, sessionId, gameId, promptId, uid)
  if (!slot) return 'none'
  const item = await getDoc(doc(firestore, paths.item(sessionId, slot.itemId)))
  return item.exists() ? 'complete' : 'incomplete'
}

/** The raw slot, if this player holds one for this prompt. Most callers want
 *  getSubmissionState() instead - a slot on its own does not mean the answer
 *  was recorded. */
export async function getMySubmission(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
  promptId: string,
  uid: string,
): Promise<PromptSubmissionDoc | null> {
  const snap = await getDoc(doc(firestore, paths.promptSubmission(sessionId, gameId, promptId, uid)))
  return snap.exists() ? (snap.data() as PromptSubmissionDoc) : null
}

/** Host-only, always available regardless of the countdown or how many
 *  players have submitted - the host override DESIGN requires for every
 *  phase. `rounds` has no built screen yet (that is milestone 5); advancing
 *  to it here is the state-machine half of this milestone, not the round
 *  loop itself. */
export async function advanceGamePhase(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
  phase: GamePhase,
): Promise<void> {
  await step('advance-game-phase', () =>
    updateDoc(doc(firestore, paths.game(sessionId, gameId)), { phase }),
  )
}

/** The host's "give it another minute" button - Nitzan asked for this
 *  explicitly alongside the fixed 90s window, rather than a host-configurable
 *  duration up front. `increment()` avoids a read-modify-write race between
 *  two taps; a few hundred ms of client-clock skew on the addend is harmless
 *  for the same reason the whole timer is advisory-only (see the module
 *  comment). */
export async function extendGamePhase(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
  extraMs: number = HARVEST_EXTEND_MS,
): Promise<void> {
  await step('extend-game-phase', () =>
    updateDoc(doc(firestore, paths.game(sessionId, gameId)), { phaseEndsAt: increment(extraMs) }),
  )
}

// --- React hooks (app-only: always the real, module-level db) --------------

export interface GameState {
  game: (GameDoc & { id: string }) | null
  error: string | null
}

/** Live view of one game document. `gameId` is normally `session.currentGameId`. */
export function useGame(sessionId: string | null, gameId: string | null): GameState {
  const [state, setState] = useState<GameState>({ game: null, error: null })

  useEffect(() => {
    if (!sessionId || !gameId) {
      setState({ game: null, error: null })
      return
    }
    const unsubscribe = onSnapshot(
      doc(db, paths.game(sessionId, gameId)),
      (snap) => {
        setState({
          game: snap.exists() ? { id: snap.id, ...(snap.data() as GameDoc) } : null,
          error: null,
        })
      },
      (error) => {
        console.error('[FlashPlay] game listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [sessionId, gameId])

  return state
}

export interface HarvestProgress {
  /** Total items submitted across both prompts, by anyone. Advisory only -
   *  DESIGN never specifies a minimum, and Nitzan chose no automatic gate
   *  (2026-09-08): the host can always advance, and this number is shown
   *  next to that choice, not used to block it. */
  submittedCount: number
  error: string | null
}

/** Counts items already submitted for one game. Read from `items`
 *  (public, isPlayer-readable) rather than the submission slots, since a
 *  player may hold up to two slots (one per prompt) for one item each - the
 *  item count is what "how much material is there so far" actually means. */
export function useHarvestProgress(
  sessionId: string | null,
  gameId: string | null,
): HarvestProgress {
  const [state, setState] = useState<HarvestProgress>({ submittedCount: 0, error: null })

  useEffect(() => {
    if (!sessionId || !gameId) {
      setState({ submittedCount: 0, error: null })
      return
    }
    const itemsForGame = query(collection(db, paths.items(sessionId)), where('gameId', '==', gameId))
    const unsubscribe = onSnapshot(
      itemsForGame,
      (snap) => setState({ submittedCount: snap.size, error: null }),
      (error) => {
        console.error('[FlashPlay] harvest progress listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [sessionId, gameId])

  return state
}
