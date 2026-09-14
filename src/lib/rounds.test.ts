/**
 * Client-contract tests for rounds.ts, run against the rules emulator.
 *
 * The headline claim of the whole game lives here: nobody can read who wrote
 * an item, or how anyone voted, until the host reveals the round - and the
 * scoring that follows is computed from reads that only become legal at that
 * exact moment (see ROUND_REVEAL_ORDER in model.ts).
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  castVote,
  finishGame,
  getMyVote,
  openNextRound,
  openVoting,
  revealRound,
  skipRound,
} from './rounds'
import { MAX_ROUNDS, type RoundDoc, type SessionDoc } from './model'

const PROJECT_ID = 'demo-flashplay-rounds'
const SESSION = 'session1'
const GAME = 'game1'
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

/** Two items, both written by PLAYER, in a game that has finished harvesting.
 *  Seeded directly rather than through submitHarvestItem: what is under test
 *  here is the round loop, and harvest.test.ts already proves the submission
 *  sequence produces exactly this shape. */
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, `sessions/${SESSION}`), {
      roomCode: 'ABCD',
      hostUid: HOST,
      groupId: null,
      phase: 'playing',
      currentGameId: GAME,
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
    await setDoc(doc(db, `sessions/${SESSION}/games/${GAME}`), {
      type: 'who-said-that',
      phase: 'rounds',
      promptIds: [PROMPT, 'p2'],
      order: 0,
      startedAt: 0,
      phaseEndsAt: 0,
    })
    for (const itemId of ['item1', 'item2']) {
      await setDoc(doc(db, `sessions/${SESSION}/items/${itemId}`), {
        gameId: GAME,
        text: `text of ${itemId}`,
        promptId: PROMPT,
        revealed: false,
        createdAt: 0,
      })
      await setDoc(doc(db, `sessions/${SESSION}/itemAuthors/${itemId}`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
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

describe('openNextRound', () => {
  it('opens an item in preview, which only the host can do', async () => {
    const roundId = await openNextRound(asHost(), SESSION, GAME, () => 'round1')

    expect(roundId).toBe('round1')
    const round = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`))).data() as RoundDoc
    expect(round.phase).toBe('preview')
    expect(round.order).toBe(0)
    expect(['item1', 'item2']).toContain(round.itemId)

    await expect(openNextRound(asPlayer(), SESSION, GAME, () => 'round2')).rejects.toThrow()
  })

  it('never draws an item that already had a round, skipped ones included', async () => {
    const first = await openNextRound(asHost(), SESSION, GAME, () => 'round1')
    await skipRound(asHost(), SESSION, first!)
    const second = await openNextRound(asHost(), SESSION, GAME, () => 'round2')

    const firstItem = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`))).data()
      ?.itemId
    const secondItem = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/${second}`))).data()
      ?.itemId
    expect(secondItem).not.toBe(firstItem)
  })

  it('returns null once the material runs out', async () => {
    await openNextRound(asHost(), SESSION, GAME, () => 'round1')
    await openNextRound(asHost(), SESSION, GAME, () => 'round2')

    expect(await openNextRound(asHost(), SESSION, GAME, () => 'round3')).toBeNull()
  })

  it('does not spend one of the ten on a skipped item', async () => {
    const first = await openNextRound(asHost(), SESSION, GAME, () => 'round1')
    await skipRound(asHost(), SESSION, first!)

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      // Nine played rounds plus the skip above: the tenth must still open.
      for (let i = 0; i < MAX_ROUNDS - 1; i++) {
        await setDoc(doc(db, `sessions/${SESSION}/rounds/filler${i}`), {
          gameId: GAME,
          itemId: `spent${i}`,
          phase: 'revealed',
          order: i + 2,
          startedAt: 0,
        })
      }
    })

    expect(await openNextRound(asHost(), SESSION, GAME, () => 'round-last')).toBe('round-last')
  })

  it(`returns null at ${MAX_ROUNDS} played rounds even with material left`, async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      for (let i = 0; i < MAX_ROUNDS; i++) {
        await setDoc(doc(db, `sessions/${SESSION}/rounds/filler${i}`), {
          gameId: GAME,
          itemId: `spent${i}`,
          phase: 'revealed',
          order: i,
          startedAt: 0,
        })
      }
    })

    expect(await openNextRound(asHost(), SESSION, GAME, () => 'round11')).toBeNull()
  })

  it('collides rather than double-opening when two host devices tap at once', async () => {
    // Both calls see zero rounds, so both derive the same document id - and a
    // round that already exists cannot be re-created or restarted.
    const results = await Promise.allSettled([
      openNextRound(asHost(), SESSION, GAME),
      openNextRound(asHost(), SESSION, GAME),
    ])

    const opened = results.filter((r) => r.status === 'fulfilled')
    expect(opened.length).toBeGreaterThanOrEqual(1)
    const rounds = await getDocs(collection(asHost(), `sessions/${SESSION}/rounds`))
    expect(rounds.size).toBe(1)
  })
})

describe('voting', () => {
  beforeEach(async () => {
    await openNextRound(asHost(), SESSION, GAME, () => 'round1')
    await openVoting(asHost(), SESSION, 'round1')
  })

  it('records a vote and publishes that it happened, never who for', async () => {
    await castVote(asThird(), SESSION, 'round1', THIRD, HOST)

    expect(await getMyVote(asThird(), SESSION, 'round1', THIRD)).toBe(HOST)
    const player = await getDoc(doc(asHost(), `sessions/${SESSION}/players/${THIRD}`))
    expect(player.data()?.votedRoundId).toBe('round1')
  })

  // The claim the whole game rests on. A live tally would turn the round into
  // a poll everyone follows, and knowing who voted for whom before the reveal
  // is halfway to knowing the answer.
  it('refuses everyone the votes until the round is revealed - the host included', async () => {
    await castVote(asThird(), SESSION, 'round1', THIRD, HOST)

    await assertFails(getDocs(collection(asHost(), `sessions/${SESSION}/rounds/round1/votes`)))
    await assertFails(getDocs(collection(asPlayer(), `sessions/${SESSION}/rounds/round1/votes`)))
    await assertFails(
      getDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1/votes/${THIRD}`)),
    )
  })

  it('refuses a self-vote, so abstaining cannot mark the author out', async () => {
    await expect(castVote(asThird(), SESSION, 'round1', THIRD, THIRD)).rejects.toThrow()
  })

  it('refuses a vote for somebody who is not in this gathering', async () => {
    await expect(castVote(asThird(), SESSION, 'round1', THIRD, 'ghost-uid')).rejects.toThrow()
  })

  it('refuses a vote once the round is revealed', async () => {
    await revealRound(asHost(), SESSION, 'round1')

    await expect(castVote(asThird(), SESSION, 'round1', THIRD, HOST)).rejects.toThrow()
  })

  it('lets a player change their mind while the round is open', async () => {
    await castVote(asThird(), SESSION, 'round1', THIRD, HOST)
    await castVote(asThird(), SESSION, 'round1', THIRD, PLAYER)

    expect(await getMyVote(asThird(), SESSION, 'round1', THIRD)).toBe(PLAYER)
  })
})

