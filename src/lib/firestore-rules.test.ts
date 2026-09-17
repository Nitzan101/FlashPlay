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
 * A second review then found that the first round of fixes had itself created
 * two new holes, and that the claim "every rule granting a read has a list
 * assertion beside it" was not true when written - `games`, `rounds`, `items`,
 * the private store and the pre-reveal vote list all had none. They do now.
 * State coverage by pointing at assertions, never by describing them.
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
 *   sessions phase monotonicity                 -> 1
 *   sessions `allow delete: if false`           -> 1
 *   itemAuthors claim-before-item existence     -> 1
 *   sessions hostUid immutability               -> 1
 *
 * That is 12 of the first 48 assertions - every guard added in response to
 * either review. The remaining 36 of those have not been mutation-checked.
 *
 * Milestone 3 added 15 more to this file (63 total here; 70 across the whole
 * suite with room.test.ts) for the room-code lifecycle - see
 * SessionDoc.roomCode and RoomCodeDoc in src/lib/model.ts. Three of its
 * guards have been mutation-checked the same way, the third added after an
 * independent review found the first version of this rule never checked a
 * claim's sessionId/hostUid pointed anywhere real:
 *
 *   isRegistered() (host vs. guest token)         -> 2 assertions
 *   roomCodes update requires prior expiry        -> 1
 *   roomCodes create session cross-check          -> 2
 *
 * The `isRegistered()` count above was wrong in an earlier version of this
 * file - it claimed 2 assertions when the roomCodes one was overdetermined
 * (it also failed the session cross-check regardless of registration, so it
 * could not attribute the denial to isRegistered() at all). A second
 * independent review re-ran the mutation and caught it. Fixed by giving that
 * test a session genuinely hosted by the guest, isolating the one clause
 * actually under test - see the comment on "M3 - room codes ... refuses a
 * guest's anonymous token". Recorded here as a warning to the next person
 * writing a mutation-check claim in this file: re-derive it, do not trust
 * the sentence that came before yours, including this one.
 *
 * The session cross-check above is verified for `create` only; `update`
 * carries an identical clause that has not been independently mutated.
 *
 * A separate client-contract suite, room.test.ts, proves the actual
 * claim/retry loop in src/lib/room.ts end to end against these same rules -
 * not just what the rules allow in isolation.
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
import { ROOM_CODE_CLOCK_SKEW_MARGIN_MS, ROOM_CODE_WINDOW_MS } from './model'

