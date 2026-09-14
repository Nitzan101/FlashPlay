/**
 * "Who said that" - the round loop and scoring, milestone 5.
 *
 * One round is one item: the host previews it, the room votes on who wrote it,
 * the host reveals, and points land. The item's author is unreadable to
 * everyone (including the host) until that reveal - see firestore.rules,
 * `itemAuthors` - which is why scoring runs after the reveal writes rather
 * than before them. `ROUND_REVEAL_ORDER` in model.ts states the sequence and
 * why each step unlocks the next.
 *
 * As in room.ts and harvest.ts, `firestore` is a parameter rather than the
 * app singleton so rounds.test.ts can run these sequences against the rules
 * emulator instead of asserting about them from the outside.
 */
import {
  collection,
  doc,
  getDoc,
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
  POINTS_FOR_CORRECT_GUESS,
  POINTS_PER_FOOLED_VOTER,
  paths,
  type ItemAuthorDoc,
  type ItemDoc,
  type RoundDoc,
  type VoteDoc,
} from './model'

export interface RoundSummary {
  authorPlayerId: string
  /** Voter id -> who they voted for. The author's own vote is in here too, and
   *  is deliberately not scored in either direction. */
  votes: Record<string, string>
  /** Points this round awarded, by player id. */
  awarded: Record<string, number>
}

/**
 * Opens the next round: picks an item nobody has played yet and puts it in
 * front of the host alone (`preview`).
 *
 * Returns null when there is nothing left to open - either MAX_ROUNDS have
 * been used or every item has had its turn. Both are ordinary endings, not
 * errors: DESIGN caps the game at ten rounds regardless of how much material
 * the harvest collected.
 */
export async function openNextRound(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
  nextId: (order: number) => string = (order) => `${gameId}-r${order}`,
  random: () => number = Math.random,
): Promise<string | null> {
  const [itemsSnap, roundsSnap] = await Promise.all([
    step('read-items', () =>
      getDocs(query(collection(firestore, paths.items(sessionId)), where('gameId', '==', gameId))),
    ),
    step('read-rounds', () =>
      getDocs(query(collection(firestore, paths.rounds(sessionId)), where('gameId', '==', gameId))),
    ),
  ])

  // A skipped item was never played, so it does not spend one of the ten -
  // DESIGN's cap is about how long the game runs, and a skip takes seconds.
  const played = roundsSnap.docs.filter((d) => (d.data() as RoundDoc).phase !== 'skipped')
  if (played.length >= MAX_ROUNDS) return null

  const spent = new Set(roundsSnap.docs.map((d) => (d.data() as RoundDoc).itemId))
  const available = itemsSnap.docs.filter((d) => !spent.has(d.id))
  if (available.length === 0) return null

  const item = available[Math.floor(random() * available.length)]
  // Derived from the count rather than random, so that two hosts tapping at
  // once collide on one document id instead of opening two rounds: the second
  // write is then an update to an existing round, which the rules refuse
  // (a round may not restart, and its item may not change).
  const roundId = nextId(roundsSnap.size)
  await step('create-round', () =>
    setDoc(doc(firestore, paths.round(sessionId, roundId)), {
      gameId,
      itemId: item.id,
      phase: 'preview',
      order: roundsSnap.size,
      startedAt: Date.now(),
    } satisfies RoundDoc),
  )
  return roundId
}

/** Host: the room may now see the item and vote on it. */
export async function openVoting(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
): Promise<void> {
  await step('open-voting', () =>
    updateDoc(doc(firestore, paths.round(sessionId, roundId)), { phase: 'voting' }),
  )
}

/** Host: this item does not get read out. A terminal phase rather than a
 *  delete, so the item is not drawn again by the next `openNextRound`. */
export async function skipRound(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
): Promise<void> {
  await step('skip-round', () =>
    updateDoc(doc(firestore, paths.round(sessionId, roundId)), { phase: 'skipped' }),
  )
}

/**
 * One vote per player per round, structurally: the document id is the voter's
 * uid. Voting for yourself is refused by the rules, not just hidden by the UI
 * - see `validVote` in firestore.rules.
 *
 * The second write publishes *that* this player voted, never who for. The
 * host needs to know when the room is done so they can reveal, and the votes
 * themselves are unreadable until after the reveal by design - so the fact of
 * voting lives on the player's own public document instead. It carries no
 * information the room does not already have: everyone can see who has put
 * their phone down.
 */
export async function castVote(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
  uid: string,
  votedForPlayerId: string,
): Promise<void> {
  await step('cast-vote', () =>
    setDoc(doc(firestore, paths.vote(sessionId, roundId, uid)), {
      votedForPlayerId,
      castAt: Date.now(),
    } satisfies VoteDoc),
  )
  try {
    await step('mark-voted', () =>
      updateDoc(doc(firestore, paths.player(sessionId, uid)), { votedRoundId: roundId }),
    )
  } catch (error) {
    // The vote itself is in, and that is what the game runs on. This second
    // write only feeds the host's "how many have voted" counter, so failing it
    // must not report the vote as failed - that told the player to vote again
    // over a vote that had counted.
    console.warn('[FlashPlay] marking the player as voted failed:', errorCode(error))
  }
}