describe('revealRound', () => {
  beforeEach(async () => {
    await openNextRound(asHost(), SESSION, GAME, () => 'round1')
    await openVoting(asHost(), SESSION, 'round1')
  })

  it('keeps the author unreadable until the reveal, then opens it to everyone', async () => {
    const itemId = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`))).data()
      ?.itemId as string

    await assertFails(getDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/${itemId}`)))
    await assertFails(getDoc(doc(asHost(), `sessions/${SESSION}/itemAuthors/${itemId}`)))

    await revealRound(asHost(), SESSION, 'round1')

    const author = await getDoc(doc(asThird(), `sessions/${SESSION}/itemAuthors/${itemId}`))
    expect(author.data()?.authorPlayerId).toBe(PLAYER)
  })

  it('scores two points for a correct guess and one to the author per fooled voter', async () => {
    // PLAYER wrote the item. HOST guesses right; THIRD guesses wrong; the
    // author's own vote is cast (so as not to give themselves away) and
    // scored in neither direction.
    await castVote(asHost(), SESSION, 'round1', HOST, PLAYER)
    await castVote(asThird(), SESSION, 'round1', THIRD, HOST)
    await castVote(asPlayer(), SESSION, 'round1', PLAYER, THIRD)

    const summary = await revealRound(asHost(), SESSION, 'round1')

    expect(summary.authorPlayerId).toBe(PLAYER)
    expect(summary.awarded).toEqual({ [HOST]: 2, [PLAYER]: 1 })
    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.scores).toEqual({ [HOST]: 2, [PLAYER]: 1 })
  })

  // Cumulative across the gathering (DESIGN), and derived rather than
  // incremented: the total is the sum of what every round paid out, which is
  // what makes a repeated or half-finished reveal harmless.
  it('accumulates across rounds', async () => {
    await castVote(asHost(), SESSION, 'round1', HOST, PLAYER)
    await revealRound(asHost(), SESSION, 'round1')

    const second = await openNextRound(asHost(), SESSION, GAME, () => 'round2')
    await openVoting(asHost(), SESSION, second!)
    await castVote(asHost(), SESSION, second!, HOST, PLAYER)
    await revealRound(asHost(), SESSION, second!)

    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.scores[HOST]).toBe(4)
  })

  it('refuses a non-host', async () => {
    await expect(revealRound(asPlayer(), SESSION, 'round1')).rejects.toThrow()
  })

  // Milestone 5's review found this: revealing is several writes, and the
  // first version died forever on whichever one had already landed. The
  // gathering stopped there, because the only host control in `voting` is the
  // reveal that could no longer succeed.
  it('finishes a reveal whose later writes were lost, without paying twice', async () => {
    await castVote(asHost(), SESSION, 'round1', HOST, PLAYER)
    // Exactly the state a dropped write leaves: the round is closed, the item
    // is revealed, nothing has been scored.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await updateDoc(doc(db, `sessions/${SESSION}/rounds/round1`), { phase: 'revealed' })
      const itemId = (await getDoc(doc(db, `sessions/${SESSION}/rounds/round1`))).data()
        ?.itemId as string
      await updateDoc(doc(db, `sessions/${SESSION}/items/${itemId}`), { revealed: true })
    })

    await revealRound(asHost(), SESSION, 'round1')
    // And again: a host who taps twice, or two host devices, must not double
    // the points.
    await revealRound(asHost(), SESSION, 'round1')

    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.scores).toEqual({ [HOST]: 2 })
  })

  it('records what the round paid, once and only once', async () => {
    await castVote(asHost(), SESSION, 'round1', HOST, PLAYER)
    await revealRound(asHost(), SESSION, 'round1')

    const round = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`))).data() as RoundDoc
    expect(round.awarded).toEqual({ [HOST]: 2 })

    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`), { awarded: { [HOST]: 99 } }),
    )
  })

  // The window a review found in the first version: with the item revealed
  // while the round was still open, a player could read the author off the
  // live items listener and change their vote to match.
  it('refuses a vote once the item is revealed, even if the round still says voting', async () => {
    const itemId = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`))).data()
      ?.itemId as string
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}/items/${itemId}`), {
        revealed: true,
      })
    })

    await expect(castVote(asThird(), SESSION, 'round1', THIRD, PLAYER)).rejects.toThrow()
  })

  it('refuses everyone but the host the scoreboard itself', async () => {
    await assertFails(
      updateDoc(doc(asPlayer(), `sessions/${SESSION}`), { scores: { [PLAYER]: 999 } }),
    )
  })

  // A round may not be removed: its votes are a subcollection and would
  // survive the parent, so deleting and re-creating would reset a phase that
  // is supposed to be monotonic.
  it('refuses to delete a round, host included', async () => {
    await assertFails(deleteDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`)))
  })

  // Without this a host could reveal, read every vote, step the round back to
  // voting and change their own - the reason round phases are monotonic.
  it('refuses to move a revealed round back to voting', async () => {
    await revealRound(asHost(), SESSION, 'round1')

    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`), { phase: 'voting' }),
    )
  })

  it('refuses to swap the item under a round that is already open', async () => {
    const drawn = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`))).data()
      ?.itemId as string
    const other = drawn === 'item1' ? 'item2' : 'item1'

    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}/rounds/round1`), {
        phase: 'revealed',
        itemId: other,
      }),
    )
  })
})

describe('finishGame', () => {
  it('lets the host end the game, and nobody else', async () => {
    await expect(finishGame(asPlayer(), SESSION, GAME)).rejects.toThrow()

    await finishGame(asHost(), SESSION, GAME)
    const game = await getDoc(doc(asHost(), `sessions/${SESSION}/games/${GAME}`))
    expect(game.data()?.phase).toBe('done')
  })
})
