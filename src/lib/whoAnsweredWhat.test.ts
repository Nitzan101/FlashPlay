/**
 * Client-contract and security-rules tests for "who answered what", run
 * against the rules emulator. The claim that matters most: **nobody - the
 * host included - can read anyone's answer or guess for a round before the
 * reveal**, and nobody can write one at the wrong moment. The pure arithmetic
 * (selection, candidates, scoring) is in whoAnsweredWhat.policy.test.ts.
 *
 * Rules are tested by writing the specific document directly, not through the
 * multi-write client functions: when a function's later write would be
 * refused for the same reason, an `assertFails` on the whole function cannot
 * say which rule did the refusing (see CLAUDE.md, Known pitfalls).
 *
 * Requires the emulator. Run with `npm run test:rules`, which starts it.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFactsForGame } from './memory'
import { openVoting, skipRound } from './rounds'
import {
  castGuess,
  describeWhoAnsweredWhatPool,
  getMyGuess,
  openNextAnswerRound,
  readLobbyChoice,
  revealAnswerRound,
  skipRoundAnswer,
  startWhoAnsweredWhat,
  submitRoundAnswer,
} from './whoAnsweredWhat'
import { type GameDoc, type ItemDoc, type RoundDoc, type SessionDoc } from './model'

const PROJECT_ID = 'demo-flashplay-answer-game'
const SESSION = 'session1'
const FIRST_GAME = 'game1'
const GAME = 'game3'
const ROUND = 'g3r0'
const HOST = 'host-uid'
const PLAYER = 'player-uid'
const THIRD = 'third-uid'
const FOURTH = 'fourth-uid'
const NO_DEVICE = 'nodevice-uid'

const ROSTER = [HOST, PLAYER, THIRD, FOURTH].map((id) => ({ id, hasDevice: true, leftAt: null }))

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
      originalHostUid: HOST,
      groupId: null,
      phase: 'playing',
      currentGameId: FIRST_GAME,
      contactIds: {},
      scores: {},
      createdAt: 0,
      expiresAt: 0,
    })
    for (const [uid, name, hasDevice] of [
      [HOST, 'Host', true],
      [PLAYER, 'Player', true],
      [THIRD, 'Third', true],
      [FOURTH, 'Fourth', true],
      [NO_DEVICE, 'NoDevice', false],
    ] as const) {
      await setDoc(doc(db, `sessions/${SESSION}/players/${uid}`), {
        name,
        uid,
        hasDevice,
        lastSeenAt: 0,
        joinedAt: 0,
        votedRoundId: null,
        leftAt: null,
      })
    }
    await setDoc(doc(db, `sessions/${SESSION}/games/${FIRST_GAME}`), {
      type: 'who-said-that',
      phase: 'done',
      promptIds: ['p1', 'p2'],
      order: 0,
      startedAt: 0,
      phaseEndsAt: 0,
    })
  })
})

const ctx = (uid: string, provider: 'google.com' | 'anonymous') =>
  testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore() as unknown as Firestore
const asHost = () => ctx(HOST, 'google.com')
const asPlayer = () => ctx(PLAYER, 'anonymous')
const asThird = () => ctx(THIRD, 'anonymous')
const asFourth = () => ctx(FOURTH, 'anonymous')

/** Seeds a lobby answer, bypassing rules (the lobby writes it for real). */
async function seedLobbyAnswer(uid: string, questionId: string, answer: string | string[]) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), `sessions/${SESSION}/players/${uid}/profileAnswers/${questionId}`), {
      questionId,
      answer,
      updatedAt: 0,
    })
  })
}

/** Seeds a game of the given type, plus a round in the given phase. */
async function seedRound(
  phase: RoundDoc['phase'],
  gameType: GameDoc['type'] = 'who-answered-what',
  roundId = ROUND,
) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore()
    await setDoc(doc(db, `sessions/${SESSION}/games/${GAME}`), {
      type: gameType,
      phase: 'rounds',
      promptIds: [],
      order: 1,
      startedAt: 0,
      phaseEndsAt: 0,
    })
    await setDoc(doc(db, `sessions/${SESSION}/items/item-${roundId}`), {
      gameId: GAME,
      text: 'חיית לילה',
      promptId: 'sleepSchedule',
      option: 'חיית לילה',
      revealed: true,
      createdAt: 0,
    } satisfies ItemDoc)
    await setDoc(doc(db, `sessions/${SESSION}/rounds/${roundId}`), {
      gameId: GAME,
      itemId: `item-${roundId}`,
      phase,
      order: 0,
      startedAt: 0,
    })
  })
}

