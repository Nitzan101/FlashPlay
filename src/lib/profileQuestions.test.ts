/**
 * Client-contract tests for profileQuestions.ts, run against the rules
 * emulator - the same split memory.ts/room.ts use: firestore-rules.test.ts
 * proves what the rules allow and deny in isolation (raw setDoc/getDoc), this
 * file proves the actual client functions drive those rules correctly.
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  addCustomQuestion,
  deleteCustomQuestion,
  readCustomQuestions,
  saveProfileAnswer,
} from './profileQuestions'
import { paths } from './model'

const PROJECT_ID = 'demo-flashplay-profile-questions'
const HOST = 'host-uid'
const OTHER_HOST = 'other-host-uid'
const SESSION = 'session1'
const PLAYER = 'player-uid'
const OTHER_PLAYER = 'other-player-uid'

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
      phase: 'playing',
      currentGameId: null,
      scores: {},
      contactIds: {},
      createdAt: 0,
      expiresAt: 0,
    })
    await setDoc(doc(db, paths.player(SESSION, PLAYER)), { name: 'Player', uid: PLAYER })
    await setDoc(doc(db, paths.player(SESSION, OTHER_PLAYER)), {
      name: 'Other',
      uid: OTHER_PLAYER,
    })
  })
})

const asHost = () => testEnv.authenticatedContext(HOST).firestore() as unknown as Firestore
const asOtherHost = () =>
  testEnv.authenticatedContext(OTHER_HOST).firestore() as unknown as Firestore
const asPlayer = () => testEnv.authenticatedContext(PLAYER).firestore() as unknown as Firestore
const asOtherPlayer = () =>
  testEnv.authenticatedContext(OTHER_PLAYER).firestore() as unknown as Firestore

describe("a host's own custom-question bank", () => {
  it('adds a question, then reads it back through readCustomQuestions', async () => {
    await addCustomQuestion(asHost(), HOST, { text: 'שאלה', kind: 'text' })

    const questions = await readCustomQuestions(asHost(), HOST)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ text: 'שאלה', kind: 'text' })
  })

  it('deletes a question', async () => {
    await addCustomQuestion(asHost(), HOST, { text: 'שאלה', kind: 'text' })
    const [question] = await readCustomQuestions(asHost(), HOST)

    await deleteCustomQuestion(asHost(), HOST, question.id)

    expect(await readCustomQuestions(asHost(), HOST)).toEqual([])
  })

  // Already covered by the blanket users/{uid} rule, but worth proving
  // empirically now that this is the first thing to actually write there -
  // see profile.test.ts, "refuses to write another user's profile".
  it('refuses another host reading or writing into this bank', async () => {
    await addCustomQuestion(asHost(), HOST, { text: 'שאלה', kind: 'text' })
    // Both wrap the underlying Firestore error (see room.ts's `step`), so a
    // plain rejection is the right assertion here - assertFails expects the
    // raw FirebaseError this wrapper deliberately replaces with a reported one.
    await expect(readCustomQuestions(asOtherHost(), HOST)).rejects.toThrow()
    await expect(
      addCustomQuestion(asOtherHost(), HOST, { text: 'x', kind: 'text' }),
    ).rejects.toThrow()
  })
})

describe('saveProfileAnswer', () => {
  it("writes the caller's own answer, readable back by the same caller", async () => {
    await saveProfileAnswer(asPlayer(), SESSION, PLAYER, 'hobby', 'ציור')

    const snap = await getDoc(doc(asPlayer(), paths.profileAnswer(SESSION, PLAYER, 'hobby')))
    expect(snap.data()?.answer).toBe('ציור')
  })

  it('overwrites a previous answer to the same question rather than duplicating', async () => {
    await saveProfileAnswer(asPlayer(), SESSION, PLAYER, 'hobby', 'ציור')
    await saveProfileAnswer(asPlayer(), SESSION, PLAYER, 'hobby', 'ריצה')

    const snap = await getDoc(doc(asPlayer(), paths.profileAnswer(SESSION, PLAYER, 'hobby')))
    expect(snap.data()?.answer).toBe('ריצה')
  })

  it('stores a multi-choice answer as an array', async () => {
    await saveProfileAnswer(asPlayer(), SESSION, PLAYER, 'freeTime', ['טיולים', 'ספרים'])

    const snap = await getDoc(doc(asPlayer(), paths.profileAnswer(SESSION, PLAYER, 'freeTime')))
    expect(snap.data()?.answer).toEqual(['טיולים', 'ספרים'])
  })

  it("refuses writing into another player's answers", async () => {
    await expect(
      saveProfileAnswer(asOtherPlayer(), SESSION, PLAYER, 'hobby', 'ציור'),
    ).rejects.toThrow()
  })
})
