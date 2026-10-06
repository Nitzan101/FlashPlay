/**
 * "Who answered what" - the pure parts, tested without an emulator: counting
 * lobby answers, the selection policy (balance, with a tested probability and
 * rng injection point like `selectSecondGameFact`), who counts as a candidate,
 * and the scoring arithmetic. The emulator suite (whoAnsweredWhat.test.ts)
 * proves the writes are legal and that nobody can read the truth early.
 */
import { describe, expect, it } from 'vitest'
import {
  CHOICE_QUESTIONS,
  LOPSIDED_ROUND_PROBABILITY,
  answerValues,
  candidateIds,
  classificationsCorrect,
  computeAnswerStats,
  eligibleQuestions,
  scoreWhoAnsweredWhat,
  selectWhoAnsweredWhatRound,
  type QuestionAnswerStats,
} from './whoAnsweredWhat'

/** A deterministic stream: each call returns the next value, then repeats the last. */
function stream(...values: number[]) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

/** A small seeded generator (mulberry32) for the statistical checks. */
function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const stats = (
  questionId: string,
  answerers: number,
  choosers: Record<string, number>,
): QuestionAnswerStats => ({ questionId, answerers, choosers })

describe('answerValues', () => {
  it('reads a single-choice string, a multi-choice list and the free "other" text alike', () => {
    expect(answerValues('חיית לילה')).toEqual(['חיית לילה'])
    expect(answerValues([' קיץ ', '', 'משהו אחר'])).toEqual(['קיץ', 'משהו אחר'])
    expect(answerValues('   ')).toEqual([])
    expect(answerValues([])).toEqual([])
    expect(answerValues(undefined)).toEqual([])
  })
})

describe('computeAnswerStats', () => {
  const question = CHOICE_QUESTIONS.find((q) => q.id === 'season')!

  it('counts answerers and choosers per option, with every option present', () => {
    const result = computeAnswerStats(
      {
        a: { season: 'קיץ' },
        b: { season: 'קיץ' },
        c: { season: 'חורף' },
        d: {},
      },
      [question],
    )
    expect(result).toEqual([
      { questionId: 'season', answerers: 3, choosers: { חורף: 1, אביב: 0, קיץ: 2, סתיו: 0 } },
    ])
  })

  // Whoever typed only the "other" chip still answered - they chose none of
  // the options, which is a real, usable fact for this game.
  it('counts a free-text-only answer as an answerer who chose no option', () => {
    const [result] = computeAnswerStats({ a: { season: 'יום גשום' }, b: { season: 'קיץ' } }, [question])
    expect(result.answerers).toBe(2)
    expect(result.choosers['קיץ']).toBe(1)
  })

  it('counts a multi-choice answer once per chosen option', () => {
    const multi = CHOICE_QUESTIONS.find((q) => q.id === 'music')!
    const [result] = computeAnswerStats(
      { a: { music: ['פופ', 'רוק'] }, b: { music: ['פופ'] } },
      [multi],
    )
    expect(result.answerers).toBe(2)
    expect(result.choosers['פופ']).toBe(2)
    expect(result.choosers['רוק']).toBe(1)
  })

  it('covers only choice questions, never a text one', () => {
    expect(CHOICE_QUESTIONS.length).toBeGreaterThan(0)
    expect(CHOICE_QUESTIONS.every((q) => q.kind !== 'text' && (q.options?.length ?? 0) > 0)).toBe(true)
  })
})

describe('eligibleQuestions', () => {
  it('needs three lobby answerers and drops a question already asked', () => {
    const all = [
      stats('few', 2, { x: 1, y: 1 }),
      stats('enough', 3, { x: 1, y: 2 }),
      stats('asked', 5, { x: 2, y: 3 }),
    ]
    expect(eligibleQuestions(all, new Set(['asked'])).map((q) => q.questionId)).toEqual(['enough'])
  })
})

