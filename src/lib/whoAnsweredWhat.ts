/**
 * "Who answered what" - the third game, offered at the choice between games
 * after the first one, next to "most likely to" (designed with Nitzan
 * 2026-10-05, DESIGN.md, "Who answered what").
 *
 * A round is one built-in choice question plus one of its options ("who chose
 * 'night owl'?"). Everyone marks the players they think chose it; one point per
 * OTHER player classified correctly. The material is what players answered in
 * the lobby minutes earlier (`players/{uid}/profileAnswers`), and the part
 * that needs care is the truth: **no phone may read anyone's answer for the
 * round until the reveal, the host's included.** The shape that achieves it:
 *
 * - The host's client reads the LOBBY answers privately (its read access to
 *   `profileAnswers` is a technical fact, decided fine on 2026-09-27) only to
 *   count them and pick a (question, option) with a real split. The counts are
 *   never rendered anywhere - not on the host's screen either; the only thing
 *   shown is "how many questions are available".
 * - Each player's own client then writes a round-private answer (`chose`, one
 *   bit) and a public participation marker with no content. A lobby answer is
 *   copied automatically; a player with none gets a short, skippable window to
 *   answer live. A live answer is NOT also saved to `profileAnswers`, because
 *   the host can read that at any time.
 * - Candidates are the players whose marker says "answered", frozen when the
 *   answering window (`preview`) closes. A skip means not a candidate.
 * - Guesses are a list of player ids per guesser (`RoundGuessDoc`), separate
 *   from `VoteDoc`, private until the reveal.
 * - The reveal reuses `revealWith` in rounds.ts - the one resumable
 *   implementation of the sequence - and only supplies what to read and how to
 *   score it.
 *
 * As everywhere else, `firestore` is a parameter so whoAnsweredWhat.test.ts
 * can run these against the rules emulator.
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
import { PROFILE_QUESTIONS } from '../content/profileQuestions'
import { db } from './firebase'
import {
  MAX_ROUNDS,
  MIN_LOBBY_ANSWERERS,
  POINTS_FOR_CORRECT_CLASSIFICATION,
  paths,
  type GameDoc,
  type ItemDoc,
  type PlayerDoc,
  type ProfileAnswerDoc,
  type ProfileQuestion,
  type RoundAnswerDoc,
  type RoundDoc,
  type RoundGuessDoc,
  type RoundParticipantDoc,
} from './model'
import { revealWith } from './rounds'
import { errorCode, step } from './room'

/**
 * Roughly one round in five may be lopsided - everyone chose the option, or
 * nobody did - so the game is not always a coin flip between two camps. Asked
 * for as a probability rather than a rule so it can be tuned after a real
 * evening: Nitzan wants balance, with dead rounds as the exception.
 */
export const LOPSIDED_ROUND_PROBABILITY = 0.2

/** Only the players who can actually answer count: a participant added by name
 *  holds no phone, and a player who left is not in the room any more. */
export type RosterPlayer = Pick<PlayerDoc, 'hasDevice' | 'leftAt'> & { id: string }

export function isActivePlayer(player: Pick<PlayerDoc, 'hasDevice' | 'leftAt'>): boolean {
  return player.hasDevice && !player.leftAt
}

/** The built-in questions this game can ask: choice kinds with real options.
 *  A custom question is excluded on purpose - the game's content is the
 *  shipped bank (decided with the brief, 2026-10-05). */
export const CHOICE_QUESTIONS: readonly ProfileQuestion[] = PROFILE_QUESTIONS.filter(
  (question) => question.kind !== 'text' && (question.options?.length ?? 0) > 0,
)

export function findChoiceQuestion(questionId: string): ProfileQuestion | undefined {
  return CHOICE_QUESTIONS.find((question) => question.id === questionId)
}

// --- Reading a stored answer -------------------------------------------------

/** The individual values an answer stands for, trimmed, empties dropped. A
 *  single-choice answer is one string, a multi-choice one an array, and either
 *  may carry the free text of the "other" chip (it is simply not an option). */
export function answerValues(answer: string | string[] | undefined): string[] {
  if (answer === undefined) return []
  return (Array.isArray(answer) ? answer : [answer])
    .map((value) => value.trim())
    .filter((value) => value !== '')
}

