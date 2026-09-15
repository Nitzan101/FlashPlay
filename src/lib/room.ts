/**
 * Room creation, joining and presence - milestone 3.
 *
 * `db` is a parameter rather than the module-level Firestore singleton on
 * every function here that isn't a React hook, so this file's actual
 * behaviour (the room-code claim/retry contract, in particular) can run
 * against the rules emulator in room.test.ts instead of only being asserted
 * about in firestore.rules directly. The hooks at the bottom are UI-only and
 * use the app's real `db`.
 */
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from './firebase'
import {
  paths,
  ROOM_CODE_CLOCK_SKEW_MARGIN_MS,
  ROOM_CODE_WINDOW_MS,
  type PlayerDoc,
  type RoomCodeDoc,
  type SessionDoc,
} from './model'

const CODE_LENGTH = 4
const CODE_SPACE = 10 ** CODE_LENGTH
const MAX_CLAIM_ATTEMPTS = 8
const HEARTBEAT_INTERVAL_MS = 25_000

export function generateRoomCode(): string {
  const n = Math.floor(Math.random() * CODE_SPACE)
  return n.toString().padStart(CODE_LENGTH, '0')
}

/**
 * Claims a room code for `sessionId`, retrying with a fresh code whenever the
 * one picked is currently live (still owned by an unexpired reservation) or
 * lost a race to another client. A code past its `expiresAt` is fair game -
 * firestore.rules evaluates overwriting it as `update`, so this reads the
 * existing document first only to decide whether that write is worth trying,
 * not to enforce anything: the rules are what actually decide.
 */
async function claimRoomCode(
  firestore: Firestore,
  sessionId: string,
  hostUid: string,
  nextCode: () => string = generateRoomCode,
): Promise<string> {
  let lastFailure = 'none'

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const code = nextCode()
    const ref = doc(firestore, paths.roomCode(code))

    const existing = await getDoc(ref)
    if (existing.exists() && (existing.data() as RoomCodeDoc).expiresAt >= Date.now()) {
      continue // still reserved by a live gathering - try another code
    }

    const now = Date.now()
    const claim: RoomCodeDoc = {
      sessionId,
      hostUid,
      createdAt: now,
      // Deliberately short of the maximum the rule allows - see
      // ROOM_CODE_CLOCK_SKEW_MARGIN_MS. Asking for exactly the ceiling is
      // denied outright on any device whose clock runs even slightly fast.
      expiresAt: now + ROOM_CODE_WINDOW_MS - ROOM_CODE_CLOCK_SKEW_MARGIN_MS,
    }
    try {
      await setDoc(ref, claim)
      return code
    } catch (error) {
      // A lost race for this code is expected and retryable. Anything else
      // (a rule rejecting every attempt, say) looks identical from here,
      // which is why the failure is reported rather than swallowed - a
      // silent catch here is what made the first live failure of this
      // function undiagnosable from the browser console.
      lastFailure = errorCode(error)
      console.error(
        `[FlashPlay] room-code claim attempt ${attempt + 1}/${MAX_CLAIM_ATTEMPTS} for "${code}" failed:`,
        lastFailure,
        { clientNow: now, expiresAt: claim.expiresAt, windowMs: ROOM_CODE_WINDOW_MS },
        error,
      )
    }
  }
  throw new Error(`claim-room-code (${MAX_CLAIM_ATTEMPTS} attempts, last: ${lastFailure})`)
}

/** Firebase errors carry a `code` like 'permission-denied'; anything else
 *  falls back to its message. Used to make a failure reportable rather than
 *  swallowed. Guards against `error` being `null`/non-object, which a plain
 *  property read on it would throw on. Exported for harvest.ts, which needs
 *  the same reporting shape rather than a second copy of it. */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return error instanceof Error ? error.message : String(error)
}

/** Runs one named write, reporting which step failed rather than letting a
 *  bare error reach the UI with no indication of where it came from. Exported
 *  for harvest.ts, whose multi-step submission writes need the same
 *  reporting shape as this file's own. */
export async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const code = errorCode(error)
    console.error(`[FlashPlay] step "${name}" failed:`, code, error)
    throw new Error(`${name} (${code})`)
  }
}

/**
 * Opens a gathering: a fresh, unguessable session id plus a claimed room
 * code pointing at it. Requires a registered (non-anonymous) host - see
 * isRegistered() in firestore.rules.
 *
 * **The session is created before the code is claimed, not after.** An
 * independent review of the first version of this found that a `roomCodes`
 * write was never checked against the session it claims to point at - a
 * client could name any sessionId and hostUid it liked, since the rule had
 * no session document to `get()` yet. Creating the session first lets
 * firestore.rules require `get(sessions/$(sessionId)).data.hostUid ==
 * request.auth.uid` on both create and reclaim, closing that gap. The
 * tradeoff: if claiming a code then fails outright (exhausts every retry),
 * the session document is left behind with no code ever pointing at it - an
 * orphan, harmless since its id is unguessable and never referenced anywhere,
 * the same shape as the orphan-claim case ITEM_WRITE_ORDER already accepts.
 *
 * `nextCode` defaults to the real generator; room.test.ts overrides it with a
 * fixed sequence to make the claim/retry loop's behaviour deterministic
 * instead of racing the Firestore SDK's own internal use of Math.random.
 */
