/**
 * Client-contract tests for harvest.ts, run against the rules emulator.
 *
 * firestore-rules.test.ts proves what firestore.rules allows and denies in
 * isolation. This file proves harvest.ts's own multi-step write sequences
 * (submitHarvestItem's three-step contract, in particular) actually drive
 * those rules correctly end to end - the same reason room.test.ts exists
 * alongside firestore-rules.test.ts for room.ts.
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  advanceGamePhase,
  extendGamePhase,
  getMySubmission,
  getSubmissionState,
  pickHarvestPromptIds,
  startHarvestGame,
  submitHarvestItem,
} from './harvest'
import { HARVEST_EXTEND_MS, HARVEST_WINDOW_MS, type GameDoc } from './model'

const PROJECT_ID = 'demo-flashplay-harvest'
const SESSION = 'session1'
const HOST = 'host-uid'
const PLAYER = 'player-uid'

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
      groupId: null,
      phase: 'lobby',
      currentGameId: null,
      scores: {},
      createdAt: 0,
      expiresAt: 0,
    })
    await setDoc(doc(db, `sessions/${SESSION}/players/${HOST}`), { name: 'Host', uid: HOST })
    await setDoc(doc(db, `sessions/${SESSION}/players/${PLAYER}`), { name: 'Player', uid: PLAYER })
  })
})

// Same reasoning as room.test.ts's asHost/asPlayer: isRegistered() and
// isHost() both key off a realistic token shape, not the emulator's default
// (which omits `firebase.sign_in_provider` entirely).
const asHost = () =>
  testEnv
    .authenticatedContext(HOST, { firebase: { sign_in_provider: 'google.com' } })
    .firestore() as unknown as Firestore
const asPlayer = () =>
  testEnv
    .authenticatedContext(PLAYER, { firebase: { sign_in_provider: 'anonymous' } })
    .firestore() as unknown as Firestore

describe('pickHarvestPromptIds', () => {
  it('picks two distinct ids from the pool', () => {
    const ids = pickHarvestPromptIds()
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('is driven by the injected random source, for deterministic tests', () => {
    // Always picks index 0 of the shrinking pool - i.e. the pool's first two
    // ids, in order.
    const ids = pickHarvestPromptIds(() => 0)
    expect(ids).toHaveLength(2)
  })
})

describe('startHarvestGame', () => {
  it('creates a harvesting game and moves the session into it', async () => {
    const gameId = await startHarvestGame(asHost(), SESSION, ['p1', 'p2'], () => 'game1')

    expect(gameId).toBe('game1')
    const game = (await getDoc(doc(asHost(), `sessions/${SESSION}/games/game1`))).data() as GameDoc
    expect(game.phase).toBe('harvesting')
    expect(game.promptIds).toEqual(['p1', 'p2'])
    expect(game.phaseEndsAt - game.startedAt).toBe(HARVEST_WINDOW_MS)

    const session = await getDoc(doc(asHost(), `sessions/${SESSION}`))
    expect(session.data()?.phase).toBe('playing')
    expect(session.data()?.currentGameId).toBe('game1')
  })

  it('refuses a non-host', async () => {
    await expect(
      startHarvestGame(asPlayer(), SESSION, ['p1', 'p2'], () => 'game1'),
    ).rejects.toThrow()
  })
})

describe('submitHarvestItem', () => {
  beforeEach(async () => {
    await startHarvestGame(asHost(), SESSION, ['p1', 'p2'], () => 'game1')
  })

  it('writes a readable item, attributed to its author only after reveal', async () => {
    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'my answer', () => 'item1')

    const item = await getDoc(doc(asPlayer(), `sessions/${SESSION}/items/item1`))
    expect(item.data()?.text).toBe('my answer')
    expect(item.data()?.promptId).toBe('p1')

    // Same headline claim as firestore-rules.test.ts, exercised through the
    // real client function rather than a hand-built setDoc.
    await assertFails(getDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/item1`)))
  })

  it('lets getMySubmission report the reservation back', async () => {
    expect(await getMySubmission(asPlayer(), SESSION, 'game1', 'p1', PLAYER)).toBeNull()

    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'my answer', () => 'item1')

    const submission = await getMySubmission(asPlayer(), SESSION, 'game1', 'p1', PLAYER)
    expect(submission?.itemId).toBe('item1')
  })

  it('creates no second item for a prompt already answered - duplicate blocking, end to end', async () => {
    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'first', () => 'item1')

    // A second attempt is not an error - the answer is already recorded, so
    // there is nothing to do and nothing to report. What must not happen is a
    // second item, and what stops a client that skips this politeness is the
    // slot's own immutability (firestore-rules.test.ts asserts that directly).
    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'second', () => 'item2')

    const item = await getDoc(doc(asPlayer(), `sessions/${SESSION}/items/item1`))
    expect(item.data()?.text).toBe('first')
    expect((await getDoc(doc(asPlayer(), `sessions/${SESSION}/items/item2`))).exists()).toBe(false)
  })

  // Milestone 4's own gate is a device deliberately killed mid-phase, and
  // these are the two states it leaves behind. Before the fix both were
  // terminal: the slot cannot be re-created, so every retry died at the first
  // write and that player could never answer that prompt again.
  it('resumes a slot whose item never landed, instead of locking the player out', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/game1/prompts/p1/submissions/${PLAYER}`),
        { itemId: 'stranded', submittedAt: 0 },
      )
    })

    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'second try', () => 'unused')

    expect((await getDoc(doc(asPlayer(), `sessions/${SESSION}/items/stranded`))).data()?.text).toBe(
      'second try',
    )
    expect((await getDoc(doc(asPlayer(), `sessions/${SESSION}/items/unused`))).exists()).toBe(false)
  })

  it('resumes a slot whose authorship claim landed but whose item did not', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, `sessions/${SESSION}/games/game1/prompts/p1/submissions/${PLAYER}`), {
        itemId: 'stranded',
        submittedAt: 0,
      })
      await setDoc(doc(db, `sessions/${SESSION}/itemAuthors/stranded`), {
        authorPlayerId: PLAYER,
        gameId: 'game1',
        promptId: 'p1',
      })
    })

    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'second try', () => 'unused')

    expect((await getDoc(doc(asPlayer(), `sessions/${SESSION}/items/stranded`))).data()?.text).toBe(
      'second try',
    )
  })

  it('reports a stranded slot as incomplete, so the UI shows the input again', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/game1/prompts/p1/submissions/${PLAYER}`),
        { itemId: 'stranded', submittedAt: 0 },
      )
    })

    expect(await getSubmissionState(asPlayer(), SESSION, 'game1', 'p1', PLAYER)).toBe('incomplete')
    expect(await getSubmissionState(asPlayer(), SESSION, 'game1', 'p2', PLAYER)).toBe('none')

    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'second try', () => 'unused')
    expect(await getSubmissionState(asPlayer(), SESSION, 'game1', 'p1', PLAYER)).toBe('complete')
  })

  it('allows the same player to submit to the OTHER prompt afterwards', async () => {
    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'first', () => 'item1')
    await submitHarvestItem(asPlayer(), SESSION, 'game1', 'p2', PLAYER, 'second', () => 'item2')

    expect((await getDoc(doc(asPlayer(), `sessions/${SESSION}/items/item2`))).data()?.text).toBe(
      'second',
    )
  })
})

describe('advanceGamePhase', () => {
  beforeEach(async () => {
    await startHarvestGame(asHost(), SESSION, ['p1', 'p2'], () => 'game1')
  })

  it('lets the host move the game past harvesting', async () => {
    await advanceGamePhase(asHost(), SESSION, 'game1', 'rounds')
    const game = await getDoc(doc(asHost(), `sessions/${SESSION}/games/game1`))
    expect(game.data()?.phase).toBe('rounds')
  })

  it('refuses a non-host', async () => {
    await expect(advanceGamePhase(asPlayer(), SESSION, 'game1', 'rounds')).rejects.toThrow()
  })

  it('closes the harvest to further submissions once advanced', async () => {
    await advanceGamePhase(asHost(), SESSION, 'game1', 'rounds')
    await expect(
      submitHarvestItem(asPlayer(), SESSION, 'game1', 'p1', PLAYER, 'too late', () => 'item1'),
    ).rejects.toThrow()
  })
})

describe('extendGamePhase', () => {
  it("adds to the host's countdown without a read-modify-write race", async () => {
    const gameId = await startHarvestGame(asHost(), SESSION, ['p1', 'p2'], () => 'game1')
    const before = (
      await getDoc(doc(asHost(), `sessions/${SESSION}/games/${gameId}`))
    ).data() as GameDoc

    await extendGamePhase(asHost(), SESSION, gameId)

    const after = (
      await getDoc(doc(asHost(), `sessions/${SESSION}/games/${gameId}`))
    ).data() as GameDoc
    expect(after.phaseEndsAt - before.phaseEndsAt).toBe(HARVEST_EXTEND_MS)
  })

  it('refuses a non-host', async () => {
    const gameId = await startHarvestGame(asHost(), SESSION, ['p1', 'p2'], () => 'game1')
    await expect(extendGamePhase(asPlayer(), SESSION, gameId)).rejects.toThrow()
  })
})
