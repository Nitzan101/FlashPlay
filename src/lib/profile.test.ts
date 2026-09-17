/**
 * Client-contract test for profile.ts's one non-hook function, run against the
 * rules emulator - the same split memory.test.ts already uses: a function
 * that takes `Firestore` as a parameter is proven here, the hook built on top
 * of it is exercised through component mocks (see App.test.tsx).
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { saveUserProfile } from './profile'
import { paths } from './model'

const PROJECT_ID = 'demo-flashplay-profile'
const HOST = 'host-uid'
const OTHER = 'other-uid'

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
})

const asHost = () => testEnv.authenticatedContext(HOST).firestore() as unknown as Firestore
const asOther = () => testEnv.authenticatedContext(OTHER).firestore() as unknown as Firestore

describe('saveUserProfile', () => {
  it('writes a first-time profile with a fresh createdAt', async () => {
    await saveUserProfile(asHost(), HOST, { displayName: 'דוד', emoji: '🦄' })

    const snap = await getDoc(doc(asHost(), paths.user(HOST)))
    expect(snap.data()?.displayName).toBe('דוד')
    expect(snap.data()?.emoji).toBe('🦄')
    expect(typeof snap.data()?.createdAt).toBe('number')
  })

  it('preserves the original createdAt across a later edit', async () => {
    await saveUserProfile(asHost(), HOST, { displayName: 'דוד', emoji: '🦄' })
    const first = (await getDoc(doc(asHost(), paths.user(HOST)))).data()?.createdAt as number

    await saveUserProfile(asHost(), HOST, { displayName: 'דויד', emoji: '🔥' })
    const second = await getDoc(doc(asHost(), paths.user(HOST)))

    expect(second.data()?.displayName).toBe('דויד')
    expect(second.data()?.emoji).toBe('🔥')
    expect(second.data()?.createdAt).toBe(first)
  })

  it('refuses to write another user\'s profile', async () => {
    await assertFails(saveUserProfile(asOther(), HOST, { displayName: 'x', emoji: null }))
  })
})
