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
  it('pays two for a correct guess', () => {
    expect(scoreRound({ [A]: AUTHOR }, AUTHOR)).toEqual({ [A]: 2 })
  })

  it('pays the author one for each voter they fooled', () => {
    expect(scoreRound({ [A]: B, [B]: C }, AUTHOR)).toEqual({ [AUTHOR]: 2 })
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

  it('mixes both directions in one round', () => {
    expect(scoreRound({ [A]: AUTHOR, [B]: C, [AUTHOR]: A }, AUTHOR)).toEqual({
      [A]: 2,
      [AUTHOR]: 1,
    })
  })
})

describe('scoreMajority - "most likely to"', () => {
  it('pays everyone who voted with the majority', () => {
    expect(scoreMajority({ [A]: C, [B]: C, [AUTHOR]: A })).toEqual({ [A]: 1, [B]: 1 })
  })

  // A three-way split is the round the room disagreed about most, which is
  // the last one that should score nobody.
  it('treats a tie as a majority for everyone in it', () => {
    expect(scoreMajority({ [A]: B, [B]: C })).toEqual({ [A]: 1, [B]: 1 })
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
