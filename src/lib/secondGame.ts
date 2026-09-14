/**
 * "Most likely to" - the second game, milestone 6.
 *
 * It has no harvest of its own: it is built entirely out of the items the
 * first game already **revealed**. DESIGN is emphatic about why - an
 * unrevealed item makes "who is most likely to do this" exactly the same
 * question as "who wrote this", and the two games collapse into one. Once the
 * room knows David wrote it, asking who is most likely to do it is a new
 * question, and a laugh at David's expense.
 *
 * The round mechanics are milestone 5's, reused rather than re-implemented:
 * `openVoting`, `castVote` and `revealRound` in rounds.ts all work unchanged,
 * because a round is a round. Only two things differ, and they are the two
 * things here: which items are eligible, and how a round is scored.
 */
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from './firebase'
import { errorCode, step } from './room'
import {
  MAX_ROUNDS,
  POINTS_FOR_MAJORITY_VOTE,
  paths,
  type GameDoc,
  type ItemDoc,
  type RoundDoc,
} from './model'

/**
 * DESIGN: "there is no correct answer, so scoring is for voting with the
 * majority - whoever read the room correctly gets a point."
 *
 * A tie counts as a majority for everyone in it. The alternative would leave
 * the rounds the room most disagrees about - the interesting ones - as the
 * only unscored ones.
 */
export function scoreMajority(votes: Record<string, string>): Record<string, number> {
  const tally: Record<string, number> = {}
  for (const votedFor of Object.values(votes)) {
    tally[votedFor] = (tally[votedFor] ?? 0) + 1
  }
  const most = Math.max(0, ...Object.values(tally))
  if (most === 0) return {}

  const awarded: Record<string, number> = {}
  for (const [voterId, votedFor] of Object.entries(votes)) {
    if (tally[votedFor] === most) awarded[voterId] = POINTS_FOR_MAJORITY_VOTE
  }
  return awarded
}

/** Who the room picked, for the one-sentence defence DESIGN asks for. More
 *  than one name when the vote ties - the room can hear from both. */
export function mostVotedPlayers(votes: Record<string, string>): string[] {
  const tally: Record<string, number> = {}
  for (const votedFor of Object.values(votes)) {
    tally[votedFor] = (tally[votedFor] ?? 0) + 1
  }
  const most = Math.max(0, ...Object.values(tally))
  if (most === 0) return []
  return Object.keys(tally).filter((playerId) => tally[playerId] === most)
}

/** Host: opens the second game. No harvest, no prompts - it starts in its
 *  round loop, because its material already exists. */
export async function startSecondGame(
  firestore: Firestore,
  sessionId: string,
  order = 1,
  nextId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const gameId = nextId()
  const game: GameDoc = {
    type: 'most-likely-to',
    phase: 'rounds',
    promptIds: [],
    order,
    startedAt: Date.now(),
    // Never read for this game - every round is host-paced. Kept because the
    // shape is shared, and a missing field would fail the type, not the rules.
    phaseEndsAt: 0,
  }
  await step('create-second-game', () =>
    setDoc(doc(firestore, paths.game(sessionId, gameId)), game),
  )
  await step('point-session-at-second-game', () =>
    updateDoc(doc(firestore, paths.session(sessionId)), { currentGameId: gameId }),
  )
  return gameId
}

/**
 * Opens the next "most likely to" round. Eligible items are the ones the first
 * game revealed and this game has not used yet - so the pool is exactly what
 * the room has already heard, which is the whole point of the game.
 *
 * Returns null when the pool is empty or the ten-round cap is reached, the
 * same two ordinary endings as the first game.
 */
export async function openNextSecondRound(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
  nextId: (order: number) => string = (order) => `${gameId}-r${order}`,
  random: () => number = Math.random,
): Promise<string | null> {
  const [itemsSnap, roundsSnap] = await Promise.all([
    step('read-revealed-items', () =>
      getDocs(query(collection(firestore, paths.items(sessionId)), where('revealed', '==', true))),
    ),
    step('read-rounds', () =>
      getDocs(query(collection(firestore, paths.rounds(sessionId)), where('gameId', '==', gameId))),
    ),
  ])

  const played = roundsSnap.docs.filter((d) => (d.data() as RoundDoc).phase !== 'skipped')
  if (played.length >= MAX_ROUNDS) return null

  const spent = new Set(roundsSnap.docs.map((d) => (d.data() as RoundDoc).itemId))
  const available = itemsSnap.docs.filter((d) => !spent.has(d.id))
  if (available.length === 0) return null

  const item = available[Math.floor(random() * available.length)]
  const roundId = nextId(roundsSnap.size)
  await step('create-round', () =>
    setDoc(doc(firestore, paths.round(sessionId, roundId)), {
      gameId,
      itemId: item.id,
      // The room has already heard this item in the first game, so there is
      // nothing for the host to preview against - but the phase stays, since
      // it is also where the skip button lives, and a host may still want to
      // pass on an item the room has cooled on.
      phase: 'preview',
      order: roundsSnap.size,
      startedAt: Date.now(),
    } satisfies RoundDoc),
  )
  return roundId
}

/** Host: the gathering is over. This is the last write of the evening - the
 *  session's phase is monotonic, so there is no way back from it. */
export async function endGathering(firestore: Firestore, sessionId: string): Promise<void> {
  await step('end-gathering', () =>
    updateDoc(doc(firestore, paths.session(sessionId)), { phase: 'finished' }),
  )
}

export interface RevealedItemsState {
  /** Item id -> the item, for every item any game has revealed. */
  items: Record<string, ItemDoc>
  /**
   * True until the first snapshot arrives.
   *
   * This one is load-bearing rather than cosmetic: an empty pool is a real
   * state here (the first game may have revealed nothing), so without it the
   * screen cannot tell "still loading" from "no material", and the milestone-6
   * review found it telling the host the second game had nothing to play
   * while offering "end the game" as the only button.
   */
  loading: boolean
  error: string | null
}

/** Live view of every revealed item in the gathering - the second game's
 *  entire material. Unlike the first game's `useItems`, this is not scoped to
 *  one game: the items come from the game before this one. */
export function useRevealedItems(sessionId: string | null): RevealedItemsState {
  const [state, setState] = useState<RevealedItemsState>({
    items: {},
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!sessionId) {
      setState({ items: {}, loading: false, error: null })
      return
    }
    setState({ items: {}, loading: true, error: null })
    const unsubscribe = onSnapshot(
      query(collection(db, paths.items(sessionId)), where('revealed', '==', true)),
      (snap) => {
        const items: Record<string, ItemDoc> = {}
        for (const d of snap.docs) items[d.id] = d.data() as ItemDoc
        setState({ items, loading: false, error: null })
      },
      (error) => {
        console.error('[FlashPlay] revealed items listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, loading: false, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [sessionId])

  return state
}