async function setRoundPhase(phase: RoundDoc['phase'], roundId = ROUND) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), `sessions/${SESSION}/rounds/${roundId}`), { phase })
  })
}

const answerPath = (uid: string, roundId = ROUND) => `sessions/${SESSION}/rounds/${roundId}/answers/${uid}`
const markerPath = (uid: string, roundId = ROUND) => `sessions/${SESSION}/rounds/${roundId}/participants/${uid}`
const guessPath = (uid: string, roundId = ROUND) => `sessions/${SESSION}/rounds/${roundId}/guesses/${uid}`

const answerDoc = (chose = true) => ({ chose, answeredAt: 1 })
const markerDoc = (answered = true) => ({ answered, at: 1 })
const guessDoc = (markedPlayerIds: string[]) => ({ markedPlayerIds, castAt: 1 })

// --- opening the game --------------------------------------------------------

describe('startWhoAnsweredWhat', () => {
  it('opens a game that begins in its round loop with no prompts, and points the session at it', async () => {
    const gameId = await startWhoAnsweredWhat(asHost(), SESSION, 1, () => GAME)

    const game = (await getDoc(doc(asHost(), `sessions/${SESSION}/games/${GAME}`))).data() as GameDoc
    expect(gameId).toBe(GAME)
    expect(game.type).toBe('who-answered-what')
    expect(game.phase).toBe('rounds')
    expect(game.promptIds).toEqual([])
    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.currentGameId).toBe(GAME)
  })

  it('refuses a player who is not the host', async () => {
    await expect(startWhoAnsweredWhat(asPlayer(), SESSION, 1, () => GAME)).rejects.toThrow()
  })

  // Written directly, one clause at a time: each of these is a separate rule
  // clause, so a failing multi-write function could not tell them apart.
  it('refuses the game in harvesting, or with prompts of its own', async () => {
    const base = { type: 'who-answered-what', promptIds: [], order: 1, startedAt: 0, phaseEndsAt: 0 }
    await assertFails(
      setDoc(doc(asHost(), `sessions/${SESSION}/games/bad1`), { ...base, phase: 'harvesting' }),
    )
    await assertFails(
      setDoc(doc(asHost(), `sessions/${SESSION}/games/bad2`), {
        ...base,
        phase: 'rounds',
        promptIds: ['p1', 'p2'],
      }),
    )
    await assertSucceeds(setDoc(doc(asHost(), `sessions/${SESSION}/games/ok`), { ...base, phase: 'rounds' }))
  })

  it('refuses to change the game’s type afterwards', async () => {
    await startWhoAnsweredWhat(asHost(), SESSION, 1, () => GAME)
    await assertFails(updateDoc(doc(asHost(), `sessions/${SESSION}/games/${GAME}`), { type: 'who-said-that' }))
    await assertFails(updateDoc(doc(asHost(), `sessions/${SESSION}/games/${GAME}`), { type: 'most-likely-to' }))
  })
})

// --- the pool and the round's material ---------------------------------------

