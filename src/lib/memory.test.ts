/**
 * Client-contract tests for memory.ts, run against the rules emulator -
 * milestone 7, whose gate is "emulator plus the abandoned-session case".
 *
 * Two claims matter here and are worth stating plainly, because both are the
 * kind that a green suite can hide:
 *
 *   1. the private store is private. A guest in the gathering cannot read the
 *      host's contacts, groups or facts - DESIGN calls a guest siphoning a
 *      family's accumulated memory a severe product failure;
 *   2. deleting a fact, a contact or a group really deletes it, including
 *      everything hanging off it. Firestore does not cascade, and a screen
 *      that says the memory is gone while the documents remain is worse than
 *      no deletion at all.
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HARVEST_PROMPTS } from '../content/prompts'
import {
  createGroup,
  deleteContact,
  deleteFact,
  deleteGroup,
  ensureContacts,
  matchName,
  nameGroup,
  recordFeedback,
  writeFactsForGame,
  writeRemainingFacts,
} from './memory'
import {
  paths,
  type ContactDoc,
  type FactDoc,
  type GroupDoc,
  type SessionDoc,
  type SessionFeedbackDoc,
} from './model'

const PROJECT_ID = 'demo-flashplay-memory'
const SESSION = 'session1'
const GAME = 'game1'
const HOST = 'host-uid'
const PLAYER = 'player-uid'
const PROMPT = HARVEST_PROMPTS[0].id

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

/** A finished gathering: two items, one revealed during play and one that
 *  never got a round - the asymmetry milestone 7 has to handle, since an
 *  unrevealed item's author is unreadable until the gathering ends. */
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, `sessions/${SESSION}`), {
      roomCode: 'ABCD',
      hostUid: HOST,
      groupId: null,
      phase: 'finished',
      currentGameId: GAME,
      scores: {},
      contactIds: {},
      createdAt: 0,
      expiresAt: 0,
    })
    for (const [uid, name] of [
      [HOST, 'Host'],
      [PLAYER, 'דוד'],
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
      phase: 'done',
      promptIds: [PROMPT, 'p2'],
      order: 0,
      startedAt: 0,
      phaseEndsAt: 0,
    })
    for (const [itemId, revealed] of [
      ['played', true],
      ['never-played', false],
    ] as const) {
      await setDoc(doc(db, `sessions/${SESSION}/items/${itemId}`), {
        gameId: GAME,
        text: `text of ${itemId}`,
        promptId: PROMPT,
        revealed,
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

const roster = [
  { id: HOST, name: 'Host' },
  { id: PLAYER, name: 'דוד' },
]

describe('createGroup', () => {
  // The room picker's own use case: a group made before any gathering, so it
  // has to start empty rather than inheriting whatever ensureContacts would
  // otherwise assume about an evening that has not happened yet.
  it('creates an empty, named group the host can immediately open a room for', async () => {
    const groupId = await createGroup(asHost(), HOST, 'החברים')

    const group = (await getDoc(doc(asHost(), paths.group(HOST, groupId)))).data() as
      | GroupDoc
      | undefined
    expect(group?.name).toBe('החברים')
    expect(group?.memberContactIds).toEqual([])
  })
})

describe('ensureContacts', () => {
  it('turns the room into contacts and points the gathering at the group', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    const group = (
      await getDoc(doc(asHost(), paths.group(HOST, SESSION)))
    ).data() as GroupDoc
    expect(group.name).toBe('המשפחה')
    expect(group.memberContactIds.sort()).toEqual(Object.values(contactIds).sort())

    const contact = (
      await getDoc(doc(asHost(), paths.contact(HOST, contactIds[PLAYER])))
    ).data() as ContactDoc
    expect(contact.name).toBe('דוד')

    const session = (await getDoc(doc(asHost(), paths.session(SESSION)))).data() as SessionDoc
    expect(session.groupId).toBe(SESSION)
    expect(session.contactIds[PLAYER]).toBe(contactIds[PLAYER])
  })

  // The list-flow payoff: a second gathering with the same people adds to
  // their records rather than making a parallel set of the same family.
  it('reuses a returning group’s contacts, matched by name', async () => {
    const first = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    const second = await ensureContacts(
      asHost(),
      HOST,
      SESSION,
      // Same person, typed with stray whitespace at the next gathering, and
      // signed in under a fresh anonymous uid.
      [{ id: 'new-uid', name: '  דוד ' }],
      SESSION,
    )

    expect(second['new-uid']).toBe(first[PLAYER])
    const group = (await getDoc(doc(asHost(), paths.group(HOST, SESSION)))).data() as GroupDoc
    expect(group.memberContactIds.sort()).toEqual(Object.values(first).sort())
    // An empty name on a return visit must not wipe the one already there.
    expect(group.name).toBe('המשפחה')
  })

  it('gives a new name its own record rather than guessing', async () => {
    const first = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    const second = await ensureContacts(
      asHost(),
      HOST,
      SESSION,
      [{ id: 'new-uid', name: 'דודי' }],
      SESSION,
    )

    expect(Object.values(first)).not.toContain(second['new-uid'])
  })

  it('refuses to write into somebody else’s store', async () => {
    await assertFails(
      setDoc(doc(asPlayer(), paths.contact(HOST, 'sneaky')), {
        name: 'x',
        claimedByUid: null,
        createdAt: 0,
      }),
    )
  })
})

describe('writeFactsForGame', () => {
  it('writes a fact per item, attributed to the author’s contact', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    const written = await writeFactsForGame(asHost(), HOST, SESSION, GAME)

    expect(written).toBe(2)
    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.size).toBe(2)
    const fact = facts.docs.find((d) => d.id === 'played')?.data() as FactDoc
    expect(fact.text).toBe('text of played')
    expect(fact.promptId).toBe(PROMPT)
    expect(fact.useCount).toBe(0)
    expect(fact.sessionId).toBe(SESSION)
  })

  // Idempotent by construction: a fact's document id is the item it came
  // from, so a host who ends a game twice - or whose connection dropped
  // halfway through - converges instead of duplicating. There is no server to
  // clean up afterwards.
  it('writes the same facts twice without duplicating them', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    await writeFactsForGame(asHost(), HOST, SESSION, GAME)
    await writeFactsForGame(asHost(), HOST, SESSION, GAME)

    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.size).toBe(2)
  })

  // The abandoned-session case the gate names: nobody saved the group, so
  // there is nobody to attribute anything to. It must be a quiet no-op rather
  // than an error or a pile of orphans.
  it('writes nothing, quietly, when the group was never saved', async () => {
    expect(await writeFactsForGame(asHost(), HOST, SESSION, GAME)).toBe(0)
  })

  it('keeps the items that never got a round - they are the point', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    await writeRemainingFacts(asHost(), HOST, SESSION)

    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.docs.map((d) => d.id).sort()).toEqual(['never-played', 'played'])
  })
})