const PROJECT_ID = 'demo-flashplay'
const SESSION = 'session1'
const HOST = 'host-uid'
const PLAYER = 'player-uid'
const OUTSIDER = 'outsider-uid'
const ITEM = 'item1'
const ROUND = 'round1'
const GAME = 'game1'
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
    // M4: a real games/{gameId} document is required now that items' create
    // rule reads its phase (get() on a document that does not exist errors
    // rather than denying cleanly, so every item-creation test below needs
    // this to exist regardless of which guard it is actually exercising).
    await setDoc(doc(db, `sessions/${SESSION}/games/${GAME}`), {
      type: 'who-said-that',
      phase: 'harvesting',
      promptIds: [PROMPT, 'p2'],
      order: 0,
      startedAt: 0,
      phaseEndsAt: 0,
    })
    await setDoc(doc(db, `sessions/${SESSION}/items/${ITEM}`), {
      gameId: GAME,
      text: 'I left my phone on the car roof',
      promptId: PROMPT,
      revealed: false,
      createdAt: 0,
    })
    await setDoc(doc(db, `sessions/${SESSION}/itemAuthors/${ITEM}`), {
      authorPlayerId: HOST,
      gameId: GAME,
      promptId: PROMPT,
    })
    // The submission slot ITEM's claim above points at - see
    // PromptSubmissionDoc in src/lib/model.ts. Kept consistent with it so a
    // test that re-derives ITEM's write sequence from scratch (rather than
    // trusting this seed) finds a coherent fixture.
    await setDoc(doc(db, `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${HOST}`), {
      itemId: ITEM,
      submittedAt: 0,
    })
    await setDoc(doc(db, `sessions/${SESSION}/rounds/${ROUND}`), {
      gameId: GAME,
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
// HOST and OUTSIDER carry a realistic non-anonymous provider claim because
// isRegistered() checks it. Without this, an independent review found these
// tests were passing "registered" checks for the wrong reason: the emulator's
// default mock token omits `firebase.sign_in_provider` entirely rather than
// setting it to a real provider, so isRegistered() was passing vacuously on
// an absent claim, not on a genuine non-anonymous one - see firestore.rules,
// isRegistered().
const asHost = () =>
  testEnv.authenticatedContext(HOST, { firebase: { sign_in_provider: 'google.com' } }).firestore()
const asOutsider = () =>
  testEnv
    .authenticatedContext(OUTSIDER, { firebase: { sign_in_provider: 'google.com' } })
    .firestore()
const asAnonymous = () => testEnv.unauthenticatedContext().firestore()

// A real Firebase guest, as opposed to `asAnonymous` above (which is not
// signed in at all - see the comment on "refuses an unauthenticated client
// entirely"). A guest DOES have request.auth != null; the token just carries
// the anonymous sign-in provider, which is what isRegistered() checks.
const asGuest = () =>
  testEnv.authenticatedContext(PLAYER, { firebase: { sign_in_provider: 'anonymous' } }).firestore()

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
      // Not HOST: naming yourself is refused by validVote on its own, which
      // would make this pass without the reveal guard doing anything - the
      // overdetermined-assertion trap this project has been caught by before.
      updateDoc(doc(asHost(), `sessions/${SESSION}/rounds/${ROUND}/votes/${HOST}`), {
        votedForPlayerId: PLAYER,
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
    expect(paths.roomCode('1234')).toBe('roomCodes/1234')
    expect(paths.promptSubmission(SESSION, GAME, PROMPT, HOST)).toBe(
      `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${HOST}`,
    )
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
        gameId: GAME,
        promptId: PROMPT,
      })
    })
    await assertSucceeds(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/fresh`), {
        gameId: GAME,
        text: 'mine',
        promptId: PROMPT,
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

  it('refuses the host rewriting text in the very update that reveals it', async () => {
    // Found by an independent review: constraining the `revealed` flag alone
    // left every other field open on that same write, so the host could
    // frame anyone for anything at the exact moment the room reads it.
    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}/items/${ITEM}`), {
        revealed: true,
        text: 'התוקף שינה את זה',
      }),
    )
    // The one-field reveal is still fine on its own.
    await assertSucceeds(
      updateDoc(doc(asHost(), `sessions/${SESSION}/items/${ITEM}`), { revealed: true }),
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

// ---------------------------------------------------------------------------
// Regression tests for what the FIRST round of fixes broke or newly exposed.
// The re-review asked the opposite question - not what an attacker can still
// reach, but what the tightening cost - and these are its findings.
// ---------------------------------------------------------------------------

describe('F1 - the host cannot peek at the answer key mid-game', () => {
  it('refuses to move a gathering backwards out of finished', async () => {
    // The exploit: phase -> finished, read every author, phase -> playing.
    // The host is a scoring player, and DESIGN says their screen never
    // contains the answer. Ending the gathering to peek now ends it for real.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}`), { phase: 'finished' })
    })
    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}`), { phase: 'playing' }),
    )
    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}`), { phase: 'lobby' }),
    )
  })

  it('still allows moving forward', async () => {
    await assertSucceeds(
      updateDoc(doc(asHost(), `sessions/${SESSION}`), { phase: 'finished' }),
    )
  })

  it('refuses to hand the gathering to a different host', async () => {
    await assertFails(
      updateDoc(doc(asHost(), `sessions/${SESSION}`), { hostUid: PLAYER }),
    )
  })
})

