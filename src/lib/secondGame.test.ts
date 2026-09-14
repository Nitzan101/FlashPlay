/**
 * Client-contract tests for secondGame.ts, run against the rules emulator.
 *
 * The claim that matters here is DESIGN's: "Most likely to" is built from
 * items the first game **revealed**, and never from one it did not - an
 * unrevealed item would make "who is most likely to do this" the same
 * question as "who wrote this", and the two games would collapse into one.
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openVoting, castVote, getMyVote, revealRound } from './rounds'
import { endGathering, openNextSecondRound, scoreMajority, startSecondGame } from './secondGame'
import { type GameDoc, type RoundDoc, type SessionDoc } from './model'

const PROJECT_ID = 'demo-flashplay-second'
const SESSION = 'session1'
const FIRST_GAME = 'game1'
const HOST = 'host-uid'
const PLAYER = 'player-uid'
const THIRD = 'third-uid'
const PROMPT = 'p1'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

/** A gathering whose first game is over: one item was revealed during it, one
 *  never got a round. That asymmetry is the point of this suite. */
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, `sessions/${SESSION}`), {
      roomCode: 'ABCD',
      hostUid: HOST,
      groupId: null,
      phase: 'playing',
      currentGameId: FIRST_GAME,
      scores: {},
      createdAt: 0,
      expiresAt: 0,
    })
    for (const [uid, name] of [
      [HOST, 'Host'],
      [PLAYER, 'Player'],
      [THIRD, 'Third'],
    ]) {
      await setDoc(doc(db, `sessions/${SESSION}/players/${uid}`), {
        name,
        uid,
        hasDevice: true,
        lastSeenAt: 0,
        joinedAt: 0,
        votedRoundId: null,
      })
    }
    await setDoc(doc(db, `sessions/${SESSION}/games/${FIRST_GAME}`), {
      type: 'who-said-that',
      phase: 'done',
      promptIds: [PROMPT, 'p2'],
      order: 0,
      startedAt: 0,
      phaseEndsAt: 0,
    })
    for (const [itemId, revealed] of [
      ['revealed-item', true],
      ['never-played', false],
    ] as const) {
      await setDoc(doc(db, `sessions/${SESSION}/items/${itemId}`), {
        gameId: FIRST_GAME,
        text: `text of ${itemId}`,
        promptId: PROMPT,
        revealed,
        createdAt: 0,
      })
      await setDoc(doc(db, `sessions/${SESSION}/itemAuthors/${itemId}`), {
        authorPlayerId: PLAYER,
        gameId: FIRST_GAME,
        promptId: PROMPT,
      })
    }
  })
})

const asHost = () =>
  testEnv
    .authenticatedContext(HOST, { firebase: { sign_in_provider: 'google.com' } })
    .firestore() as unknown as Firestore
const asPlayer = () =>
  testEnv
    .authenticatedContext(PLAYER, { firebase: { sign_in_provider: 'anonymous' } })
    .firestore() as unknown as Firestore
const asThird = () =>
  testEnv
    .authenticatedContext(THIRD, { firebase: { sign_in_provider: 'anonymous' } })
    .firestore() as unknown as Firestore

describe('startSecondGame', () => {
  it('opens a game that begins in its round loop, with no prompts of its own', async () => {
    const gameId = await startSecondGame(asHost(), SESSION, 1, () => 'game2')

    const game = (await getDoc(doc(asHost(), `sessions/${SESSION}/games/game2`))).data() as GameDoc
    expect(gameId).toBe('game2')
    expect(game.type).toBe('most-likely-to')
    expect(game.phase).toBe('rounds')
    expect(game.promptIds).toEqual([])

    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.currentGameId).toBe('game2')
  })

  it('refuses a non-host', async () => {
    await expect(startSecondGame(asPlayer(), SESSION, 1, () => 'game2')).rejects.toThrow()
  })

  // The rules pair each game type with the only phase that makes sense for
  // it, so a second game cannot be smuggled in as a harvest, and the first
  // game cannot skip its harvest.
  it('refuses a most-likely-to game that tries to start with prompts, or in harvesting', async () => {
    await assertFails(
      setDoc(doc(asHost(), `sessions/${SESSION}/games/bad1`), {
        type: 'most-likely-to',
        phase: 'harvesting',
        promptIds: [],
        order: 1,
        startedAt: 0,
        phaseEndsAt: 0,
      }),
    )
    await assertFails(
      setDoc(doc(asHost(), `sessions/${SESSION}/games/bad2`), {
        type: 'most-likely-to',
        phase: 'rounds',
        promptIds: [PROMPT, 'p2'],
        order: 1,
        startedAt: 0,
        phaseEndsAt: 0,
      }),
    )
  })
})

