/**
 * Security rules tests, run against the Firestore emulator.
 *
 * These are not ordinary unit tests. The client reads Firestore directly, so
 * `firestore.rules` is the only thing standing between a curious player and
 * the answer to the game they are playing. Every assertion here is a claim
 * about what an attacker cannot do, and each one must be able to fail: the
 * rules file was checked by deleting each rule in turn and confirming the
 * matching test went red.
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const PROJECT_ID = 'demo-flashplay'
const SESSION = 'session1'
const HOST = 'host-uid'
const PLAYER = 'player-uid'
const OUTSIDER = 'outsider-uid'
const ITEM = 'item1'
const ROUND = 'round1'

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

/** Seeds a gathering with the rules switched off, so that setup cannot itself
 *  be blocked by the thing under test. */
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, `sessions/${SESSION}`), {
      roomCode: 'ABCD',
      hostUid: HOST,
      groupId: null,
      phase: 'playing',
      currentGameId: 'game1',
      scores: {},
      createdAt: 0,
      expiresAt: 0,
    })
    await setDoc(doc(db, `sessions/${SESSION}/players/${HOST}`), { name: 'Host', uid: HOST })
    await setDoc(doc(db, `sessions/${SESSION}/players/${PLAYER}`), {
      name: 'Player',
      uid: PLAYER,
    })
    await setDoc(doc(db, `sessions/${SESSION}/items/${ITEM}`), {
      gameId: 'game1',
      text: 'I left my phone on the car roof',
      promptId: 'p1',
      revealed: false,
      createdAt: 0,
    })
    await setDoc(doc(db, `sessions/${SESSION}/itemAuthors/${ITEM}`), {
      authorPlayerId: HOST,
    })
    await setDoc(doc(db, `sessions/${SESSION}/rounds/${ROUND}`), {
      gameId: 'game1',
      itemId: ITEM,
      phase: 'voting',
      order: 0,
      startedAt: 0,
    })
    await setDoc(doc(db, `sessions/${SESSION}/rounds/${ROUND}/votes/${HOST}`), {
      votedForPlayerId: PLAYER,
      castAt: 0,
    })
  })
})

const asPlayer = () => testEnv.authenticatedContext(PLAYER).firestore()
const asHost = () => testEnv.authenticatedContext(HOST).firestore()
const asOutsider = () => testEnv.authenticatedContext(OUTSIDER).firestore()
const asAnonymous = () => testEnv.unauthenticatedContext().firestore()

/** Flips an item or a round into its revealed state, bypassing the rules. */
async function reveal(what: 'item' | 'round') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    if (what === 'item') {
      await updateDoc(doc(db, `sessions/${SESSION}/items/${ITEM}`), { revealed: true })
    } else {
      await updateDoc(doc(db, `sessions/${SESSION}/rounds/${ROUND}`), { phase: 'revealed' })
    }
  })
}

describe('who wrote an item', () => {
  it('is unreadable by another player before the item is revealed', async () => {
    // The headline claim of this milestone. If this passes when it should
    // fail, "Who said that" is not a guessing game - devtools show the answer.
    await assertFails(getDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/${ITEM}`)))
  })

  it('becomes readable once the item is revealed', async () => {
    await reveal('item')
    await assertSucceeds(getDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/${ITEM}`)))
  })

  it('is not readable even by the author before the reveal', async () => {
    // The author already knows, so this costs nothing - and a rule that has to
    // special-case "unless it is yours" is a rule with a second path through
    // it, which is where the leak would eventually be.
    await assertFails(getDoc(doc(asHost(), `sessions/${SESSION}/itemAuthors/${ITEM}`)))
  })

  it('cannot be written naming someone else as the author', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/item2`), {
        authorPlayerId: HOST,
      }),
    )
  })

  it('cannot be rewritten after the fact', async () => {
    await reveal('item')
    await assertFails(
      updateDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/${ITEM}`), {
        authorPlayerId: PLAYER,
      }),
    )
  })
})