// --- The selection policy (pure) ---------------------------------------------

export interface QuestionAnswerStats {
  questionId: string
  /** Players who answered this question in the lobby (anything non-empty). */
  answerers: number
  /** Option -> how many of those answerers chose it. EVERY option of the
   *  question is a key, zero counts included - a zero is information. */
  choosers: Record<string, number>
}

export interface RoundPick {
  questionId: string
  option: string
}

/** Counts lobby answers per question and option. `answers` is player id ->
 *  question id -> stored answer; only choice questions are counted. */
export function computeAnswerStats(
  answers: Record<string, Record<string, string | string[]>>,
  questions: readonly ProfileQuestion[] = CHOICE_QUESTIONS,
): QuestionAnswerStats[] {
  return questions.map((question) => {
    const choosers: Record<string, number> = {}
    for (const option of question.options ?? []) choosers[option] = 0
    let answerers = 0
    for (const byQuestion of Object.values(answers)) {
      const values = answerValues(byQuestion[question.id])
      if (values.length === 0) continue
      answerers += 1
      for (const option of question.options ?? []) {
        if (values.includes(option)) choosers[option] += 1
      }
    }
    return { questionId: question.id, answerers, choosers }
  })
}

/** Questions a round may still be built from: enough lobby answerers, and not
 *  asked yet this gathering. */
export function eligibleQuestions(
  stats: readonly QuestionAnswerStats[],
  usedQuestionIds: ReadonlySet<string> | readonly string[] = [],
): QuestionAnswerStats[] {
  const used = new Set(usedQuestionIds)
  return stats.filter((q) => q.answerers >= MIN_LOBBY_ANSWERERS && !used.has(q.questionId))
}

/**
 * Picks the next (question, option), preferring a real split.
 *
 * - A question needs `MIN_LOBBY_ANSWERERS` lobby answerers and must not have
 *   been asked already this gathering.
 * - A **split** option has at least one chooser and at least one non-chooser
 *   among the lobby answerers. Most rounds come from these, weighted by how
 *   even the split is (`min(choosers, others)`), so 2 against 3 is far likelier
 *   than 1 against 24 while neither is excluded.
 * - A **lopsided** option (everyone chose it, or nobody did) is drawn with
 *   probability `lopsidedProbability`; with none available the draw falls back
 *   to a split, and vice versa, so a round is only null when no eligible
 *   question has any option at all.
 * - The question is drawn uniformly first and the option second, so a question
 *   with nine options does not crowd out one with four.
 *
 * `random` is injected (the same shape as `selectSecondGameFact`) so a test
 * can pin every draw: the first call decides lopsided or not, the second picks
 * the question, the third the option.
 */
export function selectWhoAnsweredWhatRound(
  stats: readonly QuestionAnswerStats[],
  usedQuestionIds: ReadonlySet<string> | readonly string[] = [],
  random: () => number = Math.random,
  lopsidedProbability: number = LOPSIDED_ROUND_PROBABILITY,
): RoundPick | null {
  const eligible = eligibleQuestions(stats, usedQuestionIds)

  const split: { questionId: string; options: { option: string; weight: number }[] }[] = []
  const lopsided: { questionId: string; options: { option: string; weight: number }[] }[] = []
  for (const q of eligible) {
    const splitOptions: { option: string; weight: number }[] = []
    const lopsidedOptions: { option: string; weight: number }[] = []
    for (const [option, count] of Object.entries(q.choosers)) {
      if (count > 0 && count < q.answerers) {
        splitOptions.push({ option, weight: Math.min(count, q.answerers - count) })
      } else {
        lopsidedOptions.push({ option, weight: 1 })
      }
    }
    if (splitOptions.length > 0) split.push({ questionId: q.questionId, options: splitOptions })
    if (lopsidedOptions.length > 0) {
      lopsided.push({ questionId: q.questionId, options: lopsidedOptions })
    }
  }

  const wantLopsided = random() < lopsidedProbability
  const pools = wantLopsided ? [lopsided, split] : [split, lopsided]
  for (const pool of pools) {
    if (pool.length === 0) continue
    const question = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
    const total = question.options.reduce((sum, o) => sum + o.weight, 0)
    let ticket = random() * total
    for (const { option, weight } of question.options) {
      ticket -= weight
      if (ticket < 0) return { questionId: question.questionId, option }
    }
    return { questionId: question.questionId, option: question.options[question.options.length - 1].option }
  }
  return null
}

