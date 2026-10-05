/**
 * "Most likely to" - the second game, milestone 6, redesigned 2026-09-28 to
 * draw on the group's stored memory instead of on this evening's own harvest.
 *
 * The original version reused whatever the first game had just **revealed**,
 * naming the real author in the question itself ("David's answer: «...».
 * Which of you is most likely to..."). Nitzan found the flaw this shipped
 * with during the 2026-09-24 to 2026-09-28 content review: once the room
 * already knows David wrote it, "who is most likely to do this" collapses
 * back into "who wrote this" - the exact thing DESIGN's own milestone-6
 * section warns an unrevealed item would cause, just reached by a different
 * door. The fix is not a different wrapper sentence - it is never naming
 * anyone. This game now pulls a fact from the host's private store
 * (`FactDoc`, milestone 7) - any fact, from any past gathering with this
 * group, of any origin (a harvest answer, a guided-question answer, a
 * host-authored note) - and asks the room to guess without ever revealing
 * whose it was. That also turns on the thing BACKLOG called "the moat the
 * whole product rests on": this is the first game whose material comes from
 * the store rather than from a fresh harvest.
 *
 * The round mechanics are still milestone 5's, reused rather than
 * re-implemented: `openVoting`, `castVote` and `revealRound` in rounds.ts all
 * work unchanged, because a round is a round, and scoring is still "whoever
 * voted with the majority" (`scoreMajority`, unchanged). What changed is only
 * how a round's material comes to exist at all - see `openNextSecondRound`.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import { HARVEST_PROMPTS } from '../content/prompts'
import { PROFILE_QUESTIONS } from '../content/profileQuestions'
import { step } from './room'
import {
  MAX_ROUNDS,
  POINTS_FOR_MAJORITY_VOTE,
  SECOND_GAME_ITEM_TEXT_MAX_LENGTH,
  paths,
  type FactDoc,
  type GameDoc,
  type ItemDoc,
  type RoundDoc,
  type SessionDoc,
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
 * Strips a fact's own question back off its stored text, which is always
 * `"{question}: {answer}"` (see `writeFactsForGame`/`writeProfileFacts` in
 * memory.ts) - exact and safe to invert here because this function is only
 * ever called with the question that produced the text in the first place.
 */
function stripQuestionPrefix(questionText: string, fullText: string): string {
  const prefix = `${questionText}: `
  return fullText.startsWith(prefix) ? fullText.slice(prefix.length) : fullText
}

/**
 * Turns one stored fact into a self-contained "most likely to" question,
 * never naming who the fact actually came from - that anonymity is this
 * game's whole fix, see the module comment above.
 *
 * Three cases, cheapest and most tailored first:
 *
 * 1. A harvest-origin fact (`promptId` matches a shipped harvest prompt) -
 *    the prompt's own `secondGameQuestion` already exists for exactly this,
 *    genderless and written to fit a bare answer (see prompts.ts).
 * 2. A guided-question-origin fact (built-in `PROFILE_QUESTIONS`) - these
 *    have no per-question second-game wrapper (asking for one per question
 *    is more upkeep than the generic wrapper buys - decided with Nitzan
 *    2026-09-28), so a single approved generic sentence quotes the question
 *    itself rather than asserting it, which is what keeps it grammatical
 *    regardless of the question's own person/gender ("your hobby" reads fine
 *    quoted as "someone answered the question 'your hobby'", not as a live
 *    claim about whoever is being discussed).
 * 3. Anything else - a host's own custom question (whose original wording
 *    cannot be recovered once renamed or deleted) or a free-form manual note
 *    with no question behind it at all. There is nothing reliable to split
 *    into question/answer, so the whole stored text is quoted as a fact
 *    rather than parsed.
 */