/**
 * DESIGN's scoring, as a pure function so that every device computes the same
 * numbers from the same public data - the host to write them, everyone else
 * to display them - and so the arithmetic is testable without an emulator.
 *
 * Two points for each correct guess, one point to the author for every voter
 * they fooled. The author's own vote is skipped in both directions: they vote
 * for someone else purely so that not voting would not give them away.
 */
export function scoreRound(
  votes: Record<string, string>,
  authorPlayerId: string,
): Record<string, number> {
  const awarded: Record<string, number> = {}
  for (const [voterId, votedForPlayerId] of Object.entries(votes)) {
    if (voterId === authorPlayerId) continue
    if (votedForPlayerId === authorPlayerId) {
      awarded[voterId] = (awarded[voterId] ?? 0) + POINTS_FOR_CORRECT_GUESS
    } else {
      awarded[authorPlayerId] = (awarded[authorPlayerId] ?? 0) + POINTS_PER_FOOLED_VOTER
    }
  }
  return awarded
}

/**
 * Host: reveal the round and score it, in the order `ROUND_REVEAL_ORDER`
 * documents and for the reasons it gives - closing the round before opening
 * the author is a security boundary, not a preference.
 *
 * **Every step checks whether it has already happened**, so a re-tap after a
 * dropped write finishes the job instead of dying on the step that already
 * landed. The totals are recomputed from every round's `awarded` map rather
 * than incremented, so finishing a half-done reveal cannot pay twice.
 */
export async function revealRound(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
): Promise<RoundSummary> {
  const roundRef = doc(firestore, paths.round(sessionId, roundId))
  const round = (
    await step('read-round', () => getDoc(roundRef))
  ).data() as RoundDoc
  const { itemId } = round

  if (round.phase !== 'revealed') {
    await step('close-voting', () => updateDoc(roundRef, { phase: 'revealed' }))
  }

  const itemRef = doc(firestore, paths.item(sessionId, itemId))
  const item = (await step('read-item', () => getDoc(itemRef))).data() as ItemDoc
  if (!item.revealed) {
    await step('reveal-item', () => updateDoc(itemRef, { revealed: true }))
  }

  const [votesSnap, authorSnap] = await Promise.all([
    step('read-votes', () => getDocs(collection(firestore, paths.votes(sessionId, roundId)))),
    step('read-author', () => getDoc(doc(firestore, paths.itemAuthor(sessionId, itemId)))),
  ])

  const { authorPlayerId } = authorSnap.data() as ItemAuthorDoc
  const votes: Record<string, string> = {}
  for (const vote of votesSnap.docs) {
    votes[vote.id] = (vote.data() as VoteDoc).votedForPlayerId
  }

  const awarded = round.awarded ?? scoreRound(votes, authorPlayerId)
  if (!round.awarded) {
    await step('record-awards', () => updateDoc(roundRef, { awarded }))
  }
  await step('write-scores', () => recomputeScores(firestore, sessionId, roundId, awarded))

  return { authorPlayerId, votes, awarded }
}

/** The gathering's totals are the sum of what every round paid out. Summed
 *  rather than incremented so that re-running a reveal, or finishing one that
 *  died halfway, converges on the same numbers instead of doubling them. */
async function recomputeScores(
  firestore: Firestore,
  sessionId: string,
  justScoredRoundId: string,
  justAwarded: Record<string, number>,
): Promise<void> {
  const roundsSnap = await getDocs(collection(firestore, paths.rounds(sessionId)))
  const scores: Record<string, number> = {}
  for (const roundDoc of roundsSnap.docs) {
    // The round just scored may not be in this snapshot yet - Firestore has no
    // read-your-writes guarantee across two separate requests - so its own
    // awards are taken from the value in hand.
    const awarded =
      roundDoc.id === justScoredRoundId ? justAwarded : ((roundDoc.data() as RoundDoc).awarded ?? {})
    for (const [playerId, points] of Object.entries(awarded)) {
      scores[playerId] = (scores[playerId] ?? 0) + points
    }
  }
  await updateDoc(doc(firestore, paths.session(sessionId)), { scores })
}

/** Host: the game is over - no more rounds. Moving to `done` is what
 *  Gathering.tsx routes off; milestone 6's second game starts from there. */
export async function finishGame(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
): Promise<void> {
  await step('finish-game', () =>
    updateDoc(doc(firestore, paths.game(sessionId, gameId)), { phase: 'done' }),
  )
}

// --- React hooks (app-only: always the real, module-level db) --------------

