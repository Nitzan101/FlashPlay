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
  addManualFact,
  addManualGroupFact,
  createGroup,
  deleteContact,
  deleteFact,
  deleteGroup,
  ensureContacts,
  importSharedGroup,
  linkPlayerToContact,
  matchName,
  nameGroup,
  shareGroup,
  recordFeedback,
  writeFactsForGame,
  writeProfileFacts,
  writeRemainingFacts,
} from './memory'
import {
  paths,
  type ContactDoc,
  type FactDoc,
  type GroupDoc,
  type ProfileQuestion,
  type SessionDoc,
  type SessionFeedbackDoc,
} from './model'

const PROJECT_ID = 'demo-flashplay-memory'
const SESSION = 'session1'
const GAME = 'game1'
const HOST = 'host-uid'
const OTHER_HOST = 'other-host-uid'
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
/** A second registered host, for the share/import handover - a share is only
 *  meaningful between two separate accounts. */
const asOtherHost = () =>
  testEnv
    .authenticatedContext(OTHER_HOST, { firebase: { sign_in_provider: 'google.com' } })
    .firestore() as unknown as Firestore

const roster = [
  { id: HOST, name: 'Host' },
  { id: PLAYER, name: 'דוד' },
]

// The manual override for exactly what matchName() cannot do: a returning
// person who typed a different name this time - see LinkPlayers.tsx.
describe('linkPlayerToContact', () => {
  it('records the link on the session, without disturbing anyone else’s', async () => {
    const first = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    await linkPlayerToContact(asHost(), SESSION, 'someone-new', first[PLAYER])

    const session = (await getDoc(doc(asHost(), paths.session(SESSION)))).data() as SessionDoc
    expect(session.contactIds['someone-new']).toBe(first[PLAYER])
    expect(session.contactIds[HOST]).toBe(first[HOST])
  })

  // The whole point: without this, ensureContacts' next pass - which runs at
  // the end of every game - would recompute the map purely by name and throw
  // the host's correction away.
  it('survives the next ensureContacts pass, instead of being overwritten by name-matching', async () => {
    const first = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    const davidsContact = first[PLAYER]

    // Same person, back under a new anonymous uid and a name that matches
    // nothing the group knows - so name-matching alone would mint them a
    // brand-new contact and start their memory over.
    const returning = [{ id: 'new-uid', name: 'Ella' }]
    await linkPlayerToContact(asHost(), SESSION, 'new-uid', davidsContact)

    const after = await ensureContacts(asHost(), HOST, SESSION, returning, SESSION)

    expect(after['new-uid']).toBe(davidsContact)
  })

  it('still gives an unlinked, unmatched player their own fresh contact', async () => {
    await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    const after = await ensureContacts(
      asHost(),
      HOST,
      SESSION,
      [{ id: 'stranger-uid', name: 'מישהו חדש לגמרי' }],
      SESSION,
    )

    expect(after['stranger-uid']).toBeDefined()
    expect(Object.values(after)).toHaveLength(1)
  })

  it('refuses a guest linking players to contacts', async () => {
    await expect(
      linkPlayerToContact(asPlayer(), SESSION, PLAYER, 'whatever-contact'),
    ).rejects.toThrow()
  })
})

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