export function composeSecondGameItemText(fact: Pick<FactDoc, 'text' | 'promptId'>): string {
  const harvestPrompt = fact.promptId
    ? HARVEST_PROMPTS.find((p) => p.id === fact.promptId)
    : undefined
  if (harvestPrompt) {
    const answer = stripQuestionPrefix(harvestPrompt.text, fact.text)
    return `«${answer}». ${harvestPrompt.secondGameQuestion}`
  }

  const profileQuestion = fact.promptId
    ? PROFILE_QUESTIONS.find((q) => q.id === fact.promptId)
    : undefined
  if (profileQuestion) {
    const answer = stripQuestionPrefix(profileQuestion.text, fact.text)
    return `מישהו מכם ענה על השאלה '${profileQuestion.text}' בתשובה: «${answer}». מי מכם הכי מתאים לתשובה הזאת?`
  }

  return `עובדה שמישהו מכם סיפר עליה: «${fact.text}». מי מכם הכי מתאים לה?`
}

/**
 * A fact that answers one of the built-in single- or multi-choice guided
 * questions ("העונה האהובה עליך: קיץ"). It cannot make a "most likely to"
 * round: it describes no behaviour, and several people give the same answer,
 * so the majority is arbitrary. Kept in the store for the host, left out of
 * this game's pool (decided with Nitzan 2026-10-05). A host's own custom
 * question has no recoverable kind, so its facts are treated as text.
 */
export function isChoiceAnswerFact(fact: Pick<FactDoc, 'promptId'>): boolean {
  const question = fact.promptId
    ? PROFILE_QUESTIONS.find((q) => q.id === fact.promptId)
    : undefined
  return question !== undefined && question.kind !== 'text'
}

export interface EligibleFact {
  id: string
  contactId: string
  /** The fact's own stored text, before composition - what duplicate
   *  detection compares, since two contacts sharing a composed sentence
   *  always share the raw fact too, but not the other way round. */
  rawText: string
  /** What actually gets written into the round's item if this fact wins. */
  composedText: string
  /** Carried through to the new item unchanged (or the 'memory' sentinel
   *  when absent) - see `composeSecondGameItemText` for what it means. */
  promptId?: string
  useCount: number
}

function normalizeFactText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Which facts are too similar to another contact's fact to make a real
 * question - the same underlying problem BACKLOG already tracks for "who
 * said that" ("Identical or near-identical answers break 'who said that'"),
 * here without needing AI: two different contacts recorded the same text
 * (after whitespace/case normalisation), so "who among you is most likely to
 * ..." has no answer worth finding. Raised by Nitzan 2026-09-28. This only
 * catches literal near-duplicates, not a differently-worded answer with the
 * same meaning - the harder case still needs the AI generator BACKLOG already
 * defers to.
 */
export function ambiguousFactIds(facts: readonly EligibleFact[]): Set<string> {
  const owners = new Map<string, Set<string>>()
  for (const fact of facts) {
    const key = normalizeFactText(fact.rawText)
    if (!owners.has(key)) owners.set(key, new Set())
    owners.get(key)!.add(fact.contactId)
  }
  const ambiguous = new Set<string>()
  for (const fact of facts) {
    if ((owners.get(normalizeFactText(fact.rawText))?.size ?? 0) > 1) ambiguous.add(fact.id)
  }
  return ambiguous
}

/**
 * Picks one fact to build the next round from - DESIGN's "prefers unused
 * facts" plus the fairness problem Nitzan raised 2026-09-28: a contact who
 * happens to have many stored facts must not get asked about more often than
 * one who has few, purely because there is more of their material to draw
 * from. The fix is two draws rather than one - a contact is chosen uniformly
 * from everyone who still has an eligible fact, and only then is a fact
 * chosen from that one contact's own pool - so `useCount` only ever competes
 * within one person's facts, never across people. Nothing about either draw
 * is visible to the room, so this needs no round-robin bookkeeping that could
 * let anyone infer whose "turn" it is.
 */
