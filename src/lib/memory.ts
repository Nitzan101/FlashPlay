/**
 * What the app keeps after the evening ends - milestone 7.
 *
 * Everything written here lands in the host's own private store
 * (`users/{uid}/...`), which firestore.rules makes readable by its owner and
 * nobody else. That is not a convenience: DESIGN calls a guest siphoning a
 * family's accumulated memory a severe product failure, and the store is the
 * one place in this app where several gatherings' worth of it sits together.
 *
 * Three things happen here, in this order over an evening:
 *
 *   1. the host saves the group, which turns the people in the room into
 *      contacts and gives every later write something durable to attribute to;
 *   2. facts are written **at the end of each game**, so a gathering that is
 *      abandoned halfway keeps whatever was actually played (DESIGN);
 *   3. the unrevealed items' facts are written when the gathering ends, which
 *      is the first moment their authors are readable at all - see
 *      firestore.rules, `itemAuthors`.
 *
 * Every write is keyed by something already unique (the item id, the session
 * id), so re-running any of it converges instead of duplicating. There is no
 * server to clean up after a host whose phone dropped mid-write.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { HARVEST_PROMPTS } from '../content/prompts'
import { db } from './firebase'
import { errorCode, step } from './room'
import {
  paths,
  type ContactDoc,
  type FactDoc,
  type GroupDoc,
  type ItemAuthorDoc,
  type ItemDoc,
  type SessionDoc,
  type SessionFeedbackDoc,
} from './model'

/**
 * Makes sure everyone in the room has a contact to attribute facts to, and
 * that this gathering points at a group.
 *
 * **This runs at the end of every game, not at the end of the evening.** The
 * first version tied it to the host's "save the group" tap, which DESIGN puts
 * at the end - and that quietly cost the thing DESIGN asks for two paragraphs
 * earlier: "facts are written at the end of each game rather than at the end
 * of the gathering, so an abandoned session keeps whatever was already
 * played". With nothing to attribute to until the final screen, an evening
 * that stopped after the first game kept nothing at all. Two independent
 * reviews found it on 2026-09-14.
 *
 * What the host's tap at the end still decides is whether this group is worth
 * *keeping*: `nameGroup` gives it a name and puts it on the shelf for next
 * time, and `deleteGroup` throws the evening away. Until one of those
 * happens, the records exist in the host's own private store and nowhere
 * else.
 *
 * A returning group's people keep the contacts they already have, matched by
 * name (see matchName); only genuinely new names get a new record. The
 * session's `contactIds` map is what every later fact is attributed through -
 * a guest's uid is anonymous and different at every gathering, so the contact
 * is the only identity here that survives the evening.
 */
export async function ensureContacts(
  firestore: Firestore,
  hostUid: string,
  sessionId: string,
  players: { id: string; name: string }[],
  /** The group this gathering belongs to, when the host opened the room for
   *  one they had already saved. A first gathering has none and becomes its
   *  own group. */
  existingGroupId: string | null = null,
  name = '',
): Promise<Record<string, string>> {
  const groupId = existingGroupId ?? sessionId
  const groupSnap = await step('read-group', () =>
    getDoc(doc(firestore, paths.group(hostUid, groupId))),
  )
  const existingGroup = groupSnap.data() as GroupDoc | undefined

  // Who this group already knows, by name. A returning guest signs in
  // anonymously and gets a NEW uid every gathering, so the name is the only
  // thing connecting the person at the table to the record of them - see
  // matchName for why it is normalised rather than compared raw.
  const byName: Record<string, string> = {}
  for (const contactId of existingGroup?.memberContactIds ?? []) {
    const contactSnap = await getDoc(doc(firestore, paths.contact(hostUid, contactId)))
    const contact = contactSnap.data() as ContactDoc | undefined
    if (contact) byName[matchName(contact.name)] = contactId
  }

  const contactIds: Record<string, string> = {}
  // One contact per person, and never two people onto one: two guests in the
  // same room who both type "דוד" are two people, whatever the group already
  // knows. Without this the second one's answers were written into the first
  // one's record - the exact wrong-match failure matchName's comment claims
  // cannot happen.
  const taken = new Set<string>()
  for (const player of players) {
    const matched = byName[matchName(player.name)]
    const contactId = matched && !taken.has(matched) ? matched : crypto.randomUUID()
    taken.add(contactId)
    contactIds[player.id] = contactId
    await step('write-contact', () =>
      setDoc(
        doc(firestore, paths.contact(hostUid, contactId)),
        {
          name: player.name,
          // A guest's anonymous uid is not a claim on anything - DESIGN's
          // "upgrade" path is a registered account claiming this record
          // later, which does not exist yet.
          claimedByUid: null,
          createdAt: Date.now(),
        } satisfies ContactDoc,
        { merge: true },
      ),
    )
  }

  const members = new Set([
    ...(existingGroup?.memberContactIds ?? []),
    ...Object.values(contactIds),
  ])
  await step('write-group', () =>
    setDoc(
      doc(firestore, paths.group(hostUid, groupId)),
      {
        name: name || existingGroup?.name || '',
        memberContactIds: [...members],
        createdAt: existingGroup?.createdAt ?? Date.now(),
      } satisfies GroupDoc,
      { merge: true },
    ),
  )

  await step('link-session-to-group', () =>
    updateDoc(doc(firestore, paths.session(sessionId)), { groupId, contactIds }),
  )

  return contactIds
}