describe('the lobby answers behind a round', () => {
  it('lets the host count them, and nobody else - a guest cannot read another player’s answer', async () => {
    await seedLobbyAnswer(PLAYER, 'season', 'קיץ')

    await assertSucceeds(getDoc(doc(asHost(), `sessions/${SESSION}/players/${PLAYER}/profileAnswers/season`)))
    await assertFails(getDoc(doc(asThird(), `sessions/${SESSION}/players/${PLAYER}/profileAnswers/season`)))
    await expect(describeWhoAnsweredWhatPool(asThird(), SESSION, ROSTER)).rejects.toThrow()
  })

  it('reports how many questions have enough answerers, and nothing about what was answered', async () => {
    for (const uid of [HOST, PLAYER, THIRD]) await seedLobbyAnswer(uid, 'season', 'קיץ')
    // Two answerers: not enough.
    for (const uid of [HOST, PLAYER]) await seedLobbyAnswer(uid, 'sleepSchedule', 'חיית לילה')

    const pool = await describeWhoAnsweredWhatPool(asHost(), SESSION, ROSTER)
    expect(pool).toEqual({ availableQuestions: 1 })
  })

  it('ignores a player who has left or holds no phone', async () => {
    for (const uid of [HOST, PLAYER, THIRD]) await seedLobbyAnswer(uid, 'season', 'קיץ')
    const roster = ROSTER.map((p) => (p.id === THIRD ? { ...p, leftAt: 5 } : p))
    expect(await describeWhoAnsweredWhatPool(asHost(), SESSION, roster)).toEqual({ availableQuestions: 0 })
  })

  it('reads a player’s own lobby choice, and null when they gave none', async () => {
    await seedLobbyAnswer(PLAYER, 'sleepSchedule', 'חיית לילה')
    await seedLobbyAnswer(THIRD, 'music', ['פופ', 'רוק'])
    expect(await readLobbyChoice(asPlayer(), SESSION, PLAYER, 'sleepSchedule', 'חיית לילה')).toBe(true)
    expect(await readLobbyChoice(asPlayer(), SESSION, PLAYER, 'sleepSchedule', 'משתנה כל יום')).toBe(false)
    expect(await readLobbyChoice(asThird(), SESSION, THIRD, 'music', 'רוק')).toBe(true)
    expect(await readLobbyChoice(asThird(), SESSION, THIRD, 'music', 'טראנס')).toBe(false)
    expect(await readLobbyChoice(asFourth(), SESSION, FOURTH, 'sleepSchedule', 'חיית לילה')).toBeNull()
  })
})

describe('openNextAnswerRound', () => {
  beforeEach(async () => {
    await startWhoAnsweredWhat(asHost(), SESSION, 1, () => GAME)
    // season: 4 answerers split 2 / 2; sleepSchedule: 3 answerers split 1 / 2.
    await seedLobbyAnswer(HOST, 'season', 'קיץ')
    await seedLobbyAnswer(PLAYER, 'season', 'קיץ')
    await seedLobbyAnswer(THIRD, 'season', 'חורף')
    await seedLobbyAnswer(FOURTH, 'season', 'חורף')
    await seedLobbyAnswer(HOST, 'sleepSchedule', 'חיית לילה')
    await seedLobbyAnswer(PLAYER, 'sleepSchedule', 'משתנה כל יום')
    await seedLobbyAnswer(THIRD, 'sleepSchedule', 'משתנה כל יום')
  })

  // Drawn with no lopsided option: 0.9 is not under the lopsided probability.
  const split = (question: number) => {
    const draws = [0.9, question, 0]
    let i = 0
    return () => draws[Math.min(i++, draws.length - 1)]
  }

  it('builds a round from the lobby answers: a revealed item holding the option, no author, answering window open', async () => {
    const roundId = await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => ROUND, split(0), () => 'item-x')

    expect(roundId).toBe(ROUND)
    const round = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/${ROUND}`))).data() as RoundDoc
    expect(round.phase).toBe('preview')
    expect(round.itemId).toBe('item-x')
    const item = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/item-x`))).data() as ItemDoc
    expect(item.revealed).toBe(true)
    expect(item.promptId).toBe('season')
    // A real split: the option is one that some answerers chose and some did not.
    expect(['קיץ', 'חורף']).toContain(item.option)
    expect((await getDoc(doc(asHost(), `sessions/${SESSION}/itemAuthors/item-x`))).exists()).toBe(false)
  })

  it('writes the planned round count once, from how many questions the lobby can supply', async () => {
    await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => ROUND, split(0), () => 'item-x')
    const game = (await getDoc(doc(asHost(), `sessions/${SESSION}/games/${GAME}`))).data() as GameDoc
    expect(game.plannedRounds).toBe(2)
  })

  it('never asks the same question twice, and runs out when every eligible question has been asked', async () => {
    await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => 'r0', split(0), () => 'item-0')
    await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => 'r1', split(0), () => 'item-1')

    const first = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/item-0`))).data() as ItemDoc
    const second = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/item-1`))).data() as ItemDoc
    expect(new Set([first.promptId, second.promptId])).toEqual(new Set(['season', 'sleepSchedule']))
    expect(await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => 'r2', split(0))).toBeNull()
  })

  it('does not draw a skipped round’s question again', async () => {
    await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => 'r0', split(0), () => 'item-0')
    await skipRound(asHost(), SESSION, 'r0')
    await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => 'r1', split(0), () => 'item-1')
    const first = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/item-0`))).data() as ItemDoc
    const second = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/item-1`))).data() as ItemDoc
    expect(second.promptId).not.toBe(first.promptId)
  })

  // A host that died between writing the item and the round leaves an orphan
  // item; that must not burn the question for the retry.
  it('does not count an orphan item (no round points at it) as an asked question', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `sessions/${SESSION}/items/orphan`), {
        gameId: GAME,
        text: 'x',
        promptId: 'sleepSchedule',
        option: 'x',
        revealed: true,
        createdAt: 0,
      })
    })
    // Pin the draw to the second question in the pool - sleepSchedule.
    await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => 'r0', split(0.99), () => 'item-0')
    const item = (await getDoc(doc(asHost(), `sessions/${SESSION}/items/item-0`))).data() as ItemDoc
    expect(item.promptId).toBe('sleepSchedule')
  })

  it('returns null when no question has three answerers, and refuses a player who is not the host', async () => {
    await testEnv.clearFirestore()
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `sessions/${SESSION}`), {
        roomCode: 'ABCD', hostUid: HOST, originalHostUid: HOST, groupId: null, phase: 'playing',
        currentGameId: GAME, contactIds: {}, scores: {}, createdAt: 0, expiresAt: 0,
      })
      for (const uid of [HOST, PLAYER]) {
        await setDoc(doc(c.firestore(), `sessions/${SESSION}/players/${uid}`), {
          name: uid, uid, hasDevice: true, lastSeenAt: 0, joinedAt: 0, votedRoundId: null, leftAt: null,
        })
      }
      await setDoc(doc(c.firestore(), `sessions/${SESSION}/games/${GAME}`), {
        type: 'who-answered-what', phase: 'rounds', promptIds: [], order: 1, startedAt: 0, phaseEndsAt: 0,
      })
    })
    expect(await openNextAnswerRound(asHost(), SESSION, GAME, ROSTER, () => 'r0')).toBeNull()
    await expect(openNextAnswerRound(asPlayer(), SESSION, GAME, ROSTER, () => 'r0')).rejects.toThrow()
  })

  it('refuses the item when the game is of another type', async () => {
    await assertFails(
      setDoc(doc(asHost(), `sessions/${SESSION}/items/sneaky`), {
        gameId: FIRST_GAME,
        text: 'x',
        promptId: 'season',
        option: 'x',
        revealed: true,
        createdAt: 0,
      }),
    )
  })
})

