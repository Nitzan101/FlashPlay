import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WhoAnsweredWhat from './WhoAnsweredWhat'
import './i18n'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const HOST = 'host-uid'
const ME = 'me-uid'
const ANA = 'ana-uid'
const BEN = 'ben-uid'
const GAL = 'gal-uid'
const NO_DEVICE = 'nodevice-uid'

type RosterPlayer = {
  id: string
  name: string
  hasDevice: boolean
  leftAt: number | null
  votedRoundId: string | null
}
let roster: RosterPlayer[]

vi.mock('./lib/room', () => ({
  useRoster: () => ({ players: roster, error: null }),
  errorCode: (error: unknown) => (error as { code?: string })?.code ?? String(error),
}))

const mockRounds = vi.fn()
const mockItems = vi.fn()
const mockOpenVoting = vi.fn()
const mockSkipRound = vi.fn()
const mockFinishGame = vi.fn()

vi.mock('./lib/rounds', () => ({
  useRounds: () => mockRounds(),
  useItems: () => mockItems(),
  openVoting: (...args: unknown[]) => mockOpenVoting(...args),
  skipRound: (...args: unknown[]) => mockSkipRound(...args),
  finishGame: (...args: unknown[]) => mockFinishGame(...args),
  revealWith: vi.fn(),
}))

const mockParticipants = vi.fn()
const mockRevealedAnswers = vi.fn()
const mockRevealedGuesses = vi.fn()
const mockReadLobbyChoice = vi.fn()
const mockSubmitAnswer = vi.fn()
const mockSkipAnswer = vi.fn()
const mockCastGuess = vi.fn()
const mockGetMyGuess = vi.fn()
const mockReveal = vi.fn()
const mockOpenNext = vi.fn()

vi.mock('./lib/whoAnsweredWhat', async () => {
  const actual = await vi.importActual<typeof import('./lib/whoAnsweredWhat')>('./lib/whoAnsweredWhat')
  return {
    // The real arithmetic and the real candidate rule: the screen must agree
    // with what the host writes.
    candidateIds: actual.candidateIds,
    classificationsCorrect: actual.classificationsCorrect,
    scoreWhoAnsweredWhat: actual.scoreWhoAnsweredWhat,
    findChoiceQuestion: actual.findChoiceQuestion,
    isActivePlayer: actual.isActivePlayer,
    useParticipants: (...args: unknown[]) => mockParticipants(...args),
    useRevealedAnswers: (...args: unknown[]) => mockRevealedAnswers(...args),
    useRevealedGuesses: (...args: unknown[]) => mockRevealedGuesses(...args),
    readLobbyChoice: (...args: unknown[]) => mockReadLobbyChoice(...args),
    submitRoundAnswer: (...args: unknown[]) => mockSubmitAnswer(...args),
    skipRoundAnswer: (...args: unknown[]) => mockSkipAnswer(...args),
    castGuess: (...args: unknown[]) => mockCastGuess(...args),
    getMyGuess: (...args: unknown[]) => mockGetMyGuess(...args),
    revealAnswerRound: (...args: unknown[]) => mockReveal(...args),
    openNextAnswerRound: (...args: unknown[]) => mockOpenNext(...args),
  }
})

const QUESTION = 'טיפוס של בוקר או של לילה'
const OPTION = 'חיית לילה'

function round(phase: string, extra: Record<string, unknown> = {}) {
  return { id: 'r0', gameId: 'game3', itemId: 'item1', phase, order: 0, startedAt: 0, ...extra }
}

function renderGame(uid = ME, isHost = false, scores: Record<string, number> = {}) {
  return render(
    <WhoAnsweredWhat sessionId="s1" gameId="game3" uid={uid} isHost={isHost} scores={scores} plannedRounds={4} />,
  )
}