describe('votes', () => {
  it("are unreadable by another player while the round is still open", async () => {
    // Otherwise the round becomes a poll where everyone follows the first vote.
    await assertFails(
      getDoc(doc(asPlayer(), `sessions/${SESSION}/rounds/${ROUND}/votes/${HOST}`)),
    )
  })

  it('become readable once the round is revealed', async () => {
    await reveal('round')
    await assertSucceeds(
      getDoc(doc(asPlayer(), `sessions/${SESSION}/rounds/${ROUND}/votes/${HOST}`)),
    )
  })

  it('can always be read back by the player who cast them', async () => {
    await assertSucceeds(
      getDoc(doc(asHost(), `sessions/${SESSION}/rounds/${ROUND}/votes/${HOST}`)),
    )
  })

  it('cannot be cast on behalf of another player', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/rounds/${ROUND}/votes/${HOST}`), {
        votedForPlayerId: PLAYER,
        castAt: 0,
      }),
    )
  })

  it('cannot be changed after the round is revealed', async () => {
    await reveal('round')
    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}/rounds/${ROUND}/votes/${HOST}`), {
        votedForPlayerId: HOST,
      }),
    )
  })
})

describe("the host's private store", () => {
  it('is unreadable by someone else, even while sharing a gathering with them', async () => {
    // The join link is a bearer token that can be forwarded out of the group.
    // Being in the room must not grant read access to a family's accumulated
    // memory - only to what the current game reveals.
    await assertFails(
      getDoc(doc(asPlayer(), `users/${HOST}/groups/group1/facts/fact1`)),
    )
  })

  it('is readable by its owner', async () => {
    await assertSucceeds(getDoc(doc(asHost(), `users/${HOST}/groups/group1/facts/fact1`)))
  })

  it('cannot be written by anyone else', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), `users/${HOST}/contacts/c1`), { name: 'stolen' }),
    )
  })
})

describe('gathering membership', () => {
  it('lets a non-member read the session document, so they can join', async () => {
    await assertSucceeds(getDoc(doc(asOutsider(), `sessions/${SESSION}`)))
  })

  it('does not let a non-member read the harvested items', async () => {
    await assertFails(getDoc(doc(asOutsider(), `sessions/${SESSION}/items/${ITEM}`)))
  })

  it('does not let a non-host drive the gathering forward', async () => {
    await assertFails(
      updateDoc(doc(asPlayer(), `sessions/${SESSION}`), { phase: 'finished' }),
    )
  })

  it('lets the host drive the gathering forward', async () => {
    await assertSucceeds(
      updateDoc(doc(asHost(), `sessions/${SESSION}`), { phase: 'finished' }),
    )
  })

  it('refuses an unauthenticated client entirely', async () => {
    // Guests sign in anonymously, so "no auth at all" is never a real client -
    // it is what a script poking at the database looks like.
    await assertFails(getDoc(doc(asAnonymous(), `sessions/${SESSION}`)))
  })
})

describe('collections with no rules', () => {
  it('are denied rather than silently open', async () => {
    await assertFails(getDoc(doc(asHost(), 'somethingNobodyWroteRulesFor/x')))
  })
})

describe('path helpers', () => {
  it('agree with the paths these tests exercise', async () => {
    // The rules file cannot import from model.ts, so this is what keeps the
    // two in step: if a collection is renamed in one place only, this fails.
    const { paths } = await import('./model')
    expect(paths.itemAuthor(SESSION, ITEM)).toBe(`sessions/${SESSION}/itemAuthors/${ITEM}`)
    expect(paths.vote(SESSION, ROUND, HOST)).toBe(
      `sessions/${SESSION}/rounds/${ROUND}/votes/${HOST}`,
    )
    expect(paths.groupFacts(HOST, 'group1')).toBe(`users/${HOST}/groups/group1/facts`)
    expect(paths.item(SESSION, ITEM)).toBe(`sessions/${SESSION}/items/${ITEM}`)
  })
})