describe('F2 - a session id cannot be recycled', () => {
  it('refuses to delete a session, so its subcollections can never be inherited', async () => {
    // Deleting a Firestore document leaves its subcollections behind. With the
    // room code as the document id, a freed id would let the next creator
    // inherit the previous gathering's roster, items and author claims.
    await assertFails(deleteDoc(doc(asHost(), `sessions/${SESSION}`)))
  })
})

describe('F4 - authorship cannot be rewritten by deleting the claim', () => {
  it('refuses a claim on an item that already exists', async () => {
    // Delete-then-create is an update by another route: the host may delete a
    // claim, and without this a player could then claim an already-revealed
    // item as their own.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), `sessions/${SESSION}/itemAuthors/${ITEM}`))
      // A real submission slot for PLAYER naming ITEM, so the only reason
      // this can fail is the guard actually under test (the item still
      // exists) - not an incidental missing-field error that would deny it
      // for the wrong reason.
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${PLAYER}`),
        { itemId: ITEM, submittedAt: 0 },
      )
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/${ITEM}`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
        promptId: PROMPT,
      }),
    )
  })

  it('still allows a claim for an item that does not exist yet', async () => {
    // M4: the claim must also point at a submission slot this player has
    // already reserved for this exact item id - see the M4 describe block
    // below for that guard's own tests.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${PLAYER}`),
        { itemId: 'brandnew', submittedAt: 0 },
      )
    })
    await assertSucceeds(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/brandnew`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
        promptId: PROMPT,
      }),
    )
  })
})

describe('F8 - the list gaps the coverage claim had papered over', () => {
  it('keeps rounds and games readable to players and closed to outsiders', async () => {
    await assertSucceeds(getDocs(collection(asPlayer(), `sessions/${SESSION}/rounds`)))
    await assertSucceeds(getDocs(collection(asPlayer(), `sessions/${SESSION}/games`)))
    await assertFails(getDocs(collection(asOutsider(), `sessions/${SESSION}/rounds`)))
    await assertFails(getDocs(collection(asOutsider(), `sessions/${SESSION}/games`)))
  })

  it('keeps items listable by players and closed to outsiders', async () => {
    await assertSucceeds(getDocs(collection(asPlayer(), `sessions/${SESSION}/items`)))
    await assertFails(getDocs(collection(asOutsider(), `sessions/${SESSION}/items`)))
  })

  it('refuses to list votes before the round is revealed', async () => {
    // The list form of this milestone's headline hidden-data claim, which the
    // previous suite tested only as a single-document read.
    await assertFails(
      getDocs(collection(asPlayer(), `sessions/${SESSION}/rounds/${ROUND}/votes`)),
    )
  })

  it("refuses another user's private store to a list as well as a get", async () => {
    await assertFails(getDocs(collection(asPlayer(), `users/${HOST}/contacts`)))
    await assertFails(getDocs(collection(asPlayer(), `users/${HOST}/groups`)))
  })
})

// ---------------------------------------------------------------------------
// Milestone 3: room, joining, presence, player identity.
//
// The room code stopped being the session's document id - see
// SessionDoc.roomCode and RoomCodeDoc in src/lib/model.ts for why. That
// unblocks the squatting problem BACKLOG.md recorded after milestone 2: a
// code can now expire and be reclaimed instead of being denied forever.
// ---------------------------------------------------------------------------

const NEW_SESSION = 'new-session'
const CODE = '1234'
const now = () => Date.now()

describe('M3 - only a registered host may open a gathering', () => {
  it("refuses a guest's anonymous token", async () => {
    // DESIGN: "A registered host (Google, one tap) is required to open a
    // gathering." A guest DOES have request.auth != null (unlike asAnonymous
    // above) - only the sign-in provider tells them apart.
    await assertFails(
      setDoc(doc(asGuest(), `sessions/${NEW_SESSION}`), {
        roomCode: CODE,
        hostUid: PLAYER,
        groupId: null,
        phase: 'lobby',
        currentGameId: null,
        scores: {},
        createdAt: 0,
        expiresAt: 0,
      }),
    )
  })

  it('allows a registered user to open one', async () => {
    await assertSucceeds(
      setDoc(doc(asHost(), `sessions/${NEW_SESSION}`), {
        roomCode: CODE,
        hostUid: HOST,
        groupId: null,
        phase: 'lobby',
        currentGameId: null,
        scores: {},
        createdAt: 0,
        expiresAt: 0,
      }),
    )
  })
})

describe('M3 - room codes are get-only, bounded, and reclaimable once expired', () => {
  // A second real session, hosted by OUTSIDER, so tests below that claim or
  // reclaim a code pointing at it exercise only the guard actually under
  // test - not an incidental failure because sessionId points at nothing.
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${NEW_SESSION}`), {
        roomCode: 'WXYZ',
        hostUid: OUTSIDER,
        groupId: null,
        phase: 'lobby',
        currentGameId: null,
        scores: {},
        createdAt: 0,
        expiresAt: 0,
      })
    })
  })

  it('never allows listing room codes', async () => {
    // Same reasoning as sessions: a code must be received via a join link,
    // never found by sweeping the collection.
    await assertFails(getDocs(collection(asOutsider(), 'roomCodes')))
  })

  it('lets a registered host create a code within the allowed window', async () => {
    await assertSucceeds(
      setDoc(doc(asHost(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: now(),
        expiresAt: now() + ROOM_CODE_WINDOW_MS - 1000,
      }),
    )
  })

  it("refuses a guest's anonymous token", async () => {
    // Must be isolated to isRegistered() alone: an independent review found
    // an earlier version of this test pointed at SESSION (hosted by HOST)
    // while naming PLAYER as hostUid, so it was ALSO failing the session
    // cross-check regardless of registration - overdetermined, and unable to
    // say which guard actually did the denying. A session genuinely hosted
    // by the guest makes isRegistered() the only clause that can fail here.
    const guestHostedSession = 'guest-hosted-session'
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${guestHostedSession}`), {
        roomCode: 'ABCD',
        hostUid: PLAYER,
        groupId: null,
        phase: 'lobby',
        currentGameId: null,
        scores: {},
        createdAt: 0,
        expiresAt: 0,
      })
    })
    await assertFails(
      setDoc(doc(asGuest(), `roomCodes/${CODE}`), {
        sessionId: guestHostedSession,
        hostUid: PLAYER,
        createdAt: now(),
        expiresAt: now() + 1000,
      }),
    )
  })

  it('refuses a code created already expired', async () => {
    await assertFails(
      setDoc(doc(asHost(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: now(),
        expiresAt: now() - 1000,
      }),
    )
  })

  it('refuses a code reserved past the maximum window', async () => {
    // Without this ceiling, a host could reserve a code indefinitely - the
    // exact permanent-squatting problem this collection exists to remove.
    await assertFails(
      setDoc(doc(asHost(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: now(),
        expiresAt: now() + ROOM_CODE_WINDOW_MS + 60_000,
      }),
    )
  })

  it('lets anyone resolve one code by id, so a join link can be opened', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: now(),
        expiresAt: now() + 1000,
      })
    })
    await assertSucceeds(getDoc(doc(asOutsider(), `roomCodes/${CODE}`)))
  })

  it('refuses to overwrite a code that has not expired yet', async () => {
    // This is the squatting guard: without it, anyone could steal an
    // in-use code out from under its current gathering.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: now(),
        expiresAt: now() + 60_000,
      })
    })
    await assertFails(
      setDoc(doc(asOutsider(), `roomCodes/${CODE}`), {
        sessionId: NEW_SESSION,
        hostUid: OUTSIDER,
        createdAt: now(),
        expiresAt: now() + 1000,
      }),
    )
  })

  it('lets a new host reclaim a code once it has expired', async () => {
    // This is the actual fix for the milestone-2 finding: a squatted or
    // abandoned code returns to circulation without a server.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: now() - ROOM_CODE_WINDOW_MS - 1000,
        expiresAt: now() - 1000,
      })
    })
    await assertSucceeds(
      setDoc(doc(asOutsider(), `roomCodes/${CODE}`), {
        sessionId: NEW_SESSION,
        hostUid: OUTSIDER,
        createdAt: now(),
        expiresAt: now() + 1000,
      }),
    )
  })

  it('is never deletable directly', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: now(),
        expiresAt: now() + 1000,
      })
    })
    await assertFails(deleteDoc(doc(asHost(), `roomCodes/${CODE}`)))
  })

  it('refuses to claim a code for a session hosted by someone else', async () => {
    // An independent review found the first version of this rule never
    // checked this at all: a client could name any sessionId and hostUid it
    // liked. HOST here names their own uid as hostUid but points at
    // NEW_SESSION, which is genuinely hosted by OUTSIDER.
    await assertFails(
      setDoc(doc(asHost(), `roomCodes/${CODE}`), {
        sessionId: NEW_SESSION,
        hostUid: HOST,
        createdAt: now(),
        expiresAt: now() + 1000,
      }),
    )
  })

  it('refuses to claim a code for a session that does not exist', async () => {
    await assertFails(
      setDoc(doc(asHost(), `roomCodes/${CODE}`), {
        sessionId: 'no-such-session',
        hostUid: HOST,
        createdAt: now(),
        expiresAt: now() + 1000,
      }),
    )
  })

  // --- the clock-skew outage, 2026-09-07 -----------------------------------
  //
  // Live symptom: every room-code claim denied, deterministically, on a
  // laptop whose clock ran ~200ms ahead of Firestore's. The ceiling compares
  // a CLIENT-computed `expiresAt` against the SERVER's clock, so asking for
  // exactly the maximum window only succeeds when the client is not ahead.
  //
  // The emulator cannot reproduce the real cause - one machine, one clock -
  // so these two simulate it by computing `expiresAt` the way a fast client
  // would: from a clock running SIMULATED_SKEW_MS ahead of this one.

  const SIMULATED_SKEW_MS = 2 * 60 * 1000

  it('refuses the full window from a client whose clock runs fast (the outage)', async () => {
    const fastClientNow = now() + SIMULATED_SKEW_MS
    await assertFails(
      setDoc(doc(asHost(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: fastClientNow,
        expiresAt: fastClientNow + ROOM_CODE_WINDOW_MS, // no margin - what shipped
      }),
    )
  })

  it('accepts the margined window from that same fast client (the fix)', async () => {
    const fastClientNow = now() + SIMULATED_SKEW_MS
    await assertSucceeds(
      setDoc(doc(asHost(), `roomCodes/${CODE}`), {
        sessionId: SESSION,
        hostUid: HOST,
        createdAt: fastClientNow,
        expiresAt: fastClientNow + ROOM_CODE_WINDOW_MS - ROOM_CODE_CLOCK_SKEW_MARGIN_MS,
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Milestone 4: the session state machine and the harvest phase.
//
// "Duplicate blocking" (MILESTONES.md) is enforced through the submission
// slot at games/{gameId}/prompts/{promptId}/submissions/{uid} - see
// PromptSubmissionDoc in src/lib/model.ts. The headline claim, mutation-
// checked below ("temporarily allowing update... turns the duplicate-
// blocking assertion red"): a player may reserve at most one slot per prompt
// per game, because the document id is their own uid and it is never
// updatable once created.
// ---------------------------------------------------------------------------

const OTHER_PROMPT = 'p2'

describe('M4 - submission slots: one player, one prompt, one attempt', () => {
  it('lets a player reserve a slot for a prompt they have not yet answered', async () => {
    await assertSucceeds(
      setDoc(
        doc(asPlayer(), `sessions/${SESSION}/games/${GAME}/prompts/${OTHER_PROMPT}/submissions/${PLAYER}`),
        { itemId: 'fresh-item', submittedAt: 0 },
      ),
    )
  })

  it('refuses a second reservation for the same prompt - this is "duplicate blocking"', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}/prompts/${OTHER_PROMPT}/submissions/${PLAYER}`),
        { itemId: 'first-item', submittedAt: 0 },
      )
    })
    await assertFails(
      setDoc(
        doc(asPlayer(), `sessions/${SESSION}/games/${GAME}/prompts/${OTHER_PROMPT}/submissions/${PLAYER}`),
        { itemId: 'second-item', submittedAt: 0 },
      ),
    )
  })

  it('refuses reserving a slot on someone else\'s behalf', async () => {
    await assertFails(
      setDoc(
        doc(asPlayer(), `sessions/${SESSION}/games/${GAME}/prompts/${OTHER_PROMPT}/submissions/${HOST}`),
        { itemId: 'stolen-slot', submittedAt: 0 },
      ),
    )
  })

  it('refuses a slot reservation once the game has moved past harvesting', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}`), { phase: 'rounds' })
    })
    await assertFails(
      setDoc(
        doc(asPlayer(), `sessions/${SESSION}/games/${GAME}/prompts/${OTHER_PROMPT}/submissions/${PLAYER}`),
        { itemId: 'too-late', submittedAt: 0 },
      ),
    )
  })

  // The headline read guard. The seeded slot belongs to HOST and records
  // ITEM's id, and every player can read ITEM's text - so anyone able to read
  // this document, or list the collection, holds the answer key the whole
  // first game depends on withholding. The first version of the rule was
  // `read: if isPlayer(sessionId)` and granted exactly that.
  it("refuses a player another player's slot, and refuses listing them to anyone", async () => {
    await assertFails(
      getDoc(
        doc(asPlayer(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${HOST}`),
      ),
    )
    await assertFails(
      getDocs(collection(asPlayer(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions`)),
    )
    // The host is a scoring player too (DESIGN), so listing is closed to them
    // for the same reason it is closed to everyone else.
    await assertFails(
      getDocs(collection(asHost(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions`)),
    )
  })

  it('lets a player read back only their own slot, and an outsider nothing', async () => {
    await assertSucceeds(
      getDoc(
        doc(asHost(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${HOST}`),
      ),
    )
    await assertFails(
      getDoc(
        doc(asOutsider(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${HOST}`),
      ),
    )
  })

  it('refuses a shape carrying fields other than itemId/submittedAt', async () => {
    await assertFails(
      setDoc(
        doc(asPlayer(), `sessions/${SESSION}/games/${GAME}/prompts/${OTHER_PROMPT}/submissions/${PLAYER}`),
        { itemId: 'sneaky', submittedAt: 0, extra: 'field' },
      ),
    )
  })
})

