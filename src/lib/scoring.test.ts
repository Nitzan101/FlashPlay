/**
 * The two games' scoring arithmetic, tested without an emulator because it is
 * pure. The emulator suites prove the writes are legal and land in the right
 * order; these prove the numbers are right, including the cases a live game
 * produces rarely and a family would notice immediately.
 */
import { describe, expect, it } from 'vitest'
import { scoreRound } from './rounds'
import { mostVotedPlayers, scoreMajority } from './secondGame'

const AUTHOR = 'author'
const A = 'a'
const B = 'b'
const C = 'c'

describe('scoreRound - "who said that"', () => {
  it('pays eight for a correct guess', () => {
    expect(scoreRound({ [A]: AUTHOR }, AUTHOR)).toEqual({ [A]: 8 })
  })

  // Removed 2026-09-27: the author used to earn a point per fooled voter.
  // Nitzan's call - it rewarded writing an answer that does not fit you.
  it('pays the author nothing for a fooled voter', () => {
    expect(scoreRound({ [A]: B, [B]: C }, AUTHOR)).toEqual({})
  })

  // The author votes for someone else purely so that not voting would not
  // give them away, so their own vote must not pay them - in either
  // direction, including the perverse case of voting for themselves (which
  // the rules refuse anyway).
  it('ignores the author’s own vote', () => {
    expect(scoreRound({ [AUTHOR]: A }, AUTHOR)).toEqual({})
    expect(scoreRound({ [AUTHOR]: AUTHOR }, AUTHOR)).toEqual({})
  })

  it('pays nothing for a round nobody voted in', () => {
    expect(scoreRound({}, AUTHOR)).toEqual({})
  })

  it('pays only the correct guessers, ignoring the fooled ones', () => {
    expect(scoreRound({ [A]: AUTHOR, [B]: C, [AUTHOR]: A }, AUTHOR)).toEqual({
      [A]: 8,
    })
  })
})

describe('scoreMajority - "most likely to"', () => {
  it('pays everyone who voted with the majority', () => {
    expect(scoreMajority({ [A]: C, [B]: C, [AUTHOR]: A })).toEqual({ [A]: 4, [B]: 4 })
  })

  // A three-way split is the round the room disagreed about most, which is
  // the last one that should score nobody.
  it('treats a tie as a majority for everyone in it', () => {
    expect(scoreMajority({ [A]: B, [B]: C })).toEqual({ [A]: 4, [B]: 4 })
  })

  it('pays nothing when nobody voted', () => {
    expect(scoreMajority({})).toEqual({})
  })
})

describe('mostVotedPlayers - who owes the room a sentence', () => {
  it('names the one the room picked', () => {
    expect(mostVotedPlayers({ [A]: C, [B]: C, [C]: A })).toEqual([C])
  })

  it('names everyone when the vote ties', () => {
    expect(mostVotedPlayers({ [A]: B, [B]: A }).sort()).toEqual([A, B])
  })

  it('names nobody when nobody voted', () => {
    expect(mostVotedPlayers({})).toEqual([])
  })
})