// --- the round's answers: private until the reveal ---------------------------

describe('a round answer', () => {
  beforeEach(() => seedRound('preview'))

  it('can be written by its owner while the answering window is open, and read back by them', async () => {
    await assertSucceeds(setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true)))
    expect((await getDoc(doc(asPlayer(), answerPath(PLAYER)))).data()!.chose).toBe(true)
    // Replaceable while the window is open (a retry after a dropped marker).
    await assertSucceeds(setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(false)))
  })

  it('cannot be read by another player before the reveal - get or list', async () => {
    await setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true))
    await assertFails(getDoc(doc(asThird(), answerPath(PLAYER))))
    await assertFails(getDocs(collection(asThird(), `sessions/${SESSION}/rounds/${ROUND}/answers`)))
  })

  // The host is a player, and the one most able to profit from reading early.
  it('cannot be read by the host before the reveal either', async () => {
    await setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true))
    await assertFails(getDoc(doc(asHost(), answerPath(PLAYER))))
    await assertFails(getDocs(collection(asHost(), `sessions/${SESSION}/rounds/${ROUND}/answers`)))
    await setRoundPhase('voting')
    await assertFails(getDoc(doc(asHost(), answerPath(PLAYER))))
  })

  it('opens to every player once the round is revealed', async () => {
    await setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true))
    await setRoundPhase('revealed')
    await assertSucceeds(getDoc(doc(asThird(), answerPath(PLAYER))))
    const all = await getDocs(collection(asThird(), `sessions/${SESSION}/rounds/${ROUND}/answers`))
    expect(all.size).toBe(1)
  })

  it('cannot be written for someone else', async () => {
    await assertFails(setDoc(doc(asThird(), answerPath(PLAYER)), answerDoc(true)))
  })

  it('cannot be written once guessing has opened, or the round is over', async () => {
    await setRoundPhase('voting')
    await assertFails(setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true)))
    await setRoundPhase('revealed')
    await assertFails(setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true)))
  })

  it('must be exactly one boolean and a time', async () => {
    await assertFails(setDoc(doc(asPlayer(), answerPath(PLAYER)), { chose: 'yes', answeredAt: 1 }))
    await assertFails(setDoc(doc(asPlayer(), answerPath(PLAYER)), { ...answerDoc(true), extra: 1 }))
    await assertFails(setDoc(doc(asPlayer(), answerPath(PLAYER)), { chose: true }))
  })

  it('cannot be written in a round of another game type', async () => {
    await seedRound('preview', 'most-likely-to', 'other-round')
    await assertFails(setDoc(doc(asPlayer(), answerPath(PLAYER, 'other-round')), answerDoc(true)))
  })

  it('cannot be written by someone who never joined', async () => {
    const stranger = testEnv
      .authenticatedContext('stranger', { firebase: { sign_in_provider: 'anonymous' } })
      .firestore() as unknown as Firestore
    await assertFails(setDoc(doc(stranger, answerPath('stranger')), answerDoc(true)))
  })
})