describe('M4 - an item must match the slot and claim that reserved it', () => {
  it('refuses an authorship claim naming an item id its slot did not reserve', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}/prompts/${OTHER_PROMPT}/submissions/${PLAYER}`),
        { itemId: 'reserved-item', submittedAt: 0 },
      )
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/different-item`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
        promptId: OTHER_PROMPT,
      }),
    )
  })

  it('refuses a claim carrying fields other than authorPlayerId/gameId/promptId', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}/prompts/${OTHER_PROMPT}/submissions/${PLAYER}`),
        { itemId: 'sneaky-claim', submittedAt: 0 },
      )
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/itemAuthors/sneaky-claim`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
        promptId: OTHER_PROMPT,
        extra: 'field',
      }),
    )
  })

  it('refuses an item whose declared promptId does not match its own claim', async () => {
    // A player who reserved a slot for one prompt cannot spend the claim it
    // produced on an item tagged as a different prompt - that would defeat
    // the one-per-prompt cap by laundering it through a mismatched tag.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/itemAuthors/mismatched`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
        promptId: PROMPT,
      })
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/mismatched`), {
        gameId: GAME,
        text: 'x',
        promptId: OTHER_PROMPT,
        revealed: false,
        createdAt: 0,
      }),
    )
  })

  it('refuses an item created after the game has moved past harvesting', async () => {
    // The host advancing the phase must not leave a race where a submission
    // already in flight still silently lands.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/itemAuthors/toolate`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
        promptId: PROMPT,
      })
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${PLAYER}`),
        { itemId: 'toolate', submittedAt: 0 },
      )
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}`), { phase: 'rounds' })
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/toolate`), {
        gameId: GAME,
        text: 'too late',
        promptId: PROMPT,
        revealed: false,
        createdAt: 0,
      }),
    )
  })
})

describe('M4 - item text is bounded, since it is public the instant it lands', () => {
  it('refuses empty text', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/itemAuthors/empty`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
        promptId: PROMPT,
      })
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${PLAYER}`),
        { itemId: 'empty', submittedAt: 0 },
      )
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/empty`), {
        gameId: GAME,
        text: '',
        promptId: PROMPT,
        revealed: false,
        createdAt: 0,
      }),
    )
  })

  it('refuses text past the bound (mirrors ITEM_TEXT_MAX_LENGTH)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/itemAuthors/toolong`), {
        authorPlayerId: PLAYER,
        gameId: GAME,
        promptId: PROMPT,
      })
      await setDoc(
        doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}/prompts/${PROMPT}/submissions/${PLAYER}`),
        { itemId: 'toolong', submittedAt: 0 },
      )
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/items/toolong`), {
        gameId: GAME,
        text: 'x'.repeat(301),
        promptId: PROMPT,
        revealed: false,
        createdAt: 0,
      }),
    )
  })
})