/**
 * A group made before any gathering, from the host's own room picker.
 *
 * Every other group in this store is born as a side effect of an evening (see
 * ensureContacts), which meant a host could only ever have groups for people
 * they had already played with - there was no way to set one up in advance
 * and no way to add one they had simply forgotten to name. It starts empty:
 * the first gathering opened for it fills in its members.
 *
 * Returns the new group's id, so the caller can select it immediately.
 */
export async function createGroup(
  firestore: Firestore,
  hostUid: string,
  name: string,
): Promise<string> {
  const groupId = crypto.randomUUID()
  await step('create-group', () =>
    setDoc(doc(firestore, paths.group(hostUid, groupId)), {
      name,
      memberContactIds: [],
      createdAt: Date.now(),
    } satisfies GroupDoc),
  )
  return groupId
}

/** The host's end-of-evening offer: keep this group, under this name, so the
 *  next gathering with these people continues their memory instead of
 *  starting a parallel one. Everything it names already exists - see
 *  ensureContacts. Also how the details screen renames one. */
export async function nameGroup(
  firestore: Firestore,
  hostUid: string,
  groupId: string,
  name: string,
): Promise<void> {
  await step('name-group', () =>
    setDoc(doc(firestore, paths.group(hostUid, groupId)), { name }, { merge: true }),
  )
}

/**
 * How two spellings of the same person are decided to be the same person.
 *
 * Deliberately crude: trimmed, collapsed whitespace, lower-cased. It is the
 * whole of DESIGN's "list flow" that survived the privacy constraint - the
 * design's "tap your name" needs the member list to be readable before
 * joining, and the roster is protected precisely so that holding the link
 * does not hand over a family's names (see firestore.rules, `players`). So a
 * returning person types their name as before, and matching happens in the
 * host's own store, where the names already live.
 *
 * Its failure mode is a duplicate contact, not a wrong one: "דוד " matches
 * "דוד", "דודי" does not. That is the right direction to fail in, since a
 * wrong match would attach one person's facts to another.
 */
