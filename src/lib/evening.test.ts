/**
 * One whole evening, end to end, against the rules emulator.
 *
 * Every other suite proves one milestone's own contract. This one plays the
 * product: a host opens a room, three people join, everyone answers the
 * prompts, the room plays "who said that", then "most likely to" built from
 * what the first game revealed, the evening ends, and what was said that night
 * is in the host's store afterwards.
 *
 * It exists because the milestone-7 review found a feature that was fully
 * implemented, fully unit-tested and a complete no-op in production - the
 * pieces were right and the order they ran in was not. A suite of correct
 * parts cannot catch that; only running the whole thing in the order the
 * product runs it can.
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HARVEST_PROMPTS } from '../content/prompts'
import {
  advanceGamePhase,
  pickHarvestPromptIds,
  startHarvestGame,
  submitHarvestItem,
} from './harvest'
import { ensureContacts, writeFactsForGame, writeRemainingFacts } from './memory'
import { paths, type FactDoc, type SessionDoc } from './model'
import { createRoom, joinRoom } from './room'
import {
  castVote,
  finishGame,
  openNextRound,
  openVoting,
  revealRound,
  scoreRound,
} from './rounds'
import { endGathering, openNextSecondRound, scoreMajority, startSecondGame } from './secondGame'

const PROJECT_ID = 'demo-flashplay-evening'
const HOST = 'host-uid'
const DANA = 'dana-uid'
const YOSSI = 'yossi-uid'

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

const asHost = () =>
  testEnv
    .authenticatedContext(HOST, { firebase: { sign_in_provider: 'google.com' } })
    .firestore() as unknown as Firestore
const asGuest = (uid: string) =>
  testEnv
    .authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } })
    .firestore() as unknown as Firestore

describe('a whole evening', () => {
  it('runs from an empty room to a memory of what was said', async () => {
    const host = asHost()
    const dana = asGuest(DANA)
    const yossi = asGuest(YOSSI)

    // --- the room ---------------------------------------------------------
    const { sessionId, roomCode } = await createRoom(host, HOST, () => '4321')
    expect(roomCode).toBe('4321')
    await joinRoom(host, sessionId, HOST, 'המארח')
    await joinRoom(dana, sessionId, DANA, 'דנה')
    await joinRoom(yossi, sessionId, YOSSI, 'יוסי')

    const roster = await getDocs(collection(host, paths.players(sessionId)))
    expect(roster.size).toBe(3)

    // --- the harvest ------------------------------------------------------
    const [promptA, promptB] = pickHarvestPromptIds(() => 0)
    const gameId = await startHarvestGame(host, sessionId, [promptA, promptB], () => 'game1')

    const answers: Record<string, [Firestore, string, string]> = {
      'host-a': [host, HOST, 'המפתחות של האוטו'],
      'dana-a': [dana, DANA, 'הטלפון על הגג'],
      'yossi-a': [yossi, YOSSI, 'הארנק בסופר'],
      'dana-b': [dana, DANA, 'גבינה צהובה'],
    }
    for (const [itemId, [as, uid, text]] of Object.entries(answers)) {
      await submitHarvestItem(
        as,
        sessionId,
        gameId,
        itemId.endsWith('-b') ? promptB : promptA,
        uid,
        text,
        () => itemId,
      )
    }

    // Nobody can see who wrote what - the whole first game depends on it.
    const beforeAnyReveal = await getDocs(collection(dana, paths.items(sessionId)))
    expect(beforeAnyReveal.size).toBe(4)
    for (const item of beforeAnyReveal.docs) {
      expect(item.data().revealed).toBe(false)
    }

    // --- "who said that" --------------------------------------------------
    await advanceGamePhase(host, sessionId, gameId, 'rounds')

    for (let round = 0; round < 2; round++) {
      const roundId = await openNextRound(host, sessionId, gameId, undefined, () => 0)
      expect(roundId).not.toBeNull()
      await openVoting(host, sessionId, roundId!)

      // Everyone votes for Dana, right or wrong - the arithmetic is checked
      // in scoring.test.ts; what matters here is that the round closes.
      for (const [as, uid] of [
        [host, HOST],
        [yossi, YOSSI],
      ] as const) {
        await castVote(as, sessionId, roundId!, uid, DANA)
      }
      await castVote(dana, sessionId, roundId!, DANA, YOSSI)

      const summary = await revealRound(host, sessionId, roundId!)
      expect(summary.awarded).toEqual(scoreRound(summary.votes, summary.authorPlayerId))
    }

    const afterTwoRounds = (await getDoc(doc(host, paths.session(sessionId)))).data() as SessionDoc
    expect(Object.values(afterTwoRounds.scores).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)

    // --- between the games: what has been played is already kept ----------
    await finishGame(host, sessionId, gameId)
    await ensureContacts(host, HOST, sessionId, [
      { id: HOST, name: 'המארח' },
      { id: DANA, name: 'דנה' },
      { id: YOSSI, name: 'יוסי' },
    ])
    const keptAfterFirstGame = await writeFactsForGame(host, HOST, sessionId, gameId)
    // Two of the four items were revealed, so two are attributable so far.
    expect(keptAfterFirstGame).toBe(2)

    // --- "most likely to", built from what the first game revealed --------
    const secondGameId = await startSecondGame(host, sessionId, 1, () => 'game2')
    const secondRound = await openNextSecondRound(
      host,
      sessionId,
      secondGameId,
      undefined,
      () => 0,
    )
    expect(secondRound).not.toBeNull()

    const playedItem = (await getDoc(doc(host, paths.round(sessionId, secondRound!)))).data()
      ?.itemId as string
    // Only an item the room already heard attributed, or the two games are
    // the same question twice (DESIGN).
    expect((await getDoc(doc(host, paths.item(sessionId, playedItem)))).data()?.revealed).toBe(true)

    await openVoting(host, sessionId, secondRound!)
    await castVote(host, sessionId, secondRound!, HOST, YOSSI)
    await castVote(dana, sessionId, secondRound!, DANA, YOSSI)
    // Allowed here and refused in the first game: "me" is an honest answer to
    // "who is most likely to".
    await castVote(yossi, sessionId, secondRound!, YOSSI, YOSSI)

    const secondSummary = await revealRound(host, sessionId, secondRound!, scoreMajority)
    expect(secondSummary.awarded).toEqual({ [HOST]: 1, [DANA]: 1, [YOSSI]: 1 })

    // --- the end ----------------------------------------------------------
    await finishGame(host, sessionId, secondGameId)
    await endGathering(host, sessionId)

    const keptInTotal = await writeRemainingFacts(host, HOST, sessionId)
    // All four answers, including the two nobody played: their authors only
    // became readable when the gathering finished.
    expect(keptInTotal).toBe(4)

    const session = (await getDoc(doc(host, paths.session(sessionId)))).data() as SessionDoc
    expect(session.phase).toBe('finished')

    const danaContact = session.contactIds[DANA]
    const danaFacts = await getDocs(collection(host, paths.contactFacts(HOST, danaContact)))
    expect(danaFacts.size).toBe(2)
    // Prefixed with the prompt's own wording (writeFactsForGame), so a bare
    // answer never shows up in the group's memory with no indication of what
    // it was an answer to.
    expect(danaFacts.docs.map((d) => (d.data() as FactDoc).text).sort()).toEqual(
      [
        'משהו ששברתם או קלקלתם בטעות: גבינה צהובה',
        'משהו ששכחתם איפה שמתם אותו: הטלפון על הגג',
      ].sort(),
    )
    // Every fact knows which question produced it, which is what decides the
    // drawer it lives in and how it can be re-asked later.
    for (const fact of danaFacts.docs) {
      expect(HARVEST_PROMPTS.map((p) => p.id)).toContain((fact.data() as FactDoc).promptId)
    }

    // And none of it is readable by anyone who was in the room.
    const guestView = await getDocs(collection(dana, paths.contactFacts(HOST, danaContact))).catch(
      () => null,
    )
    expect(guestView).toBeNull()
  })
})