export function selectSecondGameFact(
  facts: readonly EligibleFact[],
  random: () => number = Math.random,
): EligibleFact | null {
  const ambiguous = ambiguousFactIds(facts)
  const eligible = facts.filter((f) => !ambiguous.has(f.id))
  if (eligible.length === 0) return null

  const byContact = new Map<string, EligibleFact[]>()
  for (const fact of eligible) {
    if (!byContact.has(fact.contactId)) byContact.set(fact.contactId, [])
    byContact.get(fact.contactId)!.push(fact)
  }
  const contactIds = [...byContact.keys()]
  const contactId = contactIds[Math.floor(random() * contactIds.length)]
  const candidates = byContact.get(contactId)!
  const minUse = Math.min(...candidates.map((f) => f.useCount))
  const preferred = candidates.filter((f) => f.useCount === minUse)
  return preferred[Math.floor(random() * preferred.length)]
}

/** Facts that can still become a question: not already used this gathering,
 *  short enough to quote, from a contact this gathering knows. */
async function loadSecondGamePool(
  firestore: Firestore,
  hostUid: string,
  sessionId: string,
  gameId: string,
  contactIds: string[],
): Promise<{ facts: EligibleFact[]; contactsWithAnyFact: Set<string> }> {
  const itemsSnap = await step('read-second-game-items', () =>
    getDocs(query(collection(firestore, paths.items(sessionId)), where('gameId', '==', gameId))),
  )
  const usedFactIds = new Set(
    itemsSnap.docs
      .map((d) => (d.data() as ItemDoc).sourceFactId)
      .filter((id): id is string => Boolean(id)),
  )

  const factSnaps = await Promise.all(
    contactIds.map((contactId) =>
      step('read-contact-facts', () =>
        getDocs(collection(firestore, paths.contactFacts(hostUid, contactId))),
      ),
    ),
  )

  const facts: EligibleFact[] = []
  const contactsWithAnyFact = new Set<string>()
  contactIds.forEach((contactId, i) => {
    for (const factDoc of factSnaps[i].docs) {
      const fact = factDoc.data() as FactDoc
      if (isChoiceAnswerFact(fact)) continue
      contactsWithAnyFact.add(contactId)
      if (usedFactIds.has(factDoc.id)) continue
      const composedText = composeSecondGameItemText(fact)
      if (composedText.length > SECOND_GAME_ITEM_TEXT_MAX_LENGTH) continue
      facts.push({
        id: factDoc.id,
        contactId,
        rawText: fact.text,
        composedText,
        promptId: fact.promptId,
        useCount: fact.useCount,
      })
    }
  })
  return { facts, contactsWithAnyFact }
}

/** How many questions the pool can really produce: duplicates two people
 *  recorded identically are skipped by the draw, so they do not count. */
function usableFactCount(facts: readonly EligibleFact[]): number {
  const ambiguous = ambiguousFactIds(facts)
  return facts.filter((fact) => !ambiguous.has(fact.id)).length
}

/** The fewest stored facts the host needs before the second game can start. */
export const MIN_SECOND_GAME_FACTS = 2

export interface SecondGamePool {
  /** Questions available right now. */
  available: number
  /** Players whose person has not answered a single question yet. */
  playersWithoutFacts: string[]
}

/**
 * What the second game has to work with, read before its first round: how many
 * questions the memory can make, and which players have contributed nothing -
 * so the host can see why the pool is thin, and ask them to answer.
 */
export async function describeSecondGamePool(
  firestore: Firestore,
  hostUid: string,
  sessionId: string,
  gameId: string,
): Promise<SecondGamePool> {
  const sessionSnap = await step('read-session', () => getDoc(doc(firestore, paths.session(sessionId))))
  const playerToContact = (sessionSnap.data() as SessionDoc).contactIds ?? {}
  const contactIds = [...new Set(Object.values(playerToContact))]
  const { facts, contactsWithAnyFact } = await loadSecondGamePool(
    firestore,
    hostUid,
    sessionId,
    gameId,
    contactIds,
  )
  return {
    available: usableFactCount(facts),
    playersWithoutFacts: Object.entries(playerToContact)
      .filter(([, contactId]) => !contactsWithAnyFact.has(contactId))
      .map(([playerId]) => playerId),
  }
}