// --- Candidates and scoring (pure) -------------------------------------------

/**
 * Who a round is about: players whose public marker says they answered, who
 * hold a phone and have not left. The one definition used by every screen and
 * by the host's scoring, so the list a guesser sees is the list that is scored.
 */
export function candidateIds(
  participants: Record<string, Pick<RoundParticipantDoc, 'answered'>>,
  players: readonly RosterPlayer[],
): string[] {
  return players
    .filter((player) => isActivePlayer(player) && participants[player.id]?.answered === true)
    .map((player) => player.id)
}

/**
 * One point for every OTHER candidate the guesser classified correctly -
 * marked and that candidate chose the option, or not marked and they did not.
 * The guesser is never scored about themselves, whether or not they are a
 * candidate. `chose` is keyed by candidate id; a name in a guess that is not a
 * candidate is ignored. A guesser who submitted nothing is not in `guesses`
 * and scores nothing. When nobody chose the option, marking nobody is correct
 * for every candidate.
 */
export function classificationsCorrect(
  guesserId: string,
  marked: readonly string[],
  chose: Record<string, boolean>,
): { correct: number; total: number } {
  const markedSet = new Set(marked)
  let correct = 0
  let total = 0
  for (const [candidateId, didChoose] of Object.entries(chose)) {
    if (candidateId === guesserId) continue
    total += 1
    if (markedSet.has(candidateId) === didChoose) correct += 1
  }
  return { correct, total }
}

export function scoreWhoAnsweredWhat(
  guesses: Record<string, readonly string[]>,
  chose: Record<string, boolean>,
): Record<string, number> {
  const awarded: Record<string, number> = {}
  for (const [guesserId, marked] of Object.entries(guesses)) {
    const { correct } = classificationsCorrect(guesserId, marked, chose)
    if (correct > 0) awarded[guesserId] = correct * POINTS_FOR_CORRECT_CLASSIFICATION
  }
  return awarded
}

// --- The host: pool, opening the game and its rounds -------------------------

/**
 * Host only (the rules give nobody else this read): every active player's
 * lobby answer to every choice question, counted. The counts leave this
 * function only as `QuestionAnswerStats`, which no screen renders.
 */
export async function loadAnswerStats(
  firestore: Firestore,
  sessionId: string,
  players: readonly RosterPlayer[],
): Promise<QuestionAnswerStats[]> {
  const active = players.filter(isActivePlayer)
  const reads = active.flatMap((player) =>
    CHOICE_QUESTIONS.map(async (question) => {
      const snap = await step('read-lobby-answer', () =>
        getDoc(doc(firestore, paths.profileAnswer(sessionId, player.id, question.id))),
      )
      return {
        playerId: player.id,
        questionId: question.id,
        answer: snap.exists() ? (snap.data() as ProfileAnswerDoc).answer : undefined,
      }
    }),
  )
  const answers: Record<string, Record<string, string | string[]>> = {}
  for (const read of await Promise.all(reads)) {
    if (read.answer === undefined) continue
    answers[read.playerId] ??= {}
    answers[read.playerId][read.questionId] = read.answer
  }
  return computeAnswerStats(answers)
}

export interface AnswerGamePool {
  /** Questions with enough lobby answerers - a count, never a content. */
  availableQuestions: number
}

/** What the choice between games needs to show: whether this game can be
 *  played at all. Nothing about WHAT anyone answered is returned. */
export async function describeWhoAnsweredWhatPool(
  firestore: Firestore,
  sessionId: string,
  players: readonly RosterPlayer[],
): Promise<AnswerGamePool> {
  const stats = await loadAnswerStats(firestore, sessionId, players)
  return { availableQuestions: eligibleQuestions(stats).length }
}

/** Host: opens the game. Like "most likely to" it starts in its round loop,
 *  because its material already exists. */