export function matchName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Writes one fact per item of a finished game, to the drawer its prompt
 * decided (DESIGN: "what determines which drawer a fact lands in is the
 * wording of the harvest question that collected it, fixed once when the game
 * is written - not a runtime classifier").
 *
 * Only items whose author this caller can actually read are written, which is
 * what makes this safe to call at the end of every game: during the evening
 * that means the revealed ones, and once the gathering is finished it means
 * all of them. Returns how many facts it wrote.
 */
export async function writeFactsForGame(
  firestore: Firestore,
  hostUid: string,
  sessionId: string,
  gameId: string,
  /** The pool the drawer is read from. A parameter only so that a test can
   *  exercise the group drawer: every prompt shipped today is `personal`, so
   *  the group path would otherwise be unreachable code with a guarantee
   *  written on it (DESIGN: "a group fact is confined to the group where it
   *  was said and never crosses between groups"). */
  prompts: readonly { id: string; drawer: 'personal' | 'group' }[] = HARVEST_PROMPTS,
): Promise<number> {
  const sessionSnap = await step('read-session', () =>
    getDoc(doc(firestore, paths.session(sessionId))),
  )
  const session = sessionSnap.data() as SessionDoc
  const contactIds = session.contactIds ?? {}
  // Nothing to attribute to yet - the host has not saved the group, so there
  // are no contacts. DESIGN puts that offer at the end of the evening, and a
  // fact with no owner has nowhere to live.
  if (Object.keys(contactIds).length === 0) return 0

  const itemsSnap = await step('read-items', () =>
    getDocs(query(collection(firestore, paths.items(sessionId)), where('gameId', '==', gameId))),
  )

  // Counts what this game has kept in total, not what this particular call
   // happened to write: most of it was usually written the last time this ran,
  // and "we kept 2 answers" under-reports an evening of twelve.
  let kept = 0
  for (const itemDoc of itemsSnap.docs) {
    const item = itemDoc.data() as ItemDoc
    const prompt = prompts.find((p) => p.id === item.promptId)
    if (!prompt) {
      // A prompt that has left the pool since the gathering ran. The item's
      // drawer is undecidable, and DESIGN is explicit that the drawer comes
      // from the question rather than from the text, so guessing is not an
      // option - but it should not vanish silently either.
      console.warn('[FlashPlay] no prompt for item, skipping its fact:', item.promptId)
      continue
    }

    const authorSnap = await getDoc(doc(firestore, paths.itemAuthor(sessionId, itemDoc.id))).catch(
      (error: unknown) => {
        // Expected while the gathering is still running: an unrevealed item's
        // author is unreadable, and its fact is written when the evening
        // ends. Anything else is a real failure and must not pass as one of
        // those - a silently dropped fact is indistinguishable from an item
        // nobody played.
        if (errorCode(error) !== 'permission-denied') {
          console.error('[FlashPlay] reading an item author failed:', errorCode(error), error)
        }
        return null
      },
    )
    if (!authorSnap?.exists()) continue

    const { authorPlayerId } = authorSnap.data() as ItemAuthorDoc
    const contactId = contactIds[authorPlayerId]
    if (!contactId) continue

    const fact: FactDoc = {
      text: item.text,
      promptId: item.promptId,
      authorContactId: contactId,
      useCount: 0,
      sessionId,
      createdAt: Date.now(),
    }
    // A personal fact travels with the person; a group fact stays with the
    // group forever and never crosses to another one.
    const path =
      prompt.drawer === 'personal'
        ? `${paths.contactFacts(hostUid, contactId)}/${itemDoc.id}`
        : `${paths.groupFacts(hostUid, session.groupId ?? sessionId)}/${itemDoc.id}`

    // Written once. Re-running must not reset `useCount` - selection prefers
    // unused facts, so a host who ends a game twice would otherwise make
    // every fact look fresh again.
    const existing = await getDoc(doc(firestore, path))
    kept += 1
    if (existing.exists()) continue

    await step('write-fact', () => setDoc(doc(firestore, path), fact))
  }
  return kept
}

/** Every game's facts, for a gathering that has ended. The unrevealed items'
 *  authors only become readable at that point, so this is the write that
 *  keeps them rather than losing them (DESIGN: unrevealed items are "kept as
 *  facts for future gatherings"). Returns the evening's whole tally, including
 *  what was already written between games. */
export async function writeRemainingFacts(
  firestore: Firestore,
  hostUid: string,
  sessionId: string,
): Promise<number> {
  const gamesSnap = await step('read-games', () =>
    getDocs(collection(firestore, paths.games(sessionId))),
  )
  let kept = 0
  for (const game of gamesSnap.docs) {
    kept += await writeFactsForGame(firestore, hostUid, sessionId, game.id)
  }
  return kept
}

/** The host's own note on how the evening went. Keyed by session id, so
 *  answering again corrects it rather than adding a second answer. */
export async function recordFeedback(
  firestore: Firestore,
  hostUid: string,
  sessionId: string,
  outcome: SessionFeedbackDoc['outcome'],
  headcount: number,
): Promise<void> {
  await step('write-feedback', () =>
    setDoc(doc(firestore, paths.sessionFeedback(hostUid, sessionId)), {
      outcome,
      headcount,
      sessionId,
      createdAt: Date.now(),
    } satisfies SessionFeedbackDoc),
  )
}

/**
 * **Deleting anything here deletes what hangs off it, because Firestore does
 * not.** A deleted contact whose facts survive is worse than no deletion at
 * all: the screen says the memory is gone while the documents sit there,
 * reachable by id. This is the same trap that made session deletion unsafe in
 * milestone 2 - see firestore.rules - and the reason this app deletes from
 * the leaves up.
 */
export async function deleteFact(
  firestore: Firestore,
  factPath: string,
): Promise<void> {
  await step('delete-fact', () => deleteDoc(doc(firestore, factPath)))
}

export async function deleteContact(
  firestore: Firestore,
  hostUid: string,
  contactId: string,
  /** The group to drop this contact from, when it is being deleted on its
   *  own. Left out when the whole group is going anyway. */
  groupId: string | null = null,
): Promise<void> {
  const factsSnap = await step('read-contact-facts', () =>
    getDocs(collection(firestore, paths.contactFacts(hostUid, contactId))),
  )
  for (const fact of factsSnap.docs) {
    await step('delete-fact', () => deleteDoc(fact.ref))
  }
  await step('delete-contact', () => deleteDoc(doc(firestore, paths.contact(hostUid, contactId))))

  if (groupId) {
    // Otherwise the id stays in the member list, and the next ensureContacts
    // reads it back as a member who no longer exists.
    const groupSnap = await getDoc(doc(firestore, paths.group(hostUid, groupId)))
    const group = groupSnap.data() as GroupDoc | undefined
    if (group) {
      await step('prune-group-members', () =>
        updateDoc(doc(firestore, paths.group(hostUid, groupId)), {
          memberContactIds: group.memberContactIds.filter((id) => id !== contactId),
        }),
      )
    }
  }
}

/** Deletes a group, its facts, and the contacts that exist only for it. The
 *  contacts go too: DESIGN's "one-tap deletion" is about the group's memory,
 *  and a contact left behind is the same half-deletion as an orphan fact. */
export async function deleteGroup(
  firestore: Firestore,
  hostUid: string,
  groupId: string,
): Promise<void> {
  const groupSnap = await step('read-group', () =>
    getDoc(doc(firestore, paths.group(hostUid, groupId))),
  )
  const group = groupSnap.data() as GroupDoc | undefined

  const factsSnap = await step('read-group-facts', () =>
    getDocs(collection(firestore, paths.groupFacts(hostUid, groupId))),
  )
  for (const fact of factsSnap.docs) {
    await step('delete-fact', () => deleteDoc(fact.ref))
  }
  for (const contactId of group?.memberContactIds ?? []) {
    await deleteContact(firestore, hostUid, contactId)
  }
  await step('delete-group', () => deleteDoc(doc(firestore, paths.group(hostUid, groupId))))
}

export interface RememberedFact {
  /** Full Firestore path, so deleting one needs no knowledge of which drawer
   *  it came from. */
  path: string
  text: string
  /** The contact this fact is attributed to, named. */
  who: string
}

/**
 * One person in the group, with everything remembered about them.
 *
 * **The grouping is the point, not a convenience.** This used to come back as
 * one flat list of "who: text" lines, which reads fine at three facts and
 * becomes an undifferentiated wall at ten - the screen's whole job is
 * answering "what do we know about each person", and a flat list makes that a
 * scanning exercise. A member with nothing recorded is still listed, for the
 * same reason: "we know nothing about דוד yet" is itself an answer, and
 * dropping the row makes it look like דוד is not in the group at all.
 */
export interface RememberedMember {
  contactId: string
  name: string
  facts: RememberedFact[]
}

export interface GroupMemory {
  groupName: string
  members: RememberedMember[]
  /** Facts about the group as a whole rather than about one person - a
   *  separate drawer in the store (see FactDrawer), so a separate section on
   *  screen rather than scattered among the people. */
  groupFacts: RememberedFact[]
  loading: boolean
  error: string | null
}

/**
 * "What we remember about this group", for the owner's eyes only - the screen
 * DESIGN asks for, with the deletion that makes it meaningful.
 *
 * Reads the group's own facts plus every member contact's, which is what a
 * person actually means by "what does it know about us".
 */
export function useGroupMemory(hostUid: string | null, groupId: string | null): GroupMemory {
  const [state, setState] = useState<GroupMemory>({
    groupName: '',
    members: [],
    groupFacts: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!hostUid || !groupId) {
      setState({ groupName: '', members: [], groupFacts: [], loading: false, error: null })
      return
    }
    let cancelled = false

    async function load(uid: string, id: string) {
      const groupSnap = await getDoc(doc(db, paths.group(uid, id)))
      const group = groupSnap.data() as GroupDoc | undefined
      const contactNames: Record<string, string> = {}
      const members: RememberedMember[] = []

      for (const contactId of group?.memberContactIds ?? []) {
        const contactSnap = await getDoc(doc(db, paths.contact(uid, contactId)))
        const contact = contactSnap.data() as ContactDoc | undefined
        const name = contact?.name ?? ''
        contactNames[contactId] = name
        const contactFacts = await getDocs(collection(db, paths.contactFacts(uid, contactId)))
        members.push({
          contactId,
          name,
          facts: contactFacts.docs.map((factDoc) => ({
            path: factDoc.ref.path,
            text: (factDoc.data() as FactDoc).text,
            who: name,
          })),
        })
      }
      // By name, so the list does not reshuffle between visits: member ids come
      // back in whatever order the group document happens to hold them, which
      // changes every time a gathering appends someone.
      members.sort((a, b) => a.name.localeCompare(b.name, 'he'))

      const groupFactsSnap = await getDocs(collection(db, paths.groupFacts(uid, id)))
      const groupFacts = groupFactsSnap.docs.map((factDoc) => {
        const fact = factDoc.data() as FactDoc
        return {
          path: factDoc.ref.path,
          text: fact.text,
          who: contactNames[fact.authorContactId] ?? '',
        }
      })

      if (!cancelled) {
        setState({ groupName: group?.name ?? '', members, groupFacts, loading: false, error: null })
      }
    }

    void load(hostUid, groupId).catch((error: unknown) => {
      if (cancelled) return
      console.error('[FlashPlay] reading the group memory failed:', errorCode(error), error)
      setState((prev) => ({ ...prev, loading: false, error: errorCode(error) }))
    })

    return () => {
      cancelled = true
    }
  }, [hostUid, groupId])

  return state
}

