/**
 * Pure-function tests for the 2026-09-28 redesign of "most likely to" - the
 * parts of secondGame.ts that touch no Firestore, so they run in the fast
 * default suite rather than needing the emulator (see secondGame.test.ts for
 * the create/read/rules side of the same change).
 */
import { describe, expect, it } from 'vitest'
import { HARVEST_PROMPTS } from '../content/prompts'
import { PROFILE_QUESTIONS } from '../content/profileQuestions'
import {
  ambiguousFactIds,
  composeSecondGameItemText,
  selectSecondGameFact,
  type EligibleFact,
} from './secondGame'

describe('composeSecondGameItemText', () => {
  const harvestPrompt = HARVEST_PROMPTS[0]
  const profileQuestion = PROFILE_QUESTIONS.find((q) => q.kind === 'text')!

  it('quotes a harvest fact’s bare answer under the prompt’s own second-game question', () => {
    const text = composeSecondGameItemText({
      text: `${harvestPrompt.text}: המפתחות`,
      promptId: harvestPrompt.id,
    })

    expect(text).toBe(`«המפתחות». ${harvestPrompt.secondGameQuestion}`)
  })

  // The question is quoted as something that was ASKED, never asserted about
  // whoever is under discussion tonight - that is what keeps it grammatical
  // even though a guided question is phrased in the second person ("your
  // hobby"), decided with Nitzan 2026-09-28.
  it('wraps a guided-question fact in the generic, question-quoting sentence', () => {
    const text = composeSecondGameItemText({
      text: `${profileQuestion.text}: ציור`,
      promptId: profileQuestion.id,
    })

    expect(text).toBe(
      `מישהו מכם ענה על השאלה '${profileQuestion.text}' בתשובה: «ציור». מי מכם הכי מתאים לתשובה הזאת?`,
    )
  })

  it('quotes a custom-question or manual fact whole, with no promptId to look up', () => {
    expect(composeSecondGameItemText({ text: 'ניגן בכלי נשיפה בתזמורת הצבאית', promptId: undefined })).toBe(
      'עובדה שמישהו מכם סיפר עליה: «ניגן בכלי נשיפה בתזמורת הצבאית». מי מכם הכי מתאים לה?',
    )
  })

  it('falls back the same way for a promptId that matches neither content file', () => {
    // A host's own custom question, or one since renamed or deleted - the
    // original wording cannot be recovered from a fixed id.
    const text = composeSecondGameItemText({ text: 'התחביב שלך: ציור', promptId: 'a-custom-id' })

    expect(text).toBe('עובדה שמישהו מכם סיפר עליה: «התחביב שלך: ציור». מי מכם הכי מתאים לה?')
  })
})

function fact(overrides: Partial<EligibleFact>): EligibleFact {
  return {
    id: 'f1',
    contactId: 'c1',
    rawText: 'text',
    composedText: 'composed',
    useCount: 0,
    ...overrides,
  }
}

describe('ambiguousFactIds', () => {
  it('flags facts two different contacts recorded identically', () => {
    const facts = [
      fact({ id: 'f1', contactId: 'c1', rawText: 'favourite food: שניצל' }),
      fact({ id: 'f2', contactId: 'c2', rawText: 'favourite food: שניצל' }),
      fact({ id: 'f3', contactId: 'c3', rawText: 'favourite food: פיצה' }),
    ]

    expect(ambiguousFactIds(facts)).toEqual(new Set(['f1', 'f2']))
  })

  it('is case- and whitespace-insensitive, and never flags a duplicate within one contact', () => {
    const facts = [
      fact({ id: 'f1', contactId: 'c1', rawText: 'q: שניצל' }),
      fact({ id: 'f2', contactId: 'c1', rawText: 'q:   שניצל  ' }),
    ]

    // Same contact, same underlying text - not a cross-person collision, so
    // neither is ambiguous.
    expect(ambiguousFactIds(facts)).toEqual(new Set())
  })
})

describe('selectSecondGameFact', () => {
  it('never returns a fact flagged as ambiguous', () => {
    const facts = [
      fact({ id: 'f1', contactId: 'c1', rawText: 'dup' }),
      fact({ id: 'f2', contactId: 'c2', rawText: 'dup' }),
      fact({ id: 'f3', contactId: 'c3', rawText: 'unique' }),
    ]

    const chosen = selectSecondGameFact(facts, () => 0)
    expect(chosen?.id).toBe('f3')
  })

  it('returns null when every fact is ambiguous', () => {
    const facts = [
      fact({ id: 'f1', contactId: 'c1', rawText: 'dup' }),
      fact({ id: 'f2', contactId: 'c2', rawText: 'dup' }),
    ]

    expect(selectSecondGameFact(facts)).toBeNull()
  })

  it('returns null for an empty pool', () => {
    expect(selectSecondGameFact([])).toBeNull()
  })

  // The fairness problem Nitzan raised 2026-09-28: a contact with many stored
  // facts must not be drawn more often than one with few, purely because
  // there is more of their material. Two draws (contact, then fact) fixes
  // this - proven here by making every "which contact" draw land on the
  // second slot and checking it always lands on the person with ONE fact,
  // never on the one with many.
  it('weighs contacts equally, not by how many facts each one has', () => {
    const facts = [
      fact({ id: 'many-1', contactId: 'many', rawText: 'm1' }),
      fact({ id: 'many-2', contactId: 'many', rawText: 'm2' }),
      fact({ id: 'many-3', contactId: 'many', rawText: 'm3' }),
      fact({ id: 'few-1', contactId: 'few', rawText: 'f1' }),
    ]

    // Two distinct contacts ('many', 'few'); asking for "the second one" by
    // always returning a value just under 1 must land on 'few', never
    // re-weighted toward 'many' by its extra facts.
    const chosen = selectSecondGameFact(facts, () => 0.9999)
    expect(chosen?.contactId).toBe('few')
  })

  it('prefers a contact’s least-used fact', () => {
    const facts = [
      fact({ id: 'used', contactId: 'c1', rawText: 'a', useCount: 3 }),
      fact({ id: 'fresh', contactId: 'c1', rawText: 'b', useCount: 0 }),
    ]

    const chosen = selectSecondGameFact(facts, () => 0)
    expect(chosen?.id).toBe('fresh')
  })
})