export async function startWhoAnsweredWhat(
  firestore: Firestore,
  sessionId: string,
  order = 1,
  nextId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const gameId = nextId()
  const game: GameDoc = {
    type: 'who-answered-what',
    phase: 'rounds',
    promptIds: [],
    order,
    startedAt: Date.now(),
    // Never read for this game - every phase is host-paced.
    phaseEndsAt: 0,
  }
  await step('create-answer-game', () => setDoc(doc(firestore, paths.game(sessionId, gameId)), game))
  await step('point-session-at-answer-game', () =>
    updateDoc(doc(firestore, paths.session(sessionId)), { currentGameId: gameId }),
  )
  return gameId
}

/**
 * Host: opens the next round - counts the lobby answers, picks a (question,
 * option) by `selectWhoAnsweredWhatRound`, and writes the round's public
 * material (an already-revealed item holding the option; there is no author to
 * hide) and the round itself, in `preview` = the answering window.
 *
 * A question is "used" when a ROUND points at an item for it - a skipped round
 * included, so a skipped question is not drawn again, but an orphan item left
 * by a host who died between the two writes does not burn the question.
 *
 * Returns null when nothing is left to ask or MAX_ROUNDS have been played.
 */
export async function openNextAnswerRound(
  firestore: Firestore,
  sessionId: string,
  gameId: string,
  players: readonly RosterPlayer[],
  nextId: (order: number) => string = (order) => `${gameId}-r${order}`,
  random: () => number = Math.random,
  nextItemId: () => string = () => crypto.randomUUID(),
): Promise<string | null> {
  const [roundsSnap, itemsSnap] = await Promise.all([
    step('read-rounds', () =>
      getDocs(query(collection(firestore, paths.rounds(sessionId)), where('gameId', '==', gameId))),
    ),
    step('read-items', () =>
      getDocs(query(collection(firestore, paths.items(sessionId)), where('gameId', '==', gameId))),
    ),
  ])

  const played = roundsSnap.docs.filter((d) => (d.data() as RoundDoc).phase !== 'skipped')
  if (played.length >= MAX_ROUNDS) return null

  const spentItemIds = new Set(roundsSnap.docs.map((d) => (d.data() as RoundDoc).itemId))
  const used = new Set(
    itemsSnap.docs.filter((d) => spentItemIds.has(d.id)).map((d) => (d.data() as ItemDoc).promptId),
  )

  const stats = await loadAnswerStats(firestore, sessionId, players)
  const pick = selectWhoAnsweredWhatRound(stats, used, random)
  if (!pick) return null

  // The first round fixes the total every phone shows, as the second game does.
  if (roundsSnap.size === 0) {
    await step('plan-answer-game', () =>
      updateDoc(doc(firestore, paths.game(sessionId, gameId)), {
        plannedRounds: Math.min(MAX_ROUNDS, eligibleQuestions(stats, used).length),
      }),
    )
  }

  const itemId = nextItemId()
  await step('create-answer-item', () =>
    setDoc(doc(firestore, paths.item(sessionId, itemId)), {
      gameId,
      text: pick.option,
      promptId: pick.questionId,
      option: pick.option,
      revealed: true,
      createdAt: Date.now(),
    } satisfies ItemDoc),
  )

  const roundId = nextId(roundsSnap.size)
  await step('create-round', () =>
    setDoc(doc(firestore, paths.round(sessionId, roundId)), {
      gameId,
      itemId,
      phase: 'preview',
      order: roundsSnap.size,
      startedAt: Date.now(),
    } satisfies RoundDoc),
  )
  return roundId
}

// --- A player: answering, guessing -------------------------------------------

/**
 * Whether this player chose `option` in the LOBBY - `null` when they gave no
 * answer there (so the round must ask them live). Read by the player's own
 * client from their own private answer.
 */
export async function readLobbyChoice(
  firestore: Firestore,
  sessionId: string,
  uid: string,
  questionId: string,
  option: string,
): Promise<boolean | null> {
  const snap = await getDoc(doc(firestore, paths.profileAnswer(sessionId, uid, questionId)))
  if (!snap.exists()) return null
  const values = answerValues((snap.data() as ProfileAnswerDoc).answer)
  return values.length === 0 ? null : values.includes(option)
}