/** Just the group's name, for the one question the end-of-evening screen
 *  needs answered: has this group been kept, or is it still only this
 *  gathering's own record? Empty string means the latter. */
export function useGroupName(hostUid: string | null, groupId: string | null): {
  name: string
  loading: boolean
} {
  const [state, setState] = useState({ name: '', loading: true })

  useEffect(() => {
    if (!hostUid || !groupId) {
      setState({ name: '', loading: false })
      return
    }
    let cancelled = false
    void getDoc(doc(db, paths.group(hostUid, groupId)))
      .then((snap) => {
        if (cancelled) return
        setState({ name: (snap.data() as GroupDoc | undefined)?.name ?? '', loading: false })
      })
      .catch((error: unknown) => {
        // Not shown: the screen falls back to offering the save, and saving
        // again is harmless.
        console.error('[FlashPlay] reading the group name failed:', errorCode(error), error)
        if (!cancelled) setState({ name: '', loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [hostUid, groupId])

  return state
}

export interface SavedGroupsState {
  groups: (GroupDoc & { id: string })[]
  loading: boolean
  error: string | null
}

/**
 * The host's saved groups - the ones they actually chose to keep.
 *
 * Every gathering writes a group document as soon as it has anything to
 * attribute (see ensureContacts), so the collection also holds one record per
 * evening nobody named. Those are this-evening bookkeeping, not a group the
 * host recognises: listing them put three buttons all reading "new group" on
 * the landing page, each of which silently appended tonight to some
 * unidentifiable past evening. A name is what makes a group a group.
 */
export function useSavedGroups(hostUid: string | null): SavedGroupsState {
  const [state, setState] = useState<SavedGroupsState>({
    groups: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!hostUid) {
      setState({ groups: [], loading: false, error: null })
      return
    }
    setState({ groups: [], loading: true, error: null })
    const unsubscribe = onSnapshot(
      collection(db, paths.groups(hostUid)),
      (snap) => {
        const groups = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as GroupDoc) }))
          .filter((group) => group.name !== '')
        groups.sort((a, b) => b.createdAt - a.createdAt)
        setState({ groups, loading: false, error: null })
      },
      (error) => {
        console.error('[FlashPlay] saved groups listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, loading: false, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [hostUid])

  return state
}