describe('openNextSecondRound', () => {
  beforeEach(async () => {
    await startSecondGame(asHost(), SESSION, 1, () => 'game2')
  })

  // The whole design of the second game rests on this one line - so the draw
  // is made deterministic. With the real Math.random this assertion passed
  // roughly half the time when the revealed-only filter was deleted, which
  // makes it a coin flip rather than a guard (found reviewing the review).
  // `() => 0` takes the first document by id, which is the UNREVEALED one.
  it('only ever draws an item the first game revealed', async () => {
    const roundId = await openNextSecondRound(
      asHost(),
      SESSION,
      'game2',
      () => 'g2r0',
      () => 0,
    )

    const round = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/g2r0`))).data() as RoundDoc
    expect(roundId).toBe('g2r0')
    expect(round.itemId).toBe('revealed-item')
    expect(round.gameId).toBe('game2')
  })

  it('runs out when every revealed item has had its turn', async () => {
    await openNextSecondRound(asHost(), SESSION, 'game2', () => 'g2r0')

    expect(await openNextSecondRound(asHost(), SESSION, 'game2', () => 'g2r1')).toBeNull()
  })

  it('picks up an item revealed later in the same evening', async () => {
    await openNextSecondRound(asHost(), SESSION, 'game2', () => 'g2r0')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}/items/never-played`), {
        revealed: true,
      })
    })

    expect(await openNextSecondRound(asHost(), SESSION, 'game2', () => 'g2r1')).toBe('g2r1')
  })

  it('refuses a non-host', async () => {
    await expect(
      openNextSecondRound(asPlayer(), SESSION, 'game2', () => 'g2r0'),
    ).rejects.toThrow()
  })
})

describe('a "most likely to" round, end to end', () => {
  beforeEach(async () => {
    await startSecondGame(asHost(), SESSION, 1, () => 'game2')
    await openNextSecondRound(asHost(), SESSION, 'game2', () => 'g2r0')
    await openVoting(asHost(), SESSION, 'g2r0')
  })

  it('keeps the votes private until the reveal, then pays the majority', async () => {
    await castVote(asHost(), SESSION, 'g2r0', HOST, THIRD)
    await castVote(asPlayer(), SESSION, 'g2r0', PLAYER, THIRD)
    await castVote(asThird(), SESSION, 'g2r0', THIRD, HOST)

    await assertFails(getDoc(doc(asThird(), `sessions/${SESSION}/rounds/g2r0/votes/${HOST}`)))

    const summary = await revealRound(asHost(), SESSION, 'g2r0', scoreMajority)

    // Two votes for THIRD, one for HOST: the two who read the room are paid,
    // and there is no "correct" answer to pay anyone else for.
    expect(summary.awarded).toEqual({ [HOST]: 1, [PLAYER]: 1 })
    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.scores).toEqual({ [HOST]: 1, [PLAYER]: 1 })
  })

  it('adds the second game’s points to what the first game already paid', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      // A first-game round that paid HOST two points, exactly as revealRound
      // would have recorded it.
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/rounds/g1r0`), {
        gameId: FIRST_GAME,
        itemId: 'revealed-item',
        phase: 'revealed',
        order: 0,
        startedAt: 0,
        awarded: { [HOST]: 2 },
      })
    })
    await castVote(asHost(), SESSION, 'g2r0', HOST, THIRD)

    await revealRound(asHost(), SESSION, 'g2r0', scoreMajority)

    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.scores[HOST]).toBe(3)
  })
})

describe('the game type is pinned once a game exists', () => {
  // The vote guard keys off the game's type (a "most likely to" round is
  // allowed to vote on a revealed item; a "who said that" round is not), so
  // the type became part of the security boundary the moment that narrowing
  // landed. Without this, the host could flip the type, read an author while
  // voting was still open, and flip it back with nothing recording it.
  it('refuses to change a game’s type after it has started', async () => {
    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}/games/${FIRST_GAME}`), {
        type: 'most-likely-to',
      }),
    )
  })

  it('still lets the host drive the phase', async () => {
    await assertSucceeds(
      updateDoc(doc(asHost(), `sessions/${SESSION}/games/${FIRST_GAME}`), { phase: 'rounds' }),
    )
  })
})

describe('self-votes follow the game, not one global rule', () => {
  beforeEach(async () => {
    await startSecondGame(asHost(), SESSION, 1, () => 'game2')
    await openNextSecondRound(asHost(), SESSION, 'game2', () => 'g2r0', () => 0)
    await openVoting(asHost(), SESSION, 'g2r0')
  })

  // "Me" is an honest answer to "who is most likely to", and the author of
  // the item under discussion is the likeliest pick of all - barring them
  // would exclude one named person from the scoring every round.
  it('allows a self-vote in "most likely to"', async () => {
    await castVote(asThird(), SESSION, 'g2r0', THIRD, THIRD)

    expect(await getMyVote(asThird(), SESSION, 'g2r0', THIRD)).toBe(THIRD)
  })

  // And still refuses one in the first game, where abstaining or voting for
  // yourself is exactly what would mark the author out.
  it('refuses a self-vote in "who said that"', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await updateDoc(doc(db, `sessions/${SESSION}/games/${FIRST_GAME}`), { phase: 'rounds' })
      await setDoc(doc(db, `sessions/${SESSION}/rounds/g1r0`), {
        gameId: FIRST_GAME,
        itemId: 'never-played',
        phase: 'voting',
        order: 0,
        startedAt: 0,
      })
    })

    await expect(castVote(asThird(), SESSION, 'g1r0', THIRD, THIRD)).rejects.toThrow()
  })
})

describe('endGathering', () => {
  it('lets the host close the evening, and nobody else', async () => {
    await expect(endGathering(asPlayer(), SESSION)).rejects.toThrow()

    await endGathering(asHost(), SESSION)
    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.phase).toBe('finished')
  })

  it('cannot be undone - the gathering’s phase only moves forward', async () => {
    await endGathering(asHost(), SESSION)

    await assertFails(updateDoc(doc(asHost(), `sessions/${SESSION}`), { phase: 'playing' }))
  })
})