/**
 * This player's answer for the round, then the public marker that says they
 * took part - in that order, because the rules refuse a marker with no answer
 * behind it. Both writes are idempotent while the answering window is open, so
 * a retry after a dropped second write simply writes both again.
 */
export async function submitRoundAnswer(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
  uid: string,
  chose: boolean,
): Promise<void> {
  await step('write-round-answer', () =>
    setDoc(doc(firestore, paths.roundAnswer(sessionId, roundId, uid)), {
      chose,
      answeredAt: Date.now(),
    } satisfies RoundAnswerDoc),
  )
  await step('mark-participating', () =>
    setDoc(doc(firestore, paths.roundParticipant(sessionId, roundId, uid)), {
      answered: true,
      at: Date.now(),
    } satisfies RoundParticipantDoc),
  )
}

/** This player sits the round out: not a candidate, but still guesses. */
export async function skipRoundAnswer(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
  uid: string,
): Promise<void> {
  await step('mark-skipped', () =>
    setDoc(doc(firestore, paths.roundParticipant(sessionId, roundId, uid)), {
      answered: false,
      at: Date.now(),
    } satisfies RoundParticipantDoc),
  )
}

/**
 * A guess, replaceable until the reveal. Like `castVote` it then publishes
 * *that* the player guessed (never what) on their own public document, which
 * is all the host's "how many have guessed" counter reads.
 */
export async function castGuess(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
  uid: string,
  markedPlayerIds: string[],
): Promise<void> {
  await step('cast-guess', () =>
    setDoc(doc(firestore, paths.roundGuess(sessionId, roundId, uid)), {
      markedPlayerIds,
      castAt: Date.now(),
    } satisfies RoundGuessDoc),
  )
  try {
    await step('mark-guessed', () =>
      updateDoc(doc(firestore, paths.player(sessionId, uid)), { votedRoundId: roundId }),
    )
  } catch (error) {
    // The guess is in; this only feeds the host's counter (see castVote).
    console.warn('[FlashPlay] marking the player as guessed failed:', errorCode(error))
  }
}

/** A phone that reloads mid-round must not forget its own guess. */
export async function getMyGuess(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
  uid: string,
): Promise<string[] | null> {
  const snap = await getDoc(doc(firestore, paths.roundGuess(sessionId, roundId, uid)))
  return snap.exists() ? (snap.data() as RoundGuessDoc).markedPlayerIds : null
}

// --- The reveal --------------------------------------------------------------

export interface AnswerRoundSummary {
  /** Candidate id -> whether they chose the option. */
  chose: Record<string, boolean>
  /** Guesser id -> the players they marked. */
  guesses: Record<string, string[]>
  awarded: Record<string, number>
}

/**
 * Host: reveal the round and score it. The sequence is `revealWith`'s - close
 * the round first, which is what makes the answers and guesses readable - and
 * everything here is the read and the arithmetic. Candidates are recomputed
 * from the markers and the roster exactly as the screens compute them.
 */
export async function revealAnswerRound(
  firestore: Firestore,
  sessionId: string,
  roundId: string,
  players: readonly RosterPlayer[],
): Promise<AnswerRoundSummary> {
  const { detail, awarded } = await revealWith(firestore, sessionId, roundId, async () => {
    const [participantsSnap, answersSnap, guessesSnap] = await Promise.all([
      step('read-participants', () =>
        getDocs(collection(firestore, paths.roundParticipants(sessionId, roundId))),
      ),
      step('read-answers', () =>
        getDocs(collection(firestore, paths.roundAnswers(sessionId, roundId))),
      ),
      step('read-guesses', () =>
        getDocs(collection(firestore, paths.roundGuesses(sessionId, roundId))),
      ),
    ])
    const participants: Record<string, RoundParticipantDoc> = {}
    for (const d of participantsSnap.docs) participants[d.id] = d.data() as RoundParticipantDoc
    const candidates = new Set(candidateIds(participants, players))

    const chose: Record<string, boolean> = {}
    for (const d of answersSnap.docs) {
      if (candidates.has(d.id)) chose[d.id] = (d.data() as RoundAnswerDoc).chose
    }
    const guesses: Record<string, string[]> = {}
    for (const d of guessesSnap.docs) guesses[d.id] = (d.data() as RoundGuessDoc).markedPlayerIds

    return { detail: { chose, guesses }, score: () => scoreWhoAnsweredWhat(guesses, chose) }
  })
  return { ...detail, awarded }
}