describe('M5 - joining is blocked inside the round loop, and nowhere else', () => {
  // DESIGN: "Joining is permitted between games and also during the
  // submission phase, and blocked only inside the round loop." Someone
  // arriving mid-round would become a vote option in a round they never
  // heard.
  const joinAsOutsider = () =>
    setDoc(doc(asOutsider(), `sessions/${SESSION}/players/${OUTSIDER}`), {
      name: 'Late',
      uid: OUTSIDER,
      hasDevice: true,
      lastSeenAt: 0,
      joinedAt: 0,
      votedRoundId: null,
    })

  const setGamePhase = async (phase: string) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}/games/${GAME}`), { phase })
    })
  }

  it('lets someone join during the harvest', async () => {
    await assertSucceeds(joinAsOutsider())
  })

  it('refuses a join once the round loop has started', async () => {
    await setGamePhase('rounds')
    await assertFails(joinAsOutsider())
  })

  it('lets someone join again between games', async () => {
    await setGamePhase('done')
    await assertSucceeds(joinAsOutsider())
  })

  it('lets someone join a gathering that has no game yet', async () => {
    // The rule get()s the current game, and a get() on a document that does
    // not exist fails the whole evaluation - so a lobby with currentGameId
    // null must short-circuit before reaching it.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}`), {
        phase: 'lobby',
        currentGameId: null,
      })
    })
    await assertSucceeds(joinAsOutsider())
  })
})