const marker = (answered: boolean) => ({ answered, at: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  roster = [
    { id: HOST, name: 'Host', hasDevice: true, leftAt: null, votedRoundId: null },
    { id: ME, name: 'Me', hasDevice: true, leftAt: null, votedRoundId: null },
    { id: ANA, name: 'Ana', hasDevice: true, leftAt: null, votedRoundId: null },
    { id: BEN, name: 'Ben', hasDevice: true, leftAt: null, votedRoundId: null },
    { id: GAL, name: 'Gal', hasDevice: true, leftAt: null, votedRoundId: null },
    { id: NO_DEVICE, name: 'Grandpa', hasDevice: false, leftAt: null, votedRoundId: null },
  ]
  mockRounds.mockReturnValue({ rounds: [round('preview')], loading: false, error: null })
  mockItems.mockReturnValue({
    items: {
      item1: {
        gameId: 'game3',
        text: OPTION,
        promptId: 'sleepSchedule',
        option: OPTION,
        revealed: true,
        createdAt: 0,
      },
    },
    loading: false,
    error: null,
  })
  mockParticipants.mockReturnValue({ participants: {}, error: null })
  mockRevealedAnswers.mockReturnValue({ chose: {}, error: null })
  mockRevealedGuesses.mockReturnValue({ guesses: {}, error: null })
  mockReadLobbyChoice.mockResolvedValue(null)
  mockSubmitAnswer.mockResolvedValue(undefined)
  mockSkipAnswer.mockResolvedValue(undefined)
  mockCastGuess.mockResolvedValue(undefined)
  mockGetMyGuess.mockResolvedValue(null)
  mockReveal.mockResolvedValue({ chose: {}, guesses: {}, awarded: {} })
  mockOpenVoting.mockResolvedValue(undefined)
  mockOpenNext.mockResolvedValue('r1')
})

describe('WhoAnsweredWhat - the answering window', () => {
  it('shows the question but not the option it will ask about', async () => {
    renderGame()
    expect(await screen.findByText(`השאלה: ${QUESTION}`)).toBeInTheDocument()
    expect(screen.queryByText(/אילו משתתפים בחרו/)).not.toBeInTheDocument()
  })

  // The normal case, and why the game is quick: nothing to tap.
  it('copies a lobby answer without asking again', async () => {
    mockReadLobbyChoice.mockResolvedValue(true)
    renderGame()

    await waitFor(() => expect(mockSubmitAnswer).toHaveBeenCalledTimes(1))
    expect(mockSubmitAnswer).toHaveBeenCalledWith(expect.anything(), 's1', 'r0', ME, true)
    // No live question was put to them.
    expect(screen.queryByText('אישור התשובה')).not.toBeInTheDocument()
    expect(mockReadLobbyChoice).toHaveBeenCalledWith(expect.anything(), 's1', ME, 'sleepSchedule', OPTION)
  })

  it('copies a lobby answer that did NOT choose the option as "chose: false"', async () => {
    mockReadLobbyChoice.mockResolvedValue(false)
    renderGame()
    await waitFor(() => expect(mockSubmitAnswer).toHaveBeenCalledWith(expect.anything(), 's1', 'r0', ME, false))
  })

  it('does not copy again after a reload that finds its own marker', async () => {
    mockReadLobbyChoice.mockResolvedValue(true)
    mockParticipants.mockReturnValue({ participants: { [ME]: marker(true) }, error: null })
    renderGame()

    expect(await screen.findByText('ממתינים לשאר המשתתפים')).toBeInTheDocument()
    await waitFor(() => expect(mockReadLobbyChoice).toHaveBeenCalled())
    expect(mockSubmitAnswer).not.toHaveBeenCalled()
  })

  it('asks live, with the question’s options, when there is no lobby answer', async () => {
    renderGame()

    expect(await screen.findByText(/לא ענית על השאלה הזאת בלובי/)).toBeInTheDocument()
    for (const option of ['בוקר - ישר לעניינים', OPTION, 'משתנה כל יום']) {
      expect(screen.getByText(option)).toBeInTheDocument()
    }
    expect(mockSubmitAnswer).not.toHaveBeenCalled()
    // Nothing to confirm until something is picked.
    expect(screen.getByText('אישור התשובה').closest('button')).toBeDisabled()
  })

  it('writes chose: true for the round’s option and chose: false for another', async () => {
    const first = renderGame()
    fireEvent.click(await screen.findByText(OPTION))
    fireEvent.click(screen.getByText('אישור התשובה'))
    await waitFor(() => expect(mockSubmitAnswer).toHaveBeenCalledWith(expect.anything(), 's1', 'r0', ME, true))
    first.unmount()
    mockSubmitAnswer.mockClear()

    renderGame()
    fireEvent.click(await screen.findByText('משתנה כל יום'))
    fireEvent.click(screen.getByText('אישור התשובה'))
    await waitFor(() => expect(mockSubmitAnswer).toHaveBeenCalledWith(expect.anything(), 's1', 'r0', ME, false))
  })

  it('lets a single-choice pick be changed before confirming', async () => {
    renderGame()
    fireEvent.click(await screen.findByText(OPTION))
    fireEvent.click(screen.getByText('משתנה כל יום'))
    fireEvent.click(screen.getByText('אישור התשובה'))
    await waitFor(() => expect(mockSubmitAnswer).toHaveBeenCalledTimes(1))
    expect(mockSubmitAnswer.mock.calls[0][4]).toBe(false)
  })

  it('skips on request, writing only the "skipped" marker', async () => {
    renderGame()
    fireEvent.click(await screen.findByText('דילוג'))
    await waitFor(() => expect(mockSkipAnswer).toHaveBeenCalledWith(expect.anything(), 's1', 'r0', ME))
    expect(mockSubmitAnswer).not.toHaveBeenCalled()
  })

  it('says a skip was recorded, and lets the player change their mind', async () => {
    mockParticipants.mockReturnValue({ participants: { [ME]: marker(false) }, error: null })
    renderGame()

    expect(await screen.findByText(/הדילוג נרשם/)).toBeInTheDocument()
    expect(screen.queryByText('אישור התשובה')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('בכל זאת לענות'))
    expect(await screen.findByText('אישור התשובה')).toBeInTheDocument()
  })

  it('only lets a player who holds a phone and is present answer', async () => {
    renderGame(NO_DEVICE)
    expect(await screen.findByText('בסבב הזה אפשר רק לצפות')).toBeInTheDocument()
    expect(mockReadLobbyChoice).not.toHaveBeenCalled()
    expect(screen.queryByText('אישור התשובה')).not.toBeInTheDocument()
  })
})

