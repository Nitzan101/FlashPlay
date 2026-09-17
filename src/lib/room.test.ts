/**
 * Client-contract tests for room.ts, run against the rules emulator.
 *
 * firestore-rules.test.ts proves what firestore.rules allows and denies in
 * isolation. This file proves the *client* actually drives those rules
 * correctly end to end - in particular the room-code claim/retry loop in
 * claimRoomCode(), which is exactly the kind of two-step contract
 * (ITEM_WRITE_ORDER's sibling) that a rules-only suite cannot see.
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRoom, joinRoom, resolveRoomCode } from './room'
import { ROOM_CODE_WINDOW_MS, type RoomCodeDoc } from './model'

const PROJECT_ID = 'demo-flashplay-room'
const HOST = 'host-uid'
const OTHER_HOST = 'other-host-uid'
const GUEST = 'guest-uid'
const OTHER_GUEST = 'other-guest-uid'

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

// room.ts's own functions are typed against the modular `Firestore` (they
// take it as a parameter precisely so they can run against either the real
// app or this emulator - see the module comment in room.ts). The rules test
// context returns firebase.js's compat `Firestore` type instead, which is
// runtime-interchangeable with the modular one - the modular SDK functions
// used throughout firestore-rules.test.ts accept it directly - but not
// structurally identical, hence the cast.
// HOST and OTHER_HOST carry a realistic non-anonymous provider claim, same
// reasoning as firestore-rules.test.ts: the emulator's default mock token
// omits `firebase.sign_in_provider` entirely, which would make isRegistered()
// pass vacuously rather than for the real reason a host is registered.
const asHost = () =>
  testEnv
    .authenticatedContext(HOST, { firebase: { sign_in_provider: 'google.com' } })
    .firestore() as unknown as Firestore
const asOtherHost = () =>
  testEnv
    .authenticatedContext(OTHER_HOST, { firebase: { sign_in_provider: 'google.com' } })
    .firestore() as unknown as Firestore
const asGuest = () =>
  testEnv.authenticatedContext(GUEST, { firebase: { sign_in_provider: 'anonymous' } }).firestore() as unknown as Firestore
const asOtherGuest = () =>
  testEnv
    .authenticatedContext(OTHER_GUEST, { firebase: { sign_in_provider: 'anonymous' } })
    .firestore() as unknown as Firestore

/**
 * A fixed sequence of codes for createRoom's `nextCode` parameter, so the
 * claim/retry loop's behaviour is deterministic. Mocking global Math.random
 * instead does not work here: the Firestore SDK itself calls Math.random for
 * its own internal purposes (connection setup, backoff jitter) before this
 * code ever runs, consuming the mocked values unpredictably.
 */
function codeSequence(...fourDigitCodes: string[]): () => string {
  let i = 0
  return () => {
    const code = fourDigitCodes[i]
    if (code === undefined) throw new Error('codeSequence exhausted')
    i++
    return code
  }
}

describe('createRoom', () => {
  it('claims a fresh code and a session that resolves back to it', async () => {
    const { sessionId, roomCode } = await createRoom(asHost(), HOST, codeSequence('1111'))

    expect(roomCode).toBe('1111')
    await expect(resolveRoomCode(asGuest(), roomCode)).resolves.toBe(sessionId)

    const session = await getDoc(doc(asGuest(), `sessions/${sessionId}`))
    expect(session.data()?.hostUid).toBe(HOST)
    expect(session.data()?.phase).toBe('lobby')
    // The session is created before the code is claimed (so firestore.rules
    // can check the claim actually points at a session the claimant hosts -
    // see the comment on createRoom), then patched with the real code
    // afterwards. This is the display field staying correct through that.
    expect(session.data()?.roomCode).toBe('1111')
  })

  it('skips a code that is still live and claims the next one instead', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'roomCodes/1111'), {
        sessionId: 'someone-elses-session',
        hostUid: OTHER_HOST,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000, // still live
      } satisfies RoomCodeDoc)
    })

    const { roomCode } = await createRoom(asHost(), HOST, codeSequence('1111', '2222'))

    expect(roomCode).toBe('2222')
    // The live code the first attempt skipped must be untouched.
    const untouched = await getDoc(doc(asGuest(), 'roomCodes/1111'))
    expect(untouched.data()?.hostUid).toBe(OTHER_HOST)
  })

  it('reclaims a code whose reservation has already expired', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'roomCodes/1111'), {
        sessionId: 'abandoned-session',
        hostUid: OTHER_HOST,
        createdAt: Date.now() - ROOM_CODE_WINDOW_MS - 1000,
        expiresAt: Date.now() - 1000, // expired
      } satisfies RoomCodeDoc)
    })

    const { sessionId, roomCode } = await createRoom(asOtherHost(), OTHER_HOST, codeSequence('1111'))

    expect(roomCode).toBe('1111')
    const reclaimed = await getDoc(doc(asGuest(), 'roomCodes/1111'))
    expect(reclaimed.data()?.sessionId).toBe(sessionId)
    expect(reclaimed.data()?.hostUid).toBe(OTHER_HOST)
  })
})