describe('what the reviews found', () => {
  // The headline defect: contacts only existed once the host tapped "save the
  // group" at the very end, so every per-game write found nothing to
  // attribute to and wrote nothing. An evening abandoned after the first game
  // kept nothing at all - the exact opposite of why DESIGN writes facts per
  // game.
  it('keeps a game’s facts without anyone having saved the group', async () => {
    await ensureContacts(asHost(), HOST, SESSION, roster)

    expect(await writeFactsForGame(asHost(), HOST, SESSION, GAME)).toBe(2)
  })

  // Two people in one room who type the same name are two people. The first
  // version mapped both onto whichever contact the group already had, pooling
  // one person's answers into another's record.
  it('never puts two people in the room onto one contact', async () => {
    await ensureContacts(asHost(), HOST, SESSION, [{ id: 'first', name: 'דוד' }], null, 'המשפחה')

    const second = await ensureContacts(
      asHost(),
      HOST,
      SESSION,
      [
        { id: 'first', name: 'דוד' },
        { id: 'second', name: 'דוד' },
      ],
      SESSION,
    )

    expect(second['first']).not.toBe(second['second'])
  })

  // `useCount` drives DESIGN's "selection prefers unused facts". Re-running
  // the write used to reset it, which would quietly make every fact look
  // fresh again.
  it('does not reset a fact’s use counter when the write is re-run', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster)
    await writeFactsForGame(asHost(), HOST, SESSION, GAME)
    const factPath = `${paths.contactFacts(HOST, contactIds[PLAYER])}/played`
    await updateDoc(doc(asHost(), factPath), { useCount: 3 })

    await writeFactsForGame(asHost(), HOST, SESSION, GAME)

    expect(((await getDoc(doc(asHost(), factPath))).data() as FactDoc).useCount).toBe(3)
  })

  // The unreadable-author branch is the whole safety argument for calling
  // this at the end of every game, and every other test here runs against a
  // finished gathering where it never fires.
  it('skips an item whose author it cannot read yet, and keeps the rest', async () => {
    await ensureContacts(asHost(), HOST, SESSION, roster)
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      // Mid-evening: the gathering is still running, so the unrevealed item's
      // author is refused even to the host.
      await updateDoc(doc(ctx.firestore(), `sessions/${SESSION}`), { phase: 'playing' })
    })

    expect(await writeFactsForGame(asHost(), HOST, SESSION, GAME)).toBe(1)
  })

  // Every prompt shipped today is `personal`, so without injecting one the
  // group drawer is unreachable code carrying a DESIGN guarantee.
  it('puts a group-drawer answer in the group’s own memory, not a person’s', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster)

    await writeFactsForGame(asHost(), HOST, SESSION, GAME, [
      { id: PROMPT, drawer: 'group' },
    ])

    expect((await getDocs(collection(asHost(), paths.groupFacts(HOST, SESSION)))).size).toBe(2)
    expect(
      (await getDocs(collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])))).size,
    ).toBe(0)
  })

  it('takes a deleted contact out of its group’s member list', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    await deleteContact(asHost(), HOST, contactIds[PLAYER], SESSION)

    const group = (await getDoc(doc(asHost(), paths.group(HOST, SESSION)))).data() as GroupDoc
    expect(group.memberContactIds).not.toContain(contactIds[PLAYER])
  })

  it('names a group without touching who is in it', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster)

    await nameGroup(asHost(), HOST, SESSION, 'המשפחה')

    const group = (await getDoc(doc(asHost(), paths.group(HOST, SESSION)))).data() as GroupDoc
    expect(group.name).toBe('המשפחה')
    expect(group.memberContactIds.sort()).toEqual(Object.values(contactIds).sort())
  })
})