// --- React hooks (app-only: always the real, module-level db) ----------------

/** The public participation markers of one round, live. Readable by every
 *  player at any time, so no gating - they carry no content. */
export function useParticipants(
  sessionId: string | null,
  roundId: string | null,
): { participants: Record<string, RoundParticipantDoc>; error: string | null } {
  const [state, setState] = useState<{
    participants: Record<string, RoundParticipantDoc>
    error: string | null
  }>({ participants: {}, error: null })

  useEffect(() => {
    if (!sessionId || !roundId) {
      setState({ participants: {}, error: null })
      return
    }
    setState({ participants: {}, error: null })
    return onSnapshot(
      collection(db, paths.roundParticipants(sessionId, roundId)),
      (snap) => {
        const participants: Record<string, RoundParticipantDoc> = {}
        for (const d of snap.docs) participants[d.id] = d.data() as RoundParticipantDoc
        setState({ participants, error: null })
      },
      (error) => {
        console.error('[FlashPlay] participants listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, error: errorCode(error) }))
      },
    )
  }, [sessionId, roundId])

  return state
}

const REVEAL_RETRIES = 4
const REVEAL_RETRY_MS = 500

/** A collection the rules open only once the round is `revealed`, listened to
 *  live. Pass `enabled: false` before the reveal. The host sees its own
 *  pending `revealed` write before the server has committed it, so the first
 *  subscription can be refused; the refusal is retried a few times before it
 *  is shown (the same handling as `useVotes`). */
function useRevealedCollection<T>(
  path: string | null,
  enabled: boolean,
  pick: (data: unknown) => T,
): { data: Record<string, T>; error: string | null } {
  const [state, setState] = useState<{ data: Record<string, T>; error: string | null }>({
    data: {},
    error: null,
  })

  useEffect(() => {
    if (!path || !enabled) {
      setState({ data: {}, error: null })
      return
    }
    let attempt = 0
    let unsubscribe = () => {}
    let retry: ReturnType<typeof setTimeout> | undefined
    const subscribe = () => {
      unsubscribe = onSnapshot(
        collection(db, path),
        (snap) => {
          const data: Record<string, T> = {}
          for (const d of snap.docs) data[d.id] = pick(d.data())
          setState({ data, error: null })
        },
        (error) => {
          if (errorCode(error) === 'permission-denied' && attempt < REVEAL_RETRIES) {
            attempt += 1
            retry = setTimeout(subscribe, REVEAL_RETRY_MS * attempt)
            return
          }
          console.error('[FlashPlay] revealed collection listener failed:', errorCode(error), error)
          setState((prev) => ({ ...prev, error: errorCode(error) }))
        },
      )
    }
    subscribe()
    return () => {
      clearTimeout(retry)
      unsubscribe()
    }
    // `pick` is a module-level function at every call site, so it never
    // re-subscribes.
  }, [path, enabled, pick])

  return state
}

const pickChose = (data: unknown) => (data as RoundAnswerDoc).chose
const pickMarked = (data: unknown) => (data as RoundGuessDoc).markedPlayerIds

/** Candidate id -> whether they chose the option. Empty until the reveal. */
export function useRevealedAnswers(
  sessionId: string | null,
  roundId: string | null,
  enabled: boolean,
) {
  const { data, error } = useRevealedCollection(
    sessionId && roundId ? paths.roundAnswers(sessionId, roundId) : null,
    enabled,
    pickChose,
  )
  return { chose: data, error }
}

/** Guesser id -> who they marked. Empty until the reveal. */
export function useRevealedGuesses(
  sessionId: string | null,
  roundId: string | null,
  enabled: boolean,
) {
  const { data, error } = useRevealedCollection(
    sessionId && roundId ? paths.roundGuesses(sessionId, roundId) : null,
    enabled,
    pickMarked,
  )
  return { guesses: data, error }
}