// --- the public marker -------------------------------------------------------

describe('a participation marker', () => {
  beforeEach(() => seedRound('preview'))

  it('needs the player’s own answer to exist first', async () => {
    await assertFails(setDoc(doc(asPlayer(), markerPath(PLAYER)), markerDoc(true)))
    await setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true))
    await assertSucceeds(setDoc(doc(asPlayer(), markerPath(PLAYER)), markerDoc(true)))
  })

  // Somebody else's answer does not count: the check is the CALLER's own.
  it('is not satisfied by another player’s answer', async () => {
    await setDoc(doc(asThird(), answerPath(THIRD)), answerDoc(true))
    await assertFails(setDoc(doc(asPlayer(), markerPath(PLAYER)), markerDoc(true)))
  })

  it('can say "skipped" with no answer behind it', async () => {
    await assertSucceeds(setDoc(doc(asPlayer(), markerPath(PLAYER)), markerDoc(false)))
  })

  it('is public: every player reads every marker during the answering window, and it holds no content', async () => {
    await setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true))
    await setDoc(doc(asPlayer(), markerPath(PLAYER)), markerDoc(true))
    const snap = await getDocs(collection(asThird(), `sessions/${SESSION}/rounds/${ROUND}/participants`))
    expect(snap.docs.map((d) => d.data())).toEqual([{ answered: true, at: expect.any(Number) }])
  })

  it('cannot be written for someone else, or in the wrong phase, or in a round of another game', async () => {
    await assertFails(setDoc(doc(asThird(), markerPath(PLAYER)), markerDoc(false)))
    await setRoundPhase('voting')
    await assertFails(setDoc(doc(asPlayer(), markerPath(PLAYER)), markerDoc(false)))
    await seedRound('preview', 'most-likely-to', 'other-round')
    await assertFails(setDoc(doc(asPlayer(), markerPath(PLAYER, 'other-round')), markerDoc(false)))
  })

  it('must be exactly a boolean and a time', async () => {
    await assertFails(setDoc(doc(asPlayer(), markerPath(PLAYER)), { answered: 'no', at: 1 }))
    await assertFails(setDoc(doc(asPlayer(), markerPath(PLAYER)), { ...markerDoc(false), chose: true }))
  })
})

// --- guesses -----------------------------------------------------------------