describe('resolveRoomCode', () => {
  it('rejects a code nobody has claimed', async () => {
    await expect(resolveRoomCode(asGuest(), '9999')).rejects.toThrow('room-not-found')
  })

  it('rejects a code whose reservation has expired, distinctly from not-found', async () => {
    // Without this, a link opened after the window (a day-old WhatsApp
    // scrollback, most likely) would silently resolve to whatever session
    // the code has since been reclaimed for - possibly a different
    // gathering entirely - rather than telling the guest anything is wrong.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'roomCodes/1111'), {
        sessionId: 'some-other-gathering',
        hostUid: HOST,
        createdAt: Date.now() - ROOM_CODE_WINDOW_MS - 1000,
        expiresAt: Date.now() - 1000,
      } satisfies RoomCodeDoc)
    })
    await expect(resolveRoomCode(asGuest(), '1111')).rejects.toThrow('room-expired')
  })
})

describe('joinRoom', () => {
  it('lets a guest reach the roster after joining by a resolved code', async () => {
    const { sessionId, roomCode } = await createRoom(asHost(), HOST, codeSequence('1111'))

    const resolvedSessionId = await resolveRoomCode(asGuest(), roomCode)
    await joinRoom(asGuest(), resolvedSessionId, GUEST, 'שרה')

    // isPlayer() only becomes true after the join write above - this is the
    // headline claim of the roster guard in firestore.rules.
    const roster = await getDocs(collection(asGuest(), `sessions/${sessionId}/players`))
    expect(roster.docs.map((d) => d.data().name)).toEqual(['שרה'])
  })

  it('still refuses the roster to someone who has not joined', async () => {
    const { sessionId } = await createRoom(asHost(), HOST, codeSequence('1111'))
    await assertFails(getDocs(collection(asGuest(), `sessions/${sessionId}/players`)))
  })

  it('refuses a guest reading its OWN player document before joining', async () => {
    // The membership rule is circular by design: reading a player document
    // requires isPlayer(), which is only true once that document exists. So
    // "have I already joined?" is a question a first-time guest structurally
    // cannot ask Firestore - it is denied by the same rule that protects the
    // roster.
    //
    // This is not a hypothetical. App.tsx asked exactly this question on the
    // join path and every first-time join died on it in production, while the
    // jsdom test suite stayed green because its mocked getDoc happily
    // returned "does not exist" - a reply real rules never give. The client
    // now answers it from local state instead.
    const { sessionId } = await createRoom(asHost(), HOST, codeSequence('1111'))
    await assertFails(getDoc(doc(asGuest(), `sessions/${sessionId}/players/${GUEST}`)))
  })

  // Two structurally different players (different uids) sharing a display
  // name makes every screen that names a player by looking it up - the
  // reveal, the scoreboard, "most likely to" - ambiguous about which one is
  // meant. Found live: two players both named "אלה" (one having left and
  // rejoined under a new identity) produced a scoreboard with two identically
  // labelled rows and no way to tell which one a given round's points
  // belonged to. 2026-09-16.
  describe('name uniqueness within a session', () => {
    it('refuses a second, different player joining under the same name', async () => {
      const { sessionId } = await createRoom(asHost(), HOST, codeSequence('1111'))
      await joinRoom(asGuest(), sessionId, GUEST, 'אלה')

      await expect(joinRoom(asOtherGuest(), sessionId, OTHER_GUEST, 'אלה')).rejects.toThrow(
        'name-taken',
      )
      const roster = await getDocs(collection(asGuest(), `sessions/${sessionId}/players`))
      expect(roster.docs.map((d) => d.data().uid)).toEqual([GUEST])
    })

    it('refuses the same collision after whitespace/case normalisation, matching matchName()', async () => {
      const { sessionId } = await createRoom(asHost(), HOST, codeSequence('1111'))
      await joinRoom(asGuest(), sessionId, GUEST, 'Dana Levi')

      await expect(
        joinRoom(asOtherGuest(), sessionId, OTHER_GUEST, '  dana  levi '),
      ).rejects.toThrow('name-taken')
    })

    it('lets the same player rejoin under the name they already hold', async () => {
      const { sessionId } = await createRoom(asHost(), HOST, codeSequence('1111'))
      await joinRoom(asGuest(), sessionId, GUEST, 'אלה')

      // The realistic case this must not break: leaving (leftAt set) and
      // tapping the same link again - joinRoom is called a second time for
      // the identical uid and name.
      await expect(joinRoom(asGuest(), sessionId, GUEST, 'אלה')).resolves.toBeUndefined()
    })

    it('does not block a genuinely different name', async () => {
      const { sessionId } = await createRoom(asHost(), HOST, codeSequence('1111'))
      await joinRoom(asGuest(), sessionId, GUEST, 'אלה')

      await joinRoom(asOtherGuest(), sessionId, OTHER_GUEST, 'דנה')

      const roster = await getDocs(collection(asGuest(), `sessions/${sessionId}/players`))
      expect(roster.docs.map((d) => d.data().uid).sort()).toEqual([GUEST, OTHER_GUEST].sort())
    })
  })
})