describe('selectWhoAnsweredWhatRound', () => {
  const split = stats('split', 6, { a: 3, b: 3, c: 0 })
  const unanimous = stats('unanimous', 4, { yes: 4, no: 0 })

  it('prefers an option with at least one chooser and one non-chooser', () => {
    // 0.9 >= 0.2: not the lopsided draw. Question draw 0, then option draw 0.
    const pick = selectWhoAnsweredWhatRound([split], [], stream(0.9, 0, 0))
    expect(pick).toEqual({ questionId: 'split', option: 'a' })
  })

  // Never an option nobody chose when a real split exists in the same draw.
  it('never returns a lopsided option from the split draw', () => {
    const random = seeded(7)
    for (let i = 0; i < 300; i++) {
      const pick = selectWhoAnsweredWhatRound([split], [], () => 0.5 + random() / 2)
      expect(['a', 'b']).toContain(pick!.option)
    }
  })

  it('draws a lopsided option when the first draw falls under the probability', () => {
    const pick = selectWhoAnsweredWhatRound([split], [], stream(0.1, 0, 0))
    expect(pick).toEqual({ questionId: 'split', option: 'c' })
  })

  it('falls back to a split when asked for lopsided and none exists, and the reverse', () => {
    const onlySplit = stats('onlySplit', 4, { a: 2, b: 2 })
    expect(selectWhoAnsweredWhatRound([onlySplit], [], stream(0.0, 0, 0))).toEqual({
      questionId: 'onlySplit',
      option: 'a',
    })
    // Everyone chose it: the only thing available is lopsided.
    expect(selectWhoAnsweredWhatRound([unanimous], [], stream(0.9, 0, 0))).toEqual({
      questionId: 'unanimous',
      option: 'yes',
    })
  })

  it('weights a more even split above a lopsided one without excluding either', () => {
    const q = stats('q', 25, { even: 12, thin: 1 })
    // weights 12 and 1 of 13: a ticket below 12/13 picks "even".
    expect(selectWhoAnsweredWhatRound([q], [], stream(0.9, 0, 0.9))?.option).toBe('even')
    expect(selectWhoAnsweredWhatRound([q], [], stream(0.9, 0, 0.99))?.option).toBe('thin')
  })

  it('never repeats a question already asked this gathering', () => {
    const other = stats('other', 5, { a: 2, b: 3 })
    const random = seeded(11)
    for (let i = 0; i < 100; i++) {
      expect(selectWhoAnsweredWhatRound([split, other], ['split'], random)?.questionId).toBe('other')
    }
    expect(selectWhoAnsweredWhatRound([split], ['split'], seeded(1))).toBeNull()
  })

  it('needs three lobby answerers, however split the answers are', () => {
    expect(selectWhoAnsweredWhatRound([stats('two', 2, { a: 1, b: 1 })], [], seeded(3))).toBeNull()
  })

  it('draws the question uniformly before the option', () => {
    const wide = stats('wide', 6, { a: 3, b: 3, c: 3, d: 3, e: 3, f: 3 })
    const narrow = stats('narrow', 6, { x: 3, y: 3 })
    const random = seeded(5)
    let wideCount = 0
    for (let i = 0; i < 2000; i++) {
      if (selectWhoAnsweredWhatRound([wide, narrow], [], random, 0)?.questionId === 'wide') wideCount++
    }
    // Uniform over two questions, not over eight options.
    expect(wideCount / 2000).toBeGreaterThan(0.45)
    expect(wideCount / 2000).toBeLessThan(0.55)
  })

  // The owner's balance requirement, stated as a measurable property: about
  // one round in five is lopsided and the rest are real splits.
  it('is lopsided about one round in five when both kinds exist', () => {
    expect(LOPSIDED_ROUND_PROBABILITY).toBe(0.2)
    const mixed = stats('mixed', 8, { a: 4, b: 4, c: 0, d: 8 })
    const random = seeded(2026)
    let lopsided = 0
    const rounds = 4000
    for (let i = 0; i < rounds; i++) {
      const pick = selectWhoAnsweredWhatRound([mixed], [], random)!
      if (pick.option === 'c' || pick.option === 'd') lopsided++
    }
    expect(lopsided / rounds).toBeGreaterThan(0.17)
    expect(lopsided / rounds).toBeLessThan(0.23)
  })

  it('returns null when nothing is eligible at all', () => {
    expect(selectWhoAnsweredWhatRound([], [], seeded(1))).toBeNull()
  })
})