// Milestone 8's collector: a player's guided-question answers, turned into
// facts. Session-scoped answers are seeded directly (bypassing the rules
// this file is not about) - profileQuestions.test.ts proves the client
// function that actually writes them drives the rules correctly.
describe('writeProfileFacts', () => {
  const QUESTIONS: ProfileQuestion[] = [{ id: 'hobby', text: 'התחביב שלך', kind: 'text' }]

  async function seedAnswer(uid: string, questionId: string, answer: string | string[]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.profileAnswer(SESSION, uid, questionId)), {
        questionId,
        answer,
        updatedAt: 0,
      })
    })
  }

  it('turns an answered question into a fact under the answering contact', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await seedAnswer(PLAYER, 'hobby', 'ציור')

    const kept = await writeProfileFacts(asHost(), HOST, SESSION, roster, QUESTIONS)

    expect(kept).toBe(1)
    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.docs[0].data().text).toBe('התחביב שלך: ציור')
  })

  it('joins a multi-choice answer with commas', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await seedAnswer(PLAYER, 'hobby', ['ציור', 'ריצה'])

    await writeProfileFacts(asHost(), HOST, SESSION, roster, QUESTIONS)

    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.docs[0].data().text).toBe('התחביב שלך: ציור, ריצה')
  })

  // The whole reason this upserts instead of writing once - unlike a
  // harvest fact, a profile answer is explicitly editable up to the moment
  // the evening ends (the lobby's own per-question save button says so).
  it('updates the fact when the answer changes, rather than freezing the first value', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await seedAnswer(PLAYER, 'hobby', 'ציור')
    await writeProfileFacts(asHost(), HOST, SESSION, roster, QUESTIONS)

    await seedAnswer(PLAYER, 'hobby', 'ריצה')
    await writeProfileFacts(asHost(), HOST, SESSION, roster, QUESTIONS)

    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.size).toBe(1)
    expect(facts.docs[0].data().text).toBe('התחביב שלך: ריצה')
  })

  it('treats a cleared (empty) answer as a retraction, not a fact', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await seedAnswer(PLAYER, 'hobby', '')

    const kept = await writeProfileFacts(asHost(), HOST, SESSION, roster, QUESTIONS)

    expect(kept).toBe(0)
    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.size).toBe(0)
  })

  it('writes nothing, quietly, when the group was never saved', async () => {
    await seedAnswer(PLAYER, 'hobby', 'ציור')
    expect(await writeProfileFacts(asHost(), HOST, SESSION, roster, QUESTIONS)).toBe(0)
  })

  // The actual fix, 2026-09-17: the first version could only ever collect
  // once the gathering reached `finished`, so a room closed earlier lost
  // every guided answer for good. This proves it now runs from BetweenGames,
  // mid-gathering, against the real rules - not just against a session
  // seeded as already finished, which every other test in this block is.
  it('collects an answer while the gathering is still running, not only once finished', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), paths.session(SESSION)), { phase: 'playing' })
    })
    await seedAnswer(PLAYER, 'hobby', 'ציור')

    const kept = await writeProfileFacts(asHost(), HOST, SESSION, roster, QUESTIONS)

    expect(kept).toBe(1)
    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.docs[0].data().text).toBe('התחביב שלך: ציור')
  })

  it("includes the session's own custom questions alongside the built-ins passed in", async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), paths.session(SESSION)), {
        customQuestions: [{ id: 'custom1', text: 'שאלה מותאמת', kind: 'text' }],
      })
    })
    await seedAnswer(PLAYER, 'custom1', 'תשובה')

    const kept = await writeProfileFacts(asHost(), HOST, SESSION, roster, [])

    expect(kept).toBe(1)
    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.docs[0].data().text).toBe('שאלה מותאמת: תשובה')
  })
})

