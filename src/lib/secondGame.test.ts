/**
 * Client-contract tests for secondGame.ts, run against the rules emulator.
 *
 * Redesigned 2026-09-28: "most likely to" no longer reuses items the first
 * game revealed - it draws a fact from the group's stored memory (`FactDoc`,
 * milestone 7) and never names who it was really about. See secondGame.ts's
 * module comment for why the old design (naming the real author) collapsed
 * into "who wrote this" the moment the room already knew the answer. The
 * claim that matters here is the new one: a round's item comes from the
 * host's private store, is created already revealed with no matching
 * `ItemAuthorDoc` at all, never repeats a fact within one gathering, and
 * skips a fact two different contacts recorded identically.
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
import {
  describeSecondGamePool,
  endGathering,
  openNextSecondRound,
  scoreMajority,
  startSecondGame,
} from './secondGame'
import { type FactDoc, type GameDoc, type ItemAuthorDoc, type RoundDoc, type SessionDoc } from './model'

const PROJECT_ID = 'demo-flashplay-second'
const SESSION = 'session1'
const FIRST_GAME = 'game1'
const HOST = 'host-uid'
const PLAYER = 'player-uid'
const THIRD = 'third-uid'

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

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, `sessions/${SESSION}`), {
      roomCode: 'ABCD',
      hostUid: HOST,
      originalHostUid: HOST,
      groupId: null,
      phase: 'playing',
      currentGameId: FIRST_GAME,
      contactIds: {},
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
      promptIds: ['p1', 'p2'],
      order: 0,
      startedAt: 0,
      phaseEndsAt: 0,
    })
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

/** Seeds one contact with one fact, bypassing rules - the shape
 *  `users/{HOST}/contacts/{contactId}/facts/{factId}` already covered by the
 *  blanket owner-only rule under `users/{uid}`. */
async function seedFact(
  contactId: string,
  factId: string,
  text: string,
  useCount = 0,
  promptId?: string,
) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fact: FactDoc = {
      text,
      authorContactId: contactId,
      useCount,
      sessionId: '',
      createdAt: 0,
      ...(promptId ? { promptId } : {}),
    }
    await setDoc(doc(ctx.firestore(), `users/${HOST}/contacts/${contactId}/facts/${factId}`), fact)
  })
}

