/**
 * Security rules tests, run against the Firestore emulator.
 *
 * These are not ordinary unit tests. The client reads Firestore directly, so
 * `firestore.rules` is the only thing standing between a curious player and
 * the answer to the game they are playing. Every assertion here is a claim
 * about what an attacker cannot do, and each one must be able to fail.
 *
 * An independent review of the first version of these rules found four
 * demonstrated holes that every assertion here was green through. The lesson
 * is recorded where it belongs, but the operative part for anyone editing this
 * file: **not one of the original twenty assertions was a `list` or a query**,
 * and two of the four holes were only ever visible through `getDocs`. If you
 * add a rule, add a list assertion for it too.
 *
 * Mutation coverage, stated exactly rather than claimed wholesale, because
 * overstating it is the error this technique exists to prevent. Seven guards
 * have been deleted one at a time and the matching assertions watched to go
 * red, then restored:
 *
 *   items create `revealed == false`            -> 1 assertion
 *   items `allow delete: if false`              -> 1
 *   sessions `get` (vs `read`, which lists)     -> 1
 *   players read `isPlayer` (vs `isSignedIn`)   -> 1
 *   votes create `!roundRevealed`               -> 1
 *   items create author-claim check             -> 2
 *   itemAuthors host-after-finished clause      -> 1
 *
 * That is 8 of these 38 assertions, covering every guard added in response to
 * the milestone-2 review. The remaining 30 have not been mutation-checked.
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
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

// ---------------------------------------------------------------------------
// Regression tests for the four holes the milestone-2 review demonstrated.
// Each names the finding it guards, so that deleting the guard and watching
// the right test go red is a two-second exercise rather than a hunt.
// ---------------------------------------------------------------------------

describe('S1 - the reveal guard cannot be forced open', () => {
  it('refuses an item created with revealed already true', async () => {
    // The exploit was: host skips (deletes) an item, a player re-creates that
    // same id with revealed:true, and the itemAuthors document opens as a side
    // effect. Creation can no longer set the flag at all.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/itemAuthors/forged`), {
        authorPlayerId: PLAYER,
      })
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/forged`), {
        gameId: 'game1',
        text: 'forged',
        promptId: 'p1',
        revealed: true,
        createdAt: 0,
      }),
    )
  })

  it('allows the same creation with revealed false', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/itemAuthors/fresh`), {
        authorPlayerId: PLAYER,
      })
    })
    await assertSucceeds(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/fresh`), {
        gameId: 'game1',
        text: 'mine',
        promptId: 'p1',
        revealed: false,
        createdAt: 0,
      }),
    )
  })

  it('lets nobody delete an item, host included', async () => {
    // Deletion is what created the re-creation window. Removed rather than
    // restricted: no legitimate flow needs it, and the skip button never did.
    await assertFails(deleteDoc(doc(asHost(), `sessions/${SESSION}/items/${ITEM}`)))
    await assertFails(deleteDoc(doc(asPlayer(), `sessions/${SESSION}/items/${ITEM}`)))
  })

  it('lets only the host flip revealed, and only one way', async () => {
    await assertFails(
      updateDoc(doc(asPlayer(), `sessions/${SESSION}/items/${ITEM}`), { revealed: true }),
    )
    await assertSucceeds(
      updateDoc(doc(asHost(), `sessions/${SESSION}/items/${ITEM}`), { revealed: true }),
    )
    // ...and cannot be un-revealed afterwards.
    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}/items/${ITEM}`), { revealed: false }),
    )
  })
})

describe('S2 - gatherings cannot be enumerated', () => {
  it('refuses to list the sessions collection', async () => {
    // This is the assertion whose absence hid the hole: every original test
    // used getDoc, and the leak was only ever visible through getDocs.
    await assertFails(getDocs(collection(asOutsider(), 'sessions')))
    await assertFails(getDocs(collection(asPlayer(), 'sessions')))
  })

  it('still allows fetching one session by a known id, so a link can be opened', async () => {
    await assertSucceeds(getDoc(doc(asOutsider(), `sessions/${SESSION}`)))
  })

  it('refuses the player roster to someone who has not joined', async () => {
    // The roster holds real names. Reading it required only being signed in.
    await assertFails(getDocs(collection(asOutsider(), `sessions/${SESSION}/players`)))
    await assertFails(getDoc(doc(asOutsider(), `sessions/${SESSION}/players/${PLAYER}`)))
  })

  it('allows the roster to someone who has joined', async () => {
    await assertSucceeds(getDocs(collection(asPlayer(), `sessions/${SESSION}/players`)))
  })
})

describe('S3 - a vote cannot be cast after the answer is public', () => {
  it('refuses a vote created after the round is revealed', async () => {
    // The original suite only exercised update, using a player who already
    // had a vote document. A player who abstained has none, so their write
    // after the reveal is a create - which had no phase guard at all.
    await reveal('round')
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/rounds/${ROUND}/votes/${PLAYER}`), {
        votedForPlayerId: HOST,
        castAt: 0,
      }),
    )
  })

  it('allows a vote created while the round is still open', async () => {
    await assertSucceeds(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/rounds/${ROUND}/votes/${PLAYER}`), {
        votedForPlayerId: HOST,
        castAt: 0,
      }),
    )
  })

  it('still allows listing the breakdown once revealed, which scoring needs', async () => {
    await reveal('round')
    await assertSucceeds(
      getDocs(collection(asPlayer(), `sessions/${SESSION}/rounds/${ROUND}/votes`)),
    )
  })
})

describe('S4 - authorship cannot be stolen', () => {
  it('refuses an item whose author claim belongs to someone else', async () => {
    // Previously: the host submits an item, and before the host writes its
    // author document a player claims it. Now the item cannot exist until its
    // author claim does, and only its claimant can create it.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/itemAuthors/hostitem`), {
        authorPlayerId: HOST,
      })
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/hostitem`), {
        gameId: 'game1',
        text: 'stolen',
        promptId: 'p1',
        revealed: false,
        createdAt: 0,
      }),
    )
  })

  it('refuses an item with no author claim at all', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/unclaimed`), {
        gameId: 'game1',
        text: 'orphan',
        promptId: 'p1',
        revealed: false,
        createdAt: 0,
      }),
    )
  })

  it('refuses to overwrite an existing author claim', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/${ITEM}`), {
        authorPlayerId: PLAYER,
      }),
    )
  })
})

describe('R1 - unrevealed items can still become attributed facts', () => {
  it('lets the host read an unrevealed author once the gathering has finished', async () => {
    // Without this the ~12 items that never got a round would be unattributable
    // by anyone, forever - there is no server to make an exception from, and
    // DESIGN keeps them as facts attributed to their author.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}`), { phase: 'finished' })
    })
    await assertSucceeds(getDoc(doc(asHost(), `sessions/${SESSION}/itemAuthors/${ITEM}`)))
  })

  it('does not extend that to players', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}`), { phase: 'finished' })
    })
    await assertFails(getDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/${ITEM}`)))
  })

  it('does not open it to the host before the gathering finishes', async () => {
    await assertFails(getDoc(doc(asHost(), `sessions/${SESSION}/itemAuthors/${ITEM}`)))
  })

  it('never allows listing the author collection, in any state', async () => {
    // Deliberate, not incidental: a reader always already knows which itemId
    // they want. Asserted so it stays deliberate.
    await assertFails(getDocs(collection(asPlayer(), `sessions/${SESSION}/itemAuthors`)))
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}`), { phase: 'finished' })
    })
    await assertFails(getDocs(collection(asHost(), `sessions/${SESSION}/itemAuthors`)))
  })
})