describe('a guess', () => {
  beforeEach(() => seedRound('voting'))

  it('can be written by its owner while guessing is open, replaced, and read back by them', async () => {
    await assertSucceeds(setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc([THIRD])))
    await assertSucceeds(setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc([])))
    expect((await getDoc(doc(asPlayer(), guessPath(PLAYER)))).data()!.markedPlayerIds).toEqual([])
  })

  it('cannot be written before guessing opens, or after the reveal', async () => {
    await setRoundPhase('preview')
    await assertFails(setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc([THIRD])))
    await setRoundPhase('revealed')
    await assertFails(setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc([THIRD])))
  })

  it('never names the guesser, however it is mixed into the list', async () => {
    await assertFails(setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc([PLAYER])))
    await assertFails(setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc([THIRD, PLAYER, HOST])))
  })

  it('is bounded in size and must be a list of ids', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `u${i}`)
    await assertFails(setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc(many)))
    await assertSucceeds(setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc(many.slice(0, 50))))
    await assertFails(setDoc(doc(asPlayer(), guessPath(PLAYER)), { markedPlayerIds: THIRD, castAt: 1 }))
    await assertFails(setDoc(doc(asPlayer(), guessPath(PLAYER)), { ...guessDoc([THIRD]), extra: 1 }))
  })

  it('cannot be read by another player or by the host before the reveal, and opens after it', async () => {
    await setDoc(doc(asPlayer(), guessPath(PLAYER)), guessDoc([THIRD]))
    await assertFails(getDoc(doc(asThird(), guessPath(PLAYER))))
    await assertFails(getDoc(doc(asHost(), guessPath(PLAYER))))
    await assertFails(getDocs(collection(asHost(), `sessions/${SESSION}/rounds/${ROUND}/guesses`)))
    await setRoundPhase('revealed')
    const all = await getDocs(collection(asThird(), `sessions/${SESSION}/rounds/${ROUND}/guesses`))
    expect(all.size).toBe(1)
  })

  it('cannot be written for someone else, or in a round of another game type', async () => {
    await assertFails(setDoc(doc(asThird(), guessPath(PLAYER)), guessDoc([HOST])))
    await seedRound('voting', 'most-likely-to', 'other-round')
    await assertFails(setDoc(doc(asPlayer(), guessPath(PLAYER, 'other-round')), guessDoc([THIRD])))
  })
})

// --- a whole round, through the client functions ------------------------------