describe('M4 - games are shape-checked on create', () => {
  const wellFormed = {
    type: 'who-said-that',
    phase: 'harvesting',
    promptIds: ['a', 'b'],
    order: 1,
    startedAt: 0,
    phaseEndsAt: 0,
  }

  it('refuses a non-host opening a game', async () => {
    await assertFails(setDoc(doc(asPlayer(), `sessions/${SESSION}/games/newgame`), wellFormed))
  })

  it('refuses a game opened in a phase other than harvesting', async () => {
    await assertFails(
      setDoc(doc(asHost(), `sessions/${SESSION}/games/newgame`), { ...wellFormed, phase: 'rounds' }),
    )
  })

  it('refuses a game opened with the wrong number of prompts (mirrors PROMPTS_PER_GATHERING)', async () => {
    await assertFails(
      setDoc(doc(asHost(), `sessions/${SESSION}/games/newgame`), { ...wellFormed, promptIds: ['a'] }),
    )
  })

  it('lets the host open a well-formed game', async () => {
    await assertSucceeds(setDoc(doc(asHost(), `sessions/${SESSION}/games/newgame`), wellFormed))
  })
})

// From Nitzan's own manual walkthrough, 2026-09-16: two structurally different
// players sharing a display name made every screen that names a player by
// looking it up - the reveal, the scoreboard - ambiguous about which one was
// meant. room.ts's reserveName() (exercised end to end in room.test.ts)
// depends on two properties of this rule that room.test.ts's own tests
// cannot isolate from each other: only the slot's own uid may ever claim it,
// and once claimed a slot is never writable again by anyone, including its
// own holder. Mutation-checked: removing the self-uid check turns the first
// assertion below red; removing `allow create` entirely (leaving no update
// rule either) turns the third red.
describe('playerNames - one slot per display name, self-uid only, never updatable', () => {
  it('refuses claiming a name slot under a uid that is not the caller\'s own', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/playerNames/forged`), { uid: OUTSIDER }),
    )
  })

  it('lets a player claim a fresh name slot under their own uid', async () => {
    await assertSucceeds(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/playerNames/newname`), { uid: PLAYER }),
    )
  })

  it('refuses rewriting an already-claimed slot, even by the uid that holds it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/playerNames/taken`), { uid: PLAYER })
    })
    await assertFails(
      setDoc(doc(asPlayer(), `sessions/${SESSION}/playerNames/taken`), { uid: PLAYER }),
    )
  })

  it('is readable by anyone signed in, so a first-time guest can check before their own player document exists', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}/playerNames/taken`), { uid: PLAYER })
    })
    await assertSucceeds(getDoc(doc(asOutsider(), `sessions/${SESSION}/playerNames/taken`)))
  })
})

// Milestone 8: a player's own answers to the guided questions. Private, not
// public like an item - no other player may ever read one, and the host may
// only once the gathering is finished (there is no "revealed" moment here
// that would make an earlier read safe, unlike itemAuthors).
describe('profileAnswers - private to the answering player and the host', () => {
  const path = `sessions/${SESSION}/players/${PLAYER}/profileAnswers/hobby`
  const answer = { questionId: 'hobby', answer: 'ציור', updatedAt: 0 }

  it('lets a player create their own answer', async () => {
    await assertSucceeds(setDoc(doc(asPlayer(), path), answer))
  })

  it('lets a player update their own answer, any number of times', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), answer)
    })
    await assertSucceeds(setDoc(doc(asPlayer(), path), { ...answer, answer: 'משהו אחר' }))
  })

  it("refuses another player writing into someone else's profileAnswers", async () => {
    await assertFails(setDoc(doc(asHost(), path), answer))
  })

  it('refuses a questionId that does not match the document id', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), path), { ...answer, questionId: 'a-different-question' }),
    )
  })

  it('refuses an extra field beyond the declared shape', async () => {
    await assertFails(setDoc(doc(asPlayer(), path), { ...answer, authorPlayerId: PLAYER }))
  })

  it('lets a player read their own answer', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), answer)
    })
    await assertSucceeds(getDoc(doc(asPlayer(), path)))
  })

  it('refuses another player reading it, regardless of gathering phase', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), answer)
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}`), { phase: 'finished' }, { merge: true })
    })
    await assertFails(getDoc(doc(asOutsider(), path)))
  })

  // Deliberately not gated on `finished`, unlike itemAuthors - see the
  // comment on the rule itself for why: the gate there stops a live vote
  // being swayed by an early peek, and nothing here is voted on. The first
  // version of this rule required `finished`, which meant `writeProfileFacts`
  // could only ever run at the very end of the evening - an abandoned or
  // early-closed gathering lost every guided answer for good, unlike every
  // other fact source in the app. Found live, 2026-09-17.
  it('lets the host read it while the gathering is still running, mid-game', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), answer)
    })
    await assertSucceeds(getDoc(doc(asHost(), path)))
  })

  it('lets the host read it once the gathering is finished, too', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), answer)
      await setDoc(doc(ctx.firestore(), `sessions/${SESSION}`), { phase: 'finished' }, { merge: true })
    })
    await assertSucceeds(getDoc(doc(asHost(), path)))
  })

  it('lets a player delete their own answer, retracting it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), answer)
    })
    await assertSucceeds(deleteDoc(doc(asPlayer(), path)))
  })
})