export async function createRoom(
  firestore: Firestore,
  hostUid: string,
  nextCode: () => string = generateRoomCode,
  /** A group the host has saved before, when this gathering is a return
   *  visit. Set here so the end of the evening adds to that group's memory
   *  rather than starting a second one (milestone 7). */
  groupId: string | null = null,
): Promise<{ sessionId: string; roomCode: string }> {
  const sessionId = crypto.randomUUID()
  const now = Date.now()

  const session: SessionDoc = {
    roomCode: '', // corrected below once a code is actually claimed
    hostUid,
    groupId,
    phase: 'lobby',
    currentGameId: null,
    scores: {},
    contactIds: {},
    createdAt: now,
    expiresAt: now + ROOM_CODE_WINDOW_MS,
  }
  await step('create-session', () =>
    setDoc(doc(firestore, paths.session(sessionId)), session),
  )

  const roomCode = await claimRoomCode(firestore, sessionId, hostUid, nextCode)

  await step('set-room-code', () =>
    updateDoc(doc(firestore, paths.session(sessionId)), { roomCode }),
  )

  return { sessionId, roomCode }
}

/**
 * Resolves a typed or shared room code to the session it currently points
 * at. Throws `'room-not-found'` if the code has never been claimed, or
 * `'room-expired'` if its reservation has passed - without this check, a
 * link opened after the window (a day-old WhatsApp scrollback, most likely)
 * would silently join whatever session the code has since been reclaimed
 * for, which could belong to a different gathering entirely.
 */
export async function resolveRoomCode(firestore: Firestore, code: string): Promise<string> {
  const snap = await getDoc(doc(firestore, paths.roomCode(code)))
  if (!snap.exists()) {
    throw new Error('room-not-found')
  }
  const claim = snap.data() as RoomCodeDoc
  if (claim.expiresAt < Date.now()) {
    throw new Error('room-expired')
  }
  return claim.sessionId
}

/** Joining is creating your own player document - this is what makes
 *  isPlayer() true and unlocks the roster (firestore.rules). `hasDevice` is
 *  always true here: joining without a phone is deferred, see BACKLOG.md. */
export async function joinRoom(
  firestore: Firestore,
  sessionId: string,
  uid: string,
  name: string,
): Promise<void> {
  const now = Date.now()
  const player: PlayerDoc = {
    name,
    uid,
    hasDevice: true,
    lastSeenAt: now,
    joinedAt: now,
    votedRoundId: null,
  }
  await setDoc(doc(firestore, paths.player(sessionId, uid)), player)
}

export async function touchPresence(
  firestore: Firestore,
  sessionId: string,
  uid: string,
): Promise<void> {
  await updateDoc(doc(firestore, paths.player(sessionId, uid)), { lastSeenAt: Date.now() })
}

// --- React hooks (app-only: always the real, module-level db) --------------

export interface RosterState {
  players: (PlayerDoc & { id: string })[]
  /** Set if the listener itself failed - e.g. this browser's player document
   *  was deleted from under it, or a genuine network/permission error. An
   *  unhandled listener error otherwise fails silently: the roster just
   *  stays empty forever with nothing on screen to say why. */
  error: string | null
}

/** Live member list, in join order. Only resolves once you have joined -
 *  isPlayer() gates read access on the roster until your own player document
 *  exists. */
export function useRoster(sessionId: string | null): RosterState {
  const [state, setState] = useState<RosterState>({ players: [], error: null })

  useEffect(() => {
    if (!sessionId) {
      setState({ players: [], error: null })
      return
    }
    const unsubscribe = onSnapshot(
      collection(db, paths.players(sessionId)),
      (snapshot) => {
        const players = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as PlayerDoc) }))
        // Firestore's default order is by document id (the uid), which
        // shuffles unpredictably as people join. joinedAt is stored for
        // exactly this - the list should only ever grow downward.
        players.sort((a, b) => a.joinedAt - b.joinedAt)
        setState({ players, error: null })
      },
      (error) => {
        console.error('[FlashPlay] roster listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [sessionId])

  return state
}

export interface SessionState {
  session: (SessionDoc & { id: string }) | null
  error: string | null
}

/**
 * Live view of the session document - milestone 4's state machine needs
 * every device in the room to see a phase change the moment the host makes
 * it, not on their next refresh. App.tsx's own getDoc calls are one-off reads
 * for the initial screen decision; this is the ongoing listener the
 * in-gathering screens are driven by.
 */
export function useSession(sessionId: string | null): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, error: null })

  useEffect(() => {
    if (!sessionId) {
      setState({ session: null, error: null })
      return
    }
    const unsubscribe = onSnapshot(
      doc(db, paths.session(sessionId)),
      (snap) => {
        setState({
          session: snap.exists() ? { id: snap.id, ...(snap.data() as SessionDoc) } : null,
          error: null,
        })
      },
      (error) => {
        console.error('[FlashPlay] session listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [sessionId])

  return state
}

/**
 * Keeps `lastSeenAt` current: on mount, on an interval, and on every return
 * to foreground. DESIGN.md: phones lock after ~30s, so this fires on every
 * round, all evening, on every device - not just on reconnect.
 */
export function usePresenceHeartbeat(sessionId: string | null, uid: string | null): void {
  useEffect(() => {
    if (!sessionId || !uid) return

    // A failed heartbeat (e.g. this player's document no longer exists) must
    // not become an unhandled rejection repeating every 25s - caught and
    // logged instead, the same reporting shape as everywhere else in this
    // file.
    const beat = () =>
      void touchPresence(db, sessionId, uid).catch((error: unknown) => {
        console.error('[FlashPlay] presence heartbeat failed:', errorCode(error), error)
      })

    beat()
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [sessionId, uid])
}