describe('a round, end to end', () => {
  beforeEach(async () => {
    await seedRound('preview')
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), `sessions/${SESSION}`), { currentGameId: GAME })
    })
  })

  /** HOST and PLAYER chose the option, THIRD did not, FOURTH skipped. */
  async function answerTheRound() {
    await submitRoundAnswer(asHost(), SESSION, ROUND, HOST, true)
    await submitRoundAnswer(asPlayer(), SESSION, ROUND, PLAYER, true)
    await submitRoundAnswer(asThird(), SESSION, ROUND, THIRD, false)
    await skipRoundAnswer(asFourth(), SESSION, ROUND, FOURTH)
  }

  it('keeps the truth hidden through the guessing and pays one point per correct classification at the reveal', async () => {
    await answerTheRound()
    await openVoting(asHost(), SESSION, ROUND)

    // FOURTH did not answer, so is not a candidate but still guesses:
    // marks HOST only -> HOST right, PLAYER wrong (chose, unmarked), THIRD right.
    await castGuess(asFourth(), SESSION, ROUND, FOURTH, [HOST])
    // THIRD marks HOST and PLAYER -> both right; THIRD is never scored on THIRD.
    await castGuess(asThird(), SESSION, ROUND, THIRD, [HOST, PLAYER])
    // PLAYER marks nobody -> HOST wrong, THIRD right.
    await castGuess(asPlayer(), SESSION, ROUND, PLAYER, [])

    // Mid-round nobody can read anybody's truth, host included.
    await assertFails(getDoc(doc(asHost(), answerPath(THIRD))))
    await assertFails(getDoc(doc(asHost(), guessPath(THIRD))))
    expect(await getMyGuess(asThird(), SESSION, ROUND, THIRD)).toEqual([HOST, PLAYER])

    const summary = await revealAnswerRound(asHost(), SESSION, ROUND, ROSTER)

    expect(summary.chose).toEqual({ [HOST]: true, [PLAYER]: true, [THIRD]: false })
    // FOURTH: HOST marked & chose (1), PLAYER unmarked but chose (0), THIRD unmarked & did not (1) = 2.
    // THIRD: HOST + PLAYER marked & chose = 2 (not scored on themselves).
    // PLAYER: HOST unmarked but chose (0), THIRD unmarked & did not (1) = 1.
    expect(summary.awarded).toEqual({ [FOURTH]: 2, [THIRD]: 2, [PLAYER]: 1 })

    const round = (await getDoc(doc(asHost(), `sessions/${SESSION}/rounds/${ROUND}`))).data() as RoundDoc
    expect(round.phase).toBe('revealed')
    expect(round.awarded).toEqual(summary.awarded)
    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.scores).toEqual(summary.awarded)

    // After the reveal everyone can read the truth.
    await assertSucceeds(getDoc(doc(asThird(), answerPath(HOST))))
    await assertSucceeds(getDoc(doc(asThird(), guessPath(PLAYER))))
  })

  it('keeps a player who holds no phone, or has left, out of the candidates even with a marker', async () => {
    await answerTheRound()
    // Markers and answers written for two players the roster says are not in
    // the game - what a stale marker from before someone left looks like.
    await testEnv.withSecurityRulesDisabled(async (c) => {
      for (const uid of [NO_DEVICE]) {
        await setDoc(doc(c.firestore(), answerPath(uid)), answerDoc(true))
        await setDoc(doc(c.firestore(), markerPath(uid)), markerDoc(true))
      }
    })
    await openVoting(asHost(), SESSION, ROUND)
    await castGuess(asFourth(), SESSION, ROUND, FOURTH, [])

    const roster = [...ROSTER.map((p) => (p.id === PLAYER ? { ...p, leftAt: 9 } : p)), { id: NO_DEVICE, hasDevice: false, leftAt: null }]
    const summary = await revealAnswerRound(asHost(), SESSION, ROUND, roster)

    // Candidates: HOST (chose) and THIRD (did not); not PLAYER (left), not NO_DEVICE.
    expect(summary.chose).toEqual({ [HOST]: true, [THIRD]: false })
    // FOURTH marked nobody: HOST wrong, THIRD right.
    expect(summary.awarded).toEqual({ [FOURTH]: 1 })
  })

  it('pays everyone for marking nobody when nobody chose the option', async () => {
    await submitRoundAnswer(asHost(), SESSION, ROUND, HOST, false)
    await submitRoundAnswer(asPlayer(), SESSION, ROUND, PLAYER, false)
    await submitRoundAnswer(asThird(), SESSION, ROUND, THIRD, false)
    await openVoting(asHost(), SESSION, ROUND)
    await castGuess(asHost(), SESSION, ROUND, HOST, [])
    await castGuess(asFourth(), SESSION, ROUND, FOURTH, [])

    const summary = await revealAnswerRound(asHost(), SESSION, ROUND, ROSTER)
    // HOST is scored on the two others; FOURTH, a non-candidate, on all three.
    expect(summary.awarded).toEqual({ [HOST]: 2, [FOURTH]: 3 })
  })

  it('finishes a reveal that died after closing the round, and never pays twice', async () => {
    await answerTheRound()
    await openVoting(asHost(), SESSION, ROUND)
    await castGuess(asThird(), SESSION, ROUND, THIRD, [HOST, PLAYER])

    // The host's phone died right after the first write of the reveal.
    await setRoundPhase('revealed')
    const resumed = await revealAnswerRound(asHost(), SESSION, ROUND, ROSTER)
    expect(resumed.awarded).toEqual({ [THIRD]: 2 })

    const again = await revealAnswerRound(asHost(), SESSION, ROUND, ROSTER)
    expect(again.awarded).toEqual({ [THIRD]: 2 })
    const session = (await getDoc(doc(asHost(), `sessions/${SESSION}`))).data() as SessionDoc
    expect(session.scores).toEqual({ [THIRD]: 2 })
  })

  it('refuses a non-host the reveal', async () => {
    await answerTheRound()
    await openVoting(asHost(), SESSION, ROUND)
    await expect(revealAnswerRound(asThird(), SESSION, ROUND, ROSTER)).rejects.toThrow()
  })

  it('retries the marker without minting a second answer: both writes are idempotent in the window', async () => {
    await setDoc(doc(asPlayer(), answerPath(PLAYER)), answerDoc(true))
    // The client died before the marker landed; the retry writes both again.
    await assertSucceeds(submitRoundAnswer(asPlayer(), SESSION, ROUND, PLAYER, true))
    expect((await getDoc(doc(asPlayer(), markerPath(PLAYER)))).data()!.answered).toBe(true)
  })

  it('refuses an answer through the client once guessing has opened', async () => {
    await openVoting(asHost(), SESSION, ROUND)
    await expect(submitRoundAnswer(asPlayer(), SESSION, ROUND, PLAYER, true)).rejects.toThrow()
  })
})

// --- what the evening leaves behind ------------------------------------------

describe('the facts written after this game', () => {
  // A round's item is only its public material, never someone's answer, so the
  // per-game fact writer must neither keep it nor complain about it.
  it('keeps nothing from a game whose items are only round material, and does not warn', async () => {
    await seedRound('revealed')
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), `sessions/${SESSION}`), { contactIds: { [PLAYER]: 'contact-a' } })
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await writeFactsForGame(asHost(), HOST, SESSION, GAME)).toBe(0)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