describe('candidateIds', () => {
  const player = (id: string, extra: Partial<{ hasDevice: boolean; leftAt: number | null }> = {}) => ({
    id,
    hasDevice: true,
    leftAt: null,
    ...extra,
  })

  it('is the players whose marker says they answered', () => {
    expect(
      candidateIds(
        { a: { answered: true }, b: { answered: false } },
        [player('a'), player('b'), player('c')],
      ),
    ).toEqual(['a'])
  })

  it('leaves out a player without a device and a player who has left, marker or not', () => {
    const participants = { a: { answered: true }, b: { answered: true }, c: { answered: true } }
    expect(
      candidateIds(participants, [
        player('a'),
        player('b', { hasDevice: false }),
        player('c', { leftAt: 123 }),
      ]),
    ).toEqual(['a'])
  })

  it('ignores a marker for somebody who is not in the roster', () => {
    expect(candidateIds({ ghost: { answered: true } }, [player('a')])).toEqual([])
  })
})

describe('scoring - one point per OTHER player classified correctly', () => {
  const chose = { a: true, b: false, c: true, d: false }

  it('pays marked-and-chose and unmarked-and-did-not alike', () => {
    // g marks a and b: a correct, b wrong; c missed (wrong); d unmarked (right).
    expect(scoreWhoAnsweredWhat({ g: ['a', 'b'] }, chose)).toEqual({ g: 2 })
  })

  it('pays a perfect guess for every candidate', () => {
    expect(scoreWhoAnsweredWhat({ g: ['a', 'c'] }, chose)).toEqual({ g: 4 })
  })

  it('never scores a guesser about themselves, marked or not', () => {
    // a guesses; a's own entry is skipped, so the three others are scored:
    // b unmarked (right), c marked (right), d unmarked (right).
    expect(scoreWhoAnsweredWhat({ a: ['c'] }, chose)).toEqual({ a: 3 })
    // Even a (malformed) self-mark cannot buy a point.
    expect(scoreWhoAnsweredWhat({ a: ['a', 'c'] }, chose)).toEqual({ a: 3 })
  })

  // The consequence the owner accepted: marking nobody scores the share who
  // did not choose it - and when nobody chose the option, that is everyone.
  it('pays marking nobody the share who did not choose it', () => {
    expect(scoreWhoAnsweredWhat({ g: [] }, chose)).toEqual({ g: 2 })
  })

  it('pays everyone for marking nobody when nobody chose the option', () => {
    const nobody = { a: false, b: false, c: false }
    expect(scoreWhoAnsweredWhat({ g: [], h: [] }, nobody)).toEqual({ g: 3, h: 3 })
    expect(scoreWhoAnsweredWhat({ g: ['a'] }, nobody)).toEqual({ g: 2 })
  })

  it('gives a non-candidate guesser a score too, and ignores marks on non-candidates', () => {
    expect(scoreWhoAnsweredWhat({ outsider: ['a', 'zzz'] }, chose)).toEqual({ outsider: 3 })
  })

  it('pays nothing for a guess that was entirely wrong, and nothing to whoever sent none', () => {
    expect(scoreWhoAnsweredWhat({ g: ['b', 'd'] }, chose)).toEqual({})
    expect(scoreWhoAnsweredWhat({}, chose)).toEqual({})
  })

  it('reports correct out of total, excluding the guesser', () => {
    expect(classificationsCorrect('a', ['c'], chose)).toEqual({ correct: 3, total: 3 })
    expect(classificationsCorrect('outsider', ['a'], chose)).toEqual({ correct: 3, total: 4 })
  })
})