describe('WhoAnsweredWhat - the host while players answer', () => {
  beforeEach(() => {
    mockParticipants.mockReturnValue({
      participants: { [ANA]: marker(true), [BEN]: marker(false) },
      error: null,
    })
  })

  it('counts who answered, skipped and has not decided - from the public markers only', () => {
    renderGame(HOST, true)
    // Active players: Host, Me, Ana, Ben, Gal (Grandpa holds no phone).
    expect(screen.getByText('ענו 1, דילגו 1, עוד לא החליטו 3')).toBeInTheDocument()
  })

  it('will not open guessing with fewer than two players who answered', () => {
    renderGame(HOST, true)
    expect(screen.getByText('פתיחת הניחושים').closest('button')).toBeDisabled()
    expect(screen.getByText(/צריך לפחות 2 משתתפים שענו/)).toBeInTheDocument()
  })

  it('opens guessing once two have answered', async () => {
    mockParticipants.mockReturnValue({
      participants: { [ANA]: marker(true), [GAL]: marker(true) },
      error: null,
    })
    renderGame(HOST, true)
    fireEvent.click(screen.getByText('פתיחת הניחושים'))
    await waitFor(() => expect(mockOpenVoting).toHaveBeenCalledWith(expect.anything(), 's1', 'r0'))
  })

  it('does not count a player who answered and then left, or who has no phone', () => {
    roster = roster.map((p) => (p.id === ANA ? { ...p, leftAt: 5 } : p))
    mockParticipants.mockReturnValue({
      participants: { [ANA]: marker(true), [NO_DEVICE]: marker(true), [GAL]: marker(true) },
      error: null,
    })
    renderGame(HOST, true)
    // Only Gal remains a candidate.
    expect(screen.getByText(/ענו 1,/)).toBeInTheDocument()
    expect(screen.getByText('פתיחת הניחושים').closest('button')).toBeDisabled()
  })

  it('can skip the round', async () => {
    renderGame(HOST, true)
    fireEvent.click(screen.getByText('דילוג על השאלה'))
    await waitFor(() => expect(mockSkipRound).toHaveBeenCalledWith(expect.anything(), 's1', 'r0'))
  })
})