async function setContactIds(contactIds: Record<string, string>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}`), { contactIds })
  })
}

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
        promptIds: ['p1', 'p2'],
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

  it('draws a fact from the group’s stored memory as an already-revealed item, with no author claim', async () => {
    await seedFact('contact-a', 'fact-a1', 'a fact nobody in the room has heard tonight')
    await setContactIds({ [PLAYER]: 'contact-a' })

    const roundId = await openNextSecondRound(
      asHost(),
      HOST,
      SESSION,
      'game2',
      () => 'g2r0',
      () => 0,
      () => 'item-x',
    )

    expect(roundId).toBe('g2r0')
    const round = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/g2r0`))).data() as RoundDoc
    expect(round.itemId).toBe('item-x')

    const item = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/item-x`))).data()!
    expect(item.revealed).toBe(true)
    expect(item.sourceFactId).toBe('fact-a1')
    expect(item.text as string).toContain('a fact nobody in the room has heard tonight')

    // No author to hide - so unlike a harvest item, this one never gets a
    // matching claim, and the host cannot even read one that was never
    // written (get on a nonexistent doc where rules allow the read).
    const authorSnap = await getDoc(doc(asHost(), `sessions/${SESSION}/itemAuthors/item-x`))
    expect(authorSnap.exists()).toBe(false)
  })

  it('increments the chosen fact’s useCount in the host’s own store', async () => {
    await seedFact('contact-a', 'fact-a1', 'text')
    await setContactIds({ [PLAYER]: 'contact-a' })

    await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r0', () => 0)

    const fact = (
      await getDoc(doc(asHost(), `users/${HOST}/contacts/contact-a/facts/fact-a1`))
    ).data() as FactDoc
    expect(fact.useCount).toBe(1)
  })

  it('never repeats a fact within the same gathering, and runs out once every fact is spent', async () => {
    await seedFact('contact-a', 'fact-a1', 'fact about A')
    await seedFact('contact-b', 'fact-b1', 'fact about B')
    await setContactIds({ [PLAYER]: 'contact-a', [THIRD]: 'contact-b' })

    const round1 = await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r0', () => 0)
    const item1 = (
      await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/${round1}`))
    ).data() as RoundDoc
    const first = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/${item1.itemId}`))).data()!
    expect(first.sourceFactId).toBe('fact-a1')

    const round2 = await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r1', () => 0)
    const item2 = (
      await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/${round2}`))
    ).data() as RoundDoc
    const second = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/${item2.itemId}`))).data()!
    // The only unspent fact left is contact-b's, regardless of the random
    // draw - fact-a1 is now excluded by sourceFactId, not by chance.
    expect(second.sourceFactId).toBe('fact-b1')

    expect(await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r2')).toBeNull()
  })

  it('skips a fact two different contacts recorded identically, and asks about the unique one instead', async () => {
    await seedFact('contact-a', 'fact-a1', 'שניצל')
    await seedFact('contact-b', 'fact-b1', 'שניצל')
    await seedFact('contact-c', 'fact-c1', 'a genuinely unique fact')
    await setContactIds({ [HOST]: 'contact-a', [PLAYER]: 'contact-b', [THIRD]: 'contact-c' })

    const roundId = await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r0', () => 0)
    const round = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/${roundId}`))).data() as RoundDoc
    const item = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/${round.itemId}`))).data()!

    expect(item.sourceFactId).toBe('fact-c1')
  })

  it('returns null with no contacts yet, rather than reading a nonexistent group', async () => {
    expect(await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r0')).toBeNull()
  })

  it('refuses a non-host', async () => {
    await seedFact('contact-a', 'fact-a1', 'text')
    await setContactIds({ [PLAYER]: 'contact-a' })

    await expect(
      openNextSecondRound(asPlayer(), HOST, SESSION, 'game2', () => 'g2r0'),
    ).rejects.toThrow()
  })
})

describe('a "most likely to" round, end to end', () => {
  beforeEach(async () => {
    await startSecondGame(asHost(), SESSION, 1, () => 'game2')
    await seedFact('contact-a', 'fact-a1', 'text')
    await setContactIds({ [PLAYER]: 'contact-a' })
    await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r0', () => 0)
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
        itemId: 'some-item',
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

describe('planning the rounds from what the memory holds', () => {
  beforeEach(async () => {
    await startSecondGame(asHost(), SESSION, 1, () => 'game2')
  })

  it('records the real total on the first round, never above what the memory can supply', async () => {
    await seedFact('contact-a', 'fact-a1', 'fact about A')
    await seedFact('contact-b', 'fact-b1', 'fact about B')
    await seedFact('contact-b', 'fact-b2', 'another fact about B')
    await setContactIds({ [PLAYER]: 'contact-a', [THIRD]: 'contact-b' })

    await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r0', () => 0)
    await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r1', () => 0)

    const game = (await getDoc(doc(asHost(), `sessions/${SESSION}/games/game2`))).data() as GameDoc
    // Counted before the first round spent a fact, and not rewritten by the second.
    expect(game.plannedRounds).toBe(3)
  })

  it('describes how many questions there are and who has contributed nothing at all', async () => {
    await seedFact('contact-a', 'fact-a1', 'fact about A')
    await setContactIds({ [PLAYER]: 'contact-a', [THIRD]: 'contact-b' })

    const pool = await describeSecondGamePool(asHost(), HOST, SESSION, 'game2')

    expect(pool.available).toBe(1)
    expect(pool.playersWithoutFacts).toEqual([THIRD])
  })

  // A choice answer ("העונה האהובה עליך: קיץ") describes no behaviour and many
  // people give the same one, so it is never a question - and a person who has
  // only answered choice questions has contributed nothing the game can use.
  it('leaves choice-question answers out of the pool and out of who has contributed', async () => {
    await seedFact('contact-a', 'fact-a1', 'העונה האהובה עליך: קיץ', 0, 'season')
    await seedFact('contact-b', 'fact-b1', 'fact about B')
    await setContactIds({ [PLAYER]: 'contact-a', [THIRD]: 'contact-b' })

    const pool = await describeSecondGamePool(asHost(), HOST, SESSION, 'game2')

    expect(pool.available).toBe(1)
    expect(pool.playersWithoutFacts).toEqual([PLAYER])
  })

  it('does not count a fact two people recorded identically', async () => {
    await seedFact('contact-a', 'fact-a1', 'same thing')
    await seedFact('contact-b', 'fact-b1', 'Same  thing')
    await seedFact('contact-b', 'fact-b2', 'a different thing')
    await setContactIds({ [PLAYER]: 'contact-a', [THIRD]: 'contact-b' })

    const pool = await describeSecondGamePool(asHost(), HOST, SESSION, 'game2')

    expect(pool.available).toBe(1)
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

describe('a memory-sourced item can only be created for a game actually in that shape', () => {
  // Mutation-checked 2026-09-28: dropping `isHost(sessionId)` turned exactly
  // x4 red; dropping the `type`/`phase` clauses turned exactly x2 red - each
  // time only the one assertion built to isolate that clause, nothing else
  // in the suite.
  it('refuses a non-host, a harvest-game item, or one created before the round loop opens', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/x1`), {
        gameId: FIRST_GAME,
        text: 'q',
        promptId: 'memory',
        revealed: true,
        createdAt: 0,
      }),
    )
    await assertFails(
      setDoc(doc(asHost(), `sessions/${SESSION}/items/x2`), {
        gameId: FIRST_GAME,
        text: 'q',
        promptId: 'memory',
        revealed: true,
        createdAt: 0,
      }),
    )

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/games/game2`), {
        type: 'most-likely-to',
        phase: 'rounds',
        promptIds: [],
        order: 1,
        startedAt: 0,
        phaseEndsAt: 0,
      })
    })
    await assertSucceeds(
      setDoc(doc(asHost(), `sessions/${SESSION}/items/x3`), {
        gameId: 'game2',
        text: 'q',
        promptId: 'memory',
        revealed: true,
        createdAt: 0,
      }),
    )

    // Same game, same shape as the one that just succeeded - only the caller
    // differs. Isolates the host-only clause from the type/phase clauses
    // above it, which x1 alone does not (x1 is also the wrong type).
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/x4`), {
        gameId: 'game2',
        text: 'q',
        promptId: 'memory',
        revealed: true,
        createdAt: 0,
      }),
    )
  })
})

describe('self-votes follow the game, not one global rule', () => {
  beforeEach(async () => {
    await startSecondGame(asHost(), SESSION, 1, () => 'game2')
    await seedFact('contact-a', 'fact-a1', 'text')
    await setContactIds({ [PLAYER]: 'contact-a' })
    await openNextSecondRound(asHost(), HOST, SESSION, 'game2', () => 'g2r0', () => 0)
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
      await setDoc(doc(db, `sessions/${SESSION}/items/never-played`), {
        gameId: FIRST_GAME,
        text: 'text',
        promptId: 'p1',
        revealed: false,
        createdAt: 0,
      })
      await setDoc(doc(db, `sessions/${SESSION}/itemAuthors/never-played`), {
        authorPlayerId: PLAYER,
        gameId: FIRST_GAME,
        promptId: 'p1',
      } satisfies ItemAuthorDoc)
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