// Handing a whole saved group to a different host: a one-time copy staged in
// `groupShares`, because neither account can reach into the other's store.
describe('shareGroup and importSharedGroup', () => {
  it("copies the group, its people and their facts into the other host's own store", async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await addManualFact(asHost(), HOST, contactIds[PLAYER], 'אוהב פיצה אננס')
    await addManualGroupFact(asHost(), HOST, SESSION, 'תמיד מאחרים')

    const shareId = await shareGroup(asHost(), HOST, SESSION)
    const newGroupId = await importSharedGroup(asOtherHost(), OTHER_HOST, shareId)

    const group = (
      await getDoc(doc(asOtherHost(), paths.group(OTHER_HOST, newGroupId)))
    ).data() as GroupDoc
    expect(group.name).toBe('המשפחה')
    expect(group.memberContactIds).toHaveLength(roster.length)

    const names: string[] = []
    const facts: string[] = []
    for (const contactId of group.memberContactIds) {
      const contact = (
        await getDoc(doc(asOtherHost(), paths.contact(OTHER_HOST, contactId)))
      ).data() as ContactDoc
      names.push(contact.name)
      const contactFacts = await getDocs(
        collection(asOtherHost(), paths.contactFacts(OTHER_HOST, contactId)),
      )
      facts.push(...contactFacts.docs.map((d) => (d.data() as FactDoc).text))
    }
    expect(names.sort()).toEqual(['Host', 'דוד'])
    expect(facts).toContain('אוהב פיצה אננס')

    const groupFacts = await getDocs(
      collection(asOtherHost(), paths.groupFacts(OTHER_HOST, newGroupId)),
    )
    expect(groupFacts.docs.map((d) => (d.data() as FactDoc).text)).toEqual(['תמיד מאחרים'])
  })

  // The headline promise: a copy, not a link. Whatever either side does
  // afterwards must not reach the other.
  it('leaves the two copies completely independent afterwards', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    const shareId = await shareGroup(asHost(), HOST, SESSION)
    const newGroupId = await importSharedGroup(asOtherHost(), OTHER_HOST, shareId)

    // The sender adds something new after sharing.
    await addManualFact(asHost(), HOST, contactIds[PLAYER], 'נוסף אחרי השיתוף')

    const imported = (
      await getDoc(doc(asOtherHost(), paths.group(OTHER_HOST, newGroupId)))
    ).data() as GroupDoc
    const allImportedFacts: string[] = []
    for (const contactId of imported.memberContactIds) {
      const contactFacts = await getDocs(
        collection(asOtherHost(), paths.contactFacts(OTHER_HOST, contactId)),
      )
      allImportedFacts.push(...contactFacts.docs.map((d) => (d.data() as FactDoc).text))
    }
    expect(allImportedFacts).not.toContain('נוסף אחרי השיתוף')
    // And the new copy uses its own contact ids, so sharing the same group
    // twice - or back again - can never merge two accounts' records.
    expect(imported.memberContactIds).not.toContain(contactIds[PLAYER])
  })

  it('refuses to share a group the caller does not own', async () => {
    await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await expect(shareGroup(asOtherHost(), HOST, SESSION)).rejects.toThrow()
  })

  it('refuses an expired share', async () => {
    await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    const shareId = await shareGroup(asHost(), HOST, SESSION)
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), paths.groupShare(shareId)), {
        expiresAt: Date.now() - 1000,
      })
    })

    await expect(importSharedGroup(asOtherHost(), OTHER_HOST, shareId)).rejects.toThrow(
      'share-expired',
    )
  })

  it('refuses importing a share that does not exist', async () => {
    await expect(
      importSharedGroup(asOtherHost(), OTHER_HOST, 'no-such-share'),
    ).rejects.toThrow('share-not-found')
  })
})

describe('addManualFact and addManualGroupFact', () => {
  it("adds a free-form fact directly to a person's contact", async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    await addManualFact(asHost(), HOST, contactIds[PLAYER], 'אוהב פיצה אננס')

    const facts = await getDocs(
      collection(asHost(), paths.contactFacts(HOST, contactIds[PLAYER])),
    )
    expect(facts.docs.map((d) => d.data().text)).toEqual(['אוהב פיצה אננס'])
  })

  it('adds a free-form fact to the group itself', async () => {
    await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')

    await addManualGroupFact(asHost(), HOST, SESSION, 'תמיד מגיעים באיחור')

    const facts = await getDocs(collection(asHost(), paths.groupFacts(HOST, SESSION)))
    expect(facts.docs.map((d) => d.data().text)).toEqual(['תמיד מגיעים באיחור'])
  })

  it('refuses a guest adding a fact to another host\'s store', async () => {
    const contactIds = await ensureContacts(asHost(), HOST, SESSION, roster, null, 'המשפחה')
    await expect(
      addManualFact(asPlayer(), HOST, contactIds[PLAYER], 'x'),
    ).rejects.toThrow()
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