/**
 * Opens the next "most likely to" round by drawing a fact from the group's
 * stored memory - any personal fact belonging to a contact this gathering
 * already knows (`session.contactIds`), from any past gathering with this
 * group, not only tonight's. The chosen fact is composed into a question
 * (`composeSecondGameItemText`) and written as a brand-new, already-revealed
 * item: there is no author to hide, so unlike the first game's items this one
 * gets no matching `ItemAuthorDoc` at all - see firestore.rules, the
 * host-authored `items` create clause added alongside this.
 *
 * A fact already spent earlier this gathering (tracked via `ItemDoc.
 * sourceFactId` on this game's own items - simpler than a second
 * bookkeeping collection, since the items are already being read) is never
 * drawn again, matching DESIGN's "never repeats a fact twice in the same
 * gathering".
 *
 * Returns null when the pool is empty or the ten-round cap is reached, the
 * same two ordinary endings as the first game.
 */
export async function openNextSecondRound(
  firestore: Firestore,
  hostUid: string,
  sessionId: string,
  gameId: string,
  nextId: (order: number) => string = (order) => `${gameId}-r${order}`,
  random: () => number = Math.random,
  nextItemId: () => string = () => crypto.randomUUID(),
): Promise<string | null> {
  const [sessionSnap, roundsSnap] = await Promise.all([
    step('read-session', () => getDoc(doc(firestore, paths.session(sessionId)))),
    step('read-rounds', () =>
      getDocs(query(collection(firestore, paths.rounds(sessionId)), where('gameId', '==', gameId))),
    ),
  ])

  const played = roundsSnap.docs.filter((d) => (d.data() as RoundDoc).phase !== 'skipped')
  if (played.length >= MAX_ROUNDS) return null

  const session = sessionSnap.data() as SessionDoc
  const contactIds = [...new Set(Object.values(session.contactIds ?? {}))]
  if (contactIds.length === 0) return null

  const { facts } = await loadSecondGamePool(firestore, hostUid, sessionId, gameId, contactIds)

  const chosen = selectSecondGameFact(facts, random)
  if (!chosen) return null

  // The first round fixes how many there will be, so every phone can show
  // "2 of 6" rather than "2 of 10" when the memory only holds six questions.
  // Counted before this round spends its fact; later rounds never rewrite it.
  if (roundsSnap.size === 0) {
    await step('plan-second-game', () =>
      updateDoc(doc(firestore, paths.game(sessionId, gameId)), {
        plannedRounds: Math.min(MAX_ROUNDS, usableFactCount(facts)),
      }),
    )
  }

  const itemId = nextItemId()
  await step('create-second-game-item', () =>
    setDoc(doc(firestore, paths.item(sessionId, itemId)), {
      gameId,
      text: chosen.composedText,
      // A manual fact carries no promptId at all - 'memory' is a sentinel,
      // never a real prompt id, so writeFactsForGame's own prompt lookup
      // simply finds nothing and skips it (as it already does for any item
      // whose prompt has left the pool) rather than mistaking this item for
      // a fresh submission to re-attribute. A harvest- or profile-origin
      // fact's real promptId is kept as-is, which is harmless for the same
      // reason: writeFactsForGame only ever re-attributes an item that also
      // has a matching, readable ItemAuthorDoc, and this item never gets one.
      promptId: chosen.promptId ?? 'memory',
      revealed: true,
      createdAt: Date.now(),
      sourceFactId: chosen.id,
    } satisfies ItemDoc),
  )
  await step('mark-fact-used', () =>
    updateDoc(doc(firestore, `${paths.contactFacts(hostUid, chosen.contactId)}/${chosen.id}`), {
      useCount: chosen.useCount + 1,
    }),
  )

  const roundId = nextId(roundsSnap.size)
  await step('create-round', () =>
    setDoc(doc(firestore, paths.round(sessionId, roundId)), {
      gameId,
      itemId,
      // The room has never heard this before, but the phase stays 'preview'
      // regardless - it is also where the skip button lives, and a host may
      // still want to pass on a fact the room would rather not hear read out.
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