describe('WhoAnsweredWhat - guessing', () => {
  beforeEach(() => {
    mockRounds.mockReturnValue({ rounds: [round('voting')], loading: false, error: null })
    mockParticipants.mockReturnValue({
      participants: {
        [ME]: marker(true),
        [ANA]: marker(true),
        [BEN]: marker(true),
        [GAL]: marker(false),
        [NO_DEVICE]: marker(true),
      },
      error: null,
    })
  })

  it('shows the option, and lists the other candidates - never yourself, never a skipper, never a player with no phone', async () => {
    renderGame()
    expect(await screen.findByText(`אילו משתתפים בחרו "${OPTION}"?`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ben' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Me' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grandpa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Host' })).not.toBeInTheDocument()
  })

  it('lets a player who skipped still guess, about every candidate', async () => {
    renderGame(GAL)
    expect(await screen.findByRole('button', { name: 'Me' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ben' })).toBeInTheDocument()
  })

  it('sends the marked players, and a guess can be nobody', async () => {
    renderGame()
    fireEvent.click(await screen.findByRole('button', { name: 'Ana' }))
    fireEvent.click(screen.getByText('שליחת הניחוש'))
    await waitFor(() => expect(mockCastGuess).toHaveBeenCalledWith(expect.anything(), 's1', 'r0', ME, [ANA]))
    expect(await screen.findByText('הניחוש נשלח ✓')).toBeInTheDocument()
    expect(screen.getByText('אפשר לשנות עד לחשיפה')).toBeInTheDocument()
  })

  it('sends an empty guess when nobody is marked - "nobody chose it" is a real guess', async () => {
    renderGame()
    await screen.findByRole('button', { name: 'Ana' })
    fireEvent.click(screen.getByText('שליחת הניחוש'))
    await waitFor(() => expect(mockCastGuess).toHaveBeenCalledWith(expect.anything(), 's1', 'r0', ME, []))
  })

  it('un-marks on a second tap, and allows sending a changed guess', async () => {
    renderGame()
    const ana = await screen.findByRole('button', { name: 'Ana' })
    fireEvent.click(ana)
    fireEvent.click(ana)
    fireEvent.click(screen.getByRole('button', { name: 'Ben' }))
    fireEvent.click(screen.getByText('שליחת הניחוש'))
    await waitFor(() => expect(mockCastGuess).toHaveBeenCalledWith(expect.anything(), 's1', 'r0', ME, [BEN]))
  })

  it('shows a guess already sent before a reload, instead of forgetting it', async () => {
    mockGetMyGuess.mockResolvedValue([BEN])
    renderGame()
    expect(await screen.findByText('Ben ✓')).toBeInTheDocument()
    expect(screen.getByText('הניחוש נשלח ✓').closest('button')).toBeDisabled()
  })

  it('says how scoring works, including for players who were not marked', async () => {
    renderGame()
    expect(await screen.findByText('נקודה על כל משתתף שסיווגתם נכון, גם על מי שלא סימנתם')).toBeInTheDocument()
  })

  it('does not subscribe to the hidden answers or guesses before the reveal', () => {
    renderGame()
    // The third argument is `enabled`: only the reveal may turn it on.
    expect(mockRevealedAnswers.mock.calls.every((call) => call[2] === false)).toBe(true)
    expect(mockRevealedGuesses.mock.calls.every((call) => call[2] === false)).toBe(true)
  })

  it('lets the host reveal, passing the roster so the candidates match', async () => {
    renderGame(HOST, true)
    fireEvent.click(await screen.findByText('חשיפה'))
    await waitFor(() => expect(mockReveal).toHaveBeenCalledTimes(1))
    expect(mockReveal.mock.calls[0].slice(1, 3)).toEqual(['s1', 'r0'])
    expect(mockReveal.mock.calls[0][3]).toBe(roster)
  })
})

describe('WhoAnsweredWhat - the reveal', () => {
  beforeEach(() => {
    mockRounds.mockReturnValue({ rounds: [round('revealed')], loading: false, error: null })
    mockParticipants.mockReturnValue({
      participants: { [ANA]: marker(true), [BEN]: marker(true), [GAL]: marker(true) },
      error: null,
    })
    mockRevealedAnswers.mockReturnValue({
      chose: { [ANA]: true, [BEN]: false, [GAL]: true },
      error: null,
    })
    mockRevealedGuesses.mockReturnValue({
      guesses: { [ME]: [ANA], [BEN]: [ANA, GAL] },
      error: null,
    })
  })

  it('turns the hidden reads on exactly when the round is revealed', () => {
    renderGame()
    expect(mockRevealedAnswers.mock.calls.at(-1)![2]).toBe(true)
    expect(mockRevealedGuesses.mock.calls.at(-1)![2]).toBe(true)
  })

  it('names who chose the option and who did not', () => {
    renderGame()
    expect(screen.getByText('בחרו: Ana, Gal')).toBeInTheDocument()
    expect(screen.getByText('לא בחרו: Ben')).toBeInTheDocument()
  })

  it('shows each guess as correct out of total, and the points the host recorded', () => {
    mockRounds.mockReturnValue({
      rounds: [round('revealed', { awarded: { [BEN]: 3, [ME]: 2 } })],
      loading: false,
      error: null,
    })
    renderGame()
    // Me marked Ana only: Ana right, Ben right (unmarked, did not), Gal wrong = 2 of 3.
    expect(screen.getByText('הניחוש של Me: 2 מתוך 3')).toBeInTheDocument()
    // Ben marked Ana and Gal; scored on the two others only (not himself) = 2 of 2.
    expect(screen.getByText('הניחוש של Ben: 2 מתוך 2')).toBeInTheDocument()
    expect(screen.getByText('Ben +3')).toBeInTheDocument()
    expect(screen.getByText('Me +2')).toBeInTheDocument()
  })

  it('shows locally computed points in the moment before the host’s write lands', () => {
    renderGame()
    expect(screen.getByText('Me +2')).toBeInTheDocument()
    expect(screen.getByText('Ben +2')).toBeInTheDocument()
  })

  it('says so when nobody chose the option, and when everybody did', () => {
    mockRevealedAnswers.mockReturnValue({ chose: { [ANA]: false, [BEN]: false, [GAL]: false }, error: null })
    const none = renderGame()
    expect(screen.getByText('אף אחד לא בחר בזה')).toBeInTheDocument()
    none.unmount()

    mockRevealedAnswers.mockReturnValue({ chose: { [ANA]: true, [BEN]: true, [GAL]: true }, error: null })
    renderGame()
    expect(screen.getByText('כל המשתתפים בחרו בזה')).toBeInTheDocument()
  })

  it('lists only candidates the roster still counts', () => {
    roster = roster.map((p) => (p.id === GAL ? { ...p, leftAt: 3 } : p))
    renderGame()
    expect(screen.getByText('בחרו: Ana')).toBeInTheDocument()
  })

  it('offers the host a way to finish an unscored reveal, and the next round once it is scored', async () => {
    const unscored = renderGame(HOST, true)
    fireEvent.click(screen.getByText('השלמת החשיפה'))
    await waitFor(() => expect(mockReveal).toHaveBeenCalledTimes(1))
    unscored.unmount()

    mockRounds.mockReturnValue({
      rounds: [round('revealed', { awarded: { [ME]: 2 } })],
      loading: false,
      error: null,
    })
    renderGame(HOST, true)
    expect(screen.queryByText('השלמת החשיפה')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('לסבב הבא'))
    await waitFor(() => expect(mockOpenNext).toHaveBeenCalledTimes(1))
  })
})

describe('WhoAnsweredWhat - the run of the game', () => {
  it('lets the host open the first round, and says when no question is left', async () => {
    mockRounds.mockReturnValue({ rounds: [], loading: false, error: null })
    mockOpenNext.mockResolvedValue(null)
    renderGame(HOST, true)

    fireEvent.click(screen.getByText('התחלת הסבב הראשון'))
    await waitFor(() => expect(mockOpenNext).toHaveBeenCalledTimes(1))
    // The roster is passed so the host's client counts the right people.
    expect(mockOpenNext.mock.calls[0][3]).toBe(roster)
    expect((await screen.findAllByText('אין עוד שאלות זמינות מהלובי')).length).toBeGreaterThan(0)
  })

  it('makes a guest wait for the host before the first round', () => {
    mockRounds.mockReturnValue({ rounds: [], loading: false, error: null })
    renderGame()
    expect(screen.getByText('המנחה מקריא/ה עוד רגע')).toBeInTheDocument()
    expect(screen.queryByText('התחלת הסבב הראשון')).not.toBeInTheDocument()
  })

  it('shows the round counter from the planned total', () => {
    renderGame()
    expect(screen.getByText('סבב 1 מתוך 4')).toBeInTheDocument()
  })

  it('shows a skipped round as skipped, without the question card', () => {
    mockRounds.mockReturnValue({ rounds: [round('skipped')], loading: false, error: null })
    renderGame()
    expect(screen.getByText('דילגנו על השאלה הזאת')).toBeInTheDocument()
    expect(screen.queryByText(/השאלה:/)).not.toBeInTheDocument()
  })

  it('lets the host end the game', async () => {
    renderGame(HOST, true)
    fireEvent.click(screen.getByText('סיום המשחק'))
    await waitFor(() => expect(mockFinishGame).toHaveBeenCalledWith(expect.anything(), 's1', 'game3'))
  })
})