describe('the private store stays private', () => {
  // DESIGN: "a guest could read a family's entire accumulated memory" is the
  // failure this rule exists to prevent, and a guest of THIS gathering is the
  // one with the strongest claim to try.
  it('refuses a guest the host’s contacts, groups and facts', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await writeFactsForGame(asHost(), HOST, SESSION, GAME)

    await assertFails(getDoc(doc(asPlayer(), paths.group(HOST, SESSION))))
    await assertFails(getDocs(collection(asPlayer(), paths.groups(HOST))))
    await assertFails(getDoc(doc(asPlayer(), paths.contact(HOST, contactIds[PLAYER]))))
    await assertFails(
      getDocs(collection(asPlayer(), paths.contactFacts(HOST, contactIds[PLAYER]))),
    )
  })

  it('refuses a guest the host’s feedback about the evening', async () => {
    await recordFeedback(asHost(), HOST, SESSION, 'died', 6)

    await assertFails(getDoc(doc(asPlayer(), paths.sessionFeedback(HOST, SESSION))))
  })
})

describe('recordFeedback', () => {
  it('records the outcome and corrects it rather than duplicating', async () => {
    await recordFeedback(asHost(), HOST, SESSION, 'died', 6)
    await recordFeedback(asHost(), HOST, SESSION, 'good', 7)

    const all = await getDocs(collection(asHost(), `users/${HOST}/feedback`))
    expect(all.size).toBe(1)
    expect((all.docs[0].data() as SessionFeedbackDoc).outcome).toBe('good')
    expect((all.docs[0].data() as SessionFeedbackDoc).headcount).toBe(7)
  })
})

describe('deletion takes what hangs off it', () => {
  it('deletes one fact on its own', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await writeFactsForGame(asHost(), HOST, SESSION, GAME)

    await deleteFact(asHost(), `${paths.contactFacts(HOST, contactIds[PLAYER])}/played`)

    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.docs.map((d) => d.id)).toEqual(['never-played'])
  })

  it('takes a contact’s facts with the contact', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await writeFactsForGame(asHost(), HOST, SESSION, GAME)

    await deleteContact(asHost(), HOST, contactIds[PLAYER])

    expect((await getDoc(doc(asHost(), paths.contact(HOST, contactIds[PLAYER])))).exists()).toBe(
      false,
    )
    const orphans = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(orphans.size).toBe(0)
  })

  it('takes the whole group: its facts, its contacts and their facts', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await writeFactsForGame(asHost(), HOST, SESSION, GAME)

    await deleteGroup(asHost(), HOST, SESSION)

    expect((await getDoc(doc(asHost(), paths.group(HOST, SESSION)))).exists()).toBe(false)
    for (const contactId of Object.values(contactIds)) {
      expect((await getDoc(doc(asHost(), paths.contact(HOST, contactId)))).exists()).toBe(false)
      expect((await getDocs(collection(asHost(), paths.contactFacts(HOST, contactId)))).size).toBe(
        0,
      )
    }
  })
})

describe('matchName', () => {
  it('matches the same person typed carelessly', () => {
    expect(matchName('  דוד ')).toBe(matchName('דוד'))
    expect(matchName('Dana  Levi')).toBe(matchName('dana levi'))
  })

  // The direction it fails in matters: a missed match makes a duplicate
  // contact, a wrong match attaches one person's facts to another.
  it('does not match two different people', () => {
    expect(matchName('דודי')).not.toBe(matchName('דוד'))
  })
})

describe('the gathering document records the mapping, not the memory', () => {
  it('publishes contact ids to the room but nothing readable through them', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    // A player can see the session, so they can see the ids...
    const session = (await getDoc(doc(asPlayer(), paths.session(SESSION)))).data() as SessionDoc
    expect(session.contactIds[PLAYER]).toBe(contactIds[PLAYER])
    // ...and they are useless: the store those ids point into is closed.
    await assertFails(getDoc(doc(asPlayer(), paths.contact(HOST, contactIds[PLAYER]))))
  })

  it('refuses a player rewriting the mapping to steal someone’s facts', async () => {
    await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    await assertFails(
      updateDoc(doc(asPlayer(), paths.session(SESSION)), {
        contactIds: { [PLAYER]: 'some-other-contact' },
      }),
    )
  })
})