export interface RoundsState {
  rounds: (RoundDoc & { id: string })[]
  error: string | null
}

/** Live view of every round in this game, in play order. Capped at ten by
 *  MAX_ROUNDS, so listening to all of them costs nothing and gives the screen
 *  both the current round and "round 4 of 10" without a second query. */
export function useRounds(sessionId: string | null, gameId: string | null): RoundsState {
  const [state, setState] = useState<RoundsState>({ rounds: [], error: null })

  useEffect(() => {
    if (!sessionId || !gameId) {
      setState({ rounds: [], error: null })
      return
    }
    const unsubscribe = onSnapshot(
      query(collection(db, paths.rounds(sessionId)), where('gameId', '==', gameId)),
      (snap) => {
        const rounds = snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoundDoc) }))
        rounds.sort((a, b) => a.order - b.order)
        setState({ rounds, error: null })
      },
      (error) => {
        console.error('[FlashPlay] rounds listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [sessionId, gameId])

  return state
}

export interface ItemsState {
  items: Record<string, ItemDoc>
  error: string | null
}

/** Live view of this game's items, keyed by id. The round document holds only
 *  an itemId; the text everyone reads comes from here, and it updates in place
 *  when the host reveals one. */
export function useItems(sessionId: string | null, gameId: string | null): ItemsState {
  const [state, setState] = useState<ItemsState>({ items: {}, error: null })

  useEffect(() => {
    if (!sessionId || !gameId) {
      setState({ items: {}, error: null })
      return
    }
    const unsubscribe = onSnapshot(
      query(collection(db, paths.items(sessionId)), where('gameId', '==', gameId)),
      (snap) => {
        const items: Record<string, ItemDoc> = {}
        for (const d of snap.docs) items[d.id] = d.data() as ItemDoc
        setState({ items, error: null })
      },
      (error) => {
        console.error('[FlashPlay] items listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [sessionId, gameId])

  return state
}

export interface VotesState {
  /** Voter id -> who they voted for. Empty until the round is revealed: the
   *  rules refuse this collection before then, which is the whole point of it
   *  (a live tally would turn the round into a poll everyone follows). */
  votes: Record<string, string>
  error: string | null
}

/** Live votes for a revealed round. Pass `enabled: false` before the reveal -
 *  subscribing early is not a leak (the rules refuse it) but it produces a
 *  permission error on every player's console for the whole round. */
export function useVotes(
  sessionId: string | null,
  roundId: string | null,
  enabled: boolean,
): VotesState {
  const [state, setState] = useState<VotesState>({ votes: {}, error: null })

  useEffect(() => {
    if (!sessionId || !roundId || !enabled) {
      setState({ votes: {}, error: null })
      return
    }
    const unsubscribe = onSnapshot(
      collection(db, paths.votes(sessionId, roundId)),
      (snap) => {
        const votes: Record<string, string> = {}
        for (const d of snap.docs) votes[d.id] = (d.data() as VoteDoc).votedForPlayerId
        setState({ votes, error: null })
      },
      (error) => {
        console.error('[FlashPlay] votes listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [sessionId, roundId, enabled])

  return state
}

/** Who wrote the item, once the round has revealed it. Before that this reads
 *  a document the rules refuse to everyone - which is the entire game - so it
 *  is only ever called with `enabled` true. Every device needs this, not just
 *  the host's, so it is a hook here rather than a value revealRound() returns
 *  to the one machine that called it. */
export function useAuthor(
  sessionId: string | null,
  itemId: string | null,
  enabled: boolean,
): { authorPlayerId: string | null; error: string | null } {
  const [state, setState] = useState<{ authorPlayerId: string | null; error: string | null }>({
    authorPlayerId: null,
    error: null,
  })

  useEffect(() => {
    if (!sessionId || !itemId || !enabled) {
      setState({ authorPlayerId: null, error: null })
      return
    }
    let cancelled = false
    void getDoc(doc(db, paths.itemAuthor(sessionId, itemId)))
      .then((snap) => {
        if (cancelled) return
        const authorPlayerId = snap.exists() ? (snap.data() as ItemAuthorDoc).authorPlayerId : null
        setState({ authorPlayerId, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[FlashPlay] reading the author failed:', errorCode(error), error)
        setState({ authorPlayerId: null, error: errorCode(error) })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, itemId, enabled])

  return state
}

/** Whether this player has already voted in this round, asked of Firestore
 *  rather than remembered - a phone that locks and reloads mid-round must not
 *  offer the vote again. A player may always read back their own vote (see
 *  the `allow get` beside the votes rules). */
export async function getMyVote(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
  uid: string,
): Promise<string | null> {
  const snap = await getDoc(doc(firestore, paths.vote(sessionId, roundId, uid)))
  return snap.exists() ? (snap.data() as VoteDoc).votedForPlayerId : null
}
