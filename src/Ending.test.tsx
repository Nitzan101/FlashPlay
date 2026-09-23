import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BetweenGames from './BetweenGames'
import Finale from './Finale'
import './i18n'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))
vi.mock('./lib/room', () => ({
  errorCode: (error: unknown) => (error as { code?: string })?.code ?? String(error),
}))

const mockStartSecondGame = vi.fn()
const mockEndGathering = vi.fn()

vi.mock('./lib/secondGame', () => ({
  startSecondGame: (...args: unknown[]) => mockStartSecondGame(...args),
  endGathering: (...args: unknown[]) => mockEndGathering(...args),
}))

const mockWriteFactsForGame = vi.fn()
const mockWriteRemainingFacts = vi.fn()
const mockEnsureContacts = vi.fn()
const mockNameGroup = vi.fn()
const mockRecordFeedback = vi.fn()

const mockGroupName = vi.fn()

vi.mock('./lib/memory', () => ({
  writeFactsForGame: (...args: unknown[]) => mockWriteFactsForGame(...args),
  writeRemainingFacts: (...args: unknown[]) => mockWriteRemainingFacts(...args),
  writeProfileFacts: vi.fn().mockResolvedValue(0),
  ensureContacts: (...args: unknown[]) => mockEnsureContacts(...args),
  nameGroup: (...args: unknown[]) => mockNameGroup(...args),
  useGroupName: () => mockGroupName(),
  recordFeedback: (...args: unknown[]) => mockRecordFeedback(...args),
  useGroupMemory: () => ({ groupName: '', facts: [], loading: false, error: null }),
  deleteFact: vi.fn(),
  deleteGroup: vi.fn(),
}))

const players = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Carol' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockStartSecondGame.mockResolvedValue('game2')
  mockEndGathering.mockResolvedValue(undefined)
  mockWriteFactsForGame.mockResolvedValue(2)
  mockWriteRemainingFacts.mockResolvedValue(5)
  mockEnsureContacts.mockResolvedValue({})
  mockNameGroup.mockResolvedValue(undefined)
  mockGroupName.mockReturnValue({ name: '', loading: false })
  mockRecordFeedback.mockResolvedValue(undefined)
})

describe('BetweenGames', () => {
  // The scores are cumulative across the gathering precisely so the room can
  // see where it stands between games; a bare "waiting for the host" would
  // throw that away at the most interesting moment.
  it('keeps the standings on screen while the room waits', () => {
    render(
      <BetweenGames
        sessionId="s1"
        hostUid="host"
        uid="guest"
        gameId="game1"
        groupId={null}
        finishedType="who-said-that"
        finishedOrder={0}
        players={players}
        scores={{ a: 4, b: 2 }}
        isHost={false}
      />,
    )

    expect(screen.getByText('המשחק הראשון נגמר')).toBeInTheDocument()
    expect(screen.getByText('ממתינים שהמנחה ימשיך/תמשיך')).toBeInTheDocument()
    const board = screen.getByText('ניקוד').parentElement
    expect(board?.textContent).toMatch(/Alice4.*Bob2.*Carol0/)
  })

  // The wiring the review found broken: without the group id, the
  // between-games write treats a return visit as a brand-new group and
  // overwrites the saved one the host picked on the landing page.
  it('carries a returning group through to the write between games', async () => {
    render(
      <BetweenGames
        sessionId="s1"
        hostUid="host"
        uid="host"
        gameId="game1"
        groupId="g1"
        finishedType="who-said-that"
        finishedOrder={0}
        players={players}
        scores={{}}
        isHost
      />,
    )

    fireEvent.click(screen.getByText('למשחק השני'))

    await waitFor(() => expect(mockEnsureContacts).toHaveBeenCalledTimes(1))
    expect(mockEnsureContacts.mock.calls[0][4]).toBe('g1')
  })

  it('offers the host the second game after the first one', async () => {
    render(
      <BetweenGames
        sessionId="s1"
        hostUid="host"
        uid="host"
        gameId="game1"
        groupId={null}
        finishedType="who-said-that"
        finishedOrder={0}
        players={players}
        scores={{}}
        isHost
      />,
    )

    fireEvent.click(screen.getByText('למשחק השני'))
    await waitFor(() => expect(mockStartSecondGame).toHaveBeenCalledTimes(1))
    // The new game's order follows the one that just finished.
    expect(mockStartSecondGame.mock.calls[0][2]).toBe(1)
    expect(mockEndGathering).not.toHaveBeenCalled()
  })

  it('offers the host the end of the evening after the second one', async () => {
    render(
      <BetweenGames
        sessionId="s1"
        hostUid="host"
        uid="host"
        gameId="game1"
        groupId={null}
        finishedType="most-likely-to"
        finishedOrder={1}
        players={players}
        scores={{}}
        isHost
      />,
    )

    expect(screen.queryByText('למשחק השני')).not.toBeInTheDocument()

    // Ending the evening cannot be undone, and it is the only button on the
    // screen - so one stray tap must not do it.
    fireEvent.click(screen.getByText('סיום הערב'))
    expect(mockEndGathering).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('כן, לסיים'))
    await waitFor(() => expect(mockEndGathering).toHaveBeenCalledTimes(1))
  })
})

describe('the evening leaves something behind', () => {
  // DESIGN: facts are written "at the end of each game rather than at the end
  // of the gathering, so an abandoned session keeps whatever was already
  // played."
  it('writes the finished game’s facts before moving to the next game', async () => {
    render(
      <BetweenGames
        sessionId="s1"
        hostUid="host"
        uid="host"
        gameId="game1"
        groupId={null}
        finishedType="who-said-that"
        finishedOrder={0}
        players={players}
        scores={{}}
        isHost
      />,
    )

    fireEvent.click(screen.getByText('למשחק השני'))

    await waitFor(() => expect(mockStartSecondGame).toHaveBeenCalled())
    // Contacts first: without them there is nobody to attribute a fact to,
    // and the write silently keeps nothing.
    expect(mockEnsureContacts).toHaveBeenCalledTimes(1)
    expect(mockWriteFactsForGame).toHaveBeenCalledWith(
      expect.anything(),
      'host',
      's1',
      'game1',
    )
  })

  // A write that fails must not strand the room between games: the facts are
  // keyed by item id, so the end-of-evening pass writes whatever this missed.
  it('moves on even if writing the facts fails', async () => {
    mockWriteFactsForGame.mockRejectedValue({ code: 'unavailable' })
    render(
      <BetweenGames
        sessionId="s1"
        hostUid="host"
        uid="host"
        gameId="game1"
        groupId={null}
        finishedType="who-said-that"
        finishedOrder={0}
        players={players}
        scores={{}}
        isHost
      />,
    )

    fireEvent.click(screen.getByText('למשחק השני'))

    await waitFor(() => expect(mockStartSecondGame).toHaveBeenCalledTimes(1))
  })

  // Keeping the evening is not the same decision as keeping the group, and
  // conflating them is what made a return visit record nothing at all: the
  // screen saw a groupId, assumed "already saved", and never wrote a thing.
  it('keeps the evening by itself, before anyone taps anything', async () => {
    render(
      <Finale sessionId="s1" hostUid="host" isHost players={players} scores={{}} groupId={null} />,
    )

    await waitFor(() => expect(mockWriteRemainingFacts).toHaveBeenCalledTimes(1))
    expect(mockEnsureContacts).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('נשמרו 5 תשובות מהערב')).toBeInTheDocument()
  })

  it('keeps a returning group’s evening too, and does not re-ask for its name', async () => {
    mockGroupName.mockReturnValue({ name: 'המשפחה', loading: false })

    render(
      <Finale sessionId="s1" hostUid="host" isHost players={players} scores={{}} groupId="g1" />,
    )

    await waitFor(() => expect(mockWriteRemainingFacts).toHaveBeenCalledTimes(1))
    expect(mockEnsureContacts.mock.calls[0][4]).toBe('g1')
    expect(screen.queryByText('שמירת הקבוצה')).not.toBeInTheDocument()
    expect(screen.getByText('הקבוצה "המשפחה" שמורה - בפעם הבאה היא תחכה לכם')).toBeInTheDocument()
  })

  it('writes nothing from a guest’s phone - they have no store to write to', async () => {
    render(
      <Finale
        sessionId="s1"
        hostUid="host"
        isHost={false}
        players={players}
        scores={{}}
        groupId={null}
      />,
    )

    expect(mockEnsureContacts).not.toHaveBeenCalled()
    expect(mockWriteRemainingFacts).not.toHaveBeenCalled()
  })

  it('offers to save the group only to the host, and only at the end', async () => {
    const guest = render(
      <Finale
        sessionId="s1"
        hostUid="host"
        isHost={false}
        players={players}
        scores={{}}
        groupId={null}
      />,
    )
    expect(screen.queryByText('שמירת הקבוצה')).not.toBeInTheDocument()
    guest.unmount()

    render(
      <Finale sessionId="s1" hostUid="host" isHost players={players} scores={{}} groupId={null} />,
    )
    fireEvent.change(screen.getByPlaceholderText('שם הקבוצה (למשל: המשפחה)'), {
      target: { value: 'המשפחה' },
    })
    fireEvent.click(screen.getByText('שמירת הקבוצה'))

    await waitFor(() => expect(mockNameGroup).toHaveBeenCalledTimes(1))
    expect(mockNameGroup.mock.calls[0].slice(1)).toEqual(['host', 's1', 'המשפחה'])
  })

  it('records the host’s answer on how the evening went', async () => {
    render(
      <Finale sessionId="s1" hostUid="host" isHost players={players} scores={{}} groupId="g1" />,
    )

    fireEvent.click(screen.getByText('לא עבד'))
    fireEvent.change(screen.getByDisplayValue(String(players.length)), {
      target: { value: '7' },
    })
    fireEvent.click(screen.getByText('שליחה'))

    await waitFor(() => expect(mockRecordFeedback).toHaveBeenCalledTimes(1))
    expect(mockRecordFeedback.mock.calls[0].slice(1)).toEqual(['host', 's1', 'died', 7])
    expect(await screen.findByText('תודה - זה בדיוק מה שעוזר לשפר')).toBeInTheDocument()
  })
})

describe('Finale', () => {
  it('names the winner and shows the final standings', () => {
    render(
      <Finale
        sessionId="s1"
        hostUid="host"
        isHost={false}
        players={players}
        scores={{ a: 7, b: 3 }}
        groupId={null}
      />,
    )

    expect(screen.getByText('זהו, נגמר!')).toBeInTheDocument()
    expect(screen.getByText('Alice ניצח/ה עם 7 נקודות')).toBeInTheDocument()
    const board = screen.getByText('הניקוד הסופי').parentElement
    expect(board?.textContent).toMatch(/Alice7.*Bob3.*Carol0/)
  })

  it('names everyone on a tie rather than picking one', () => {
    render(
      <Finale
        sessionId="s1"
        hostUid="host"
        isHost={false}
        players={players}
        scores={{ a: 5, b: 5 }}
        groupId={null}
      />,
    )

    expect(screen.getByText('תיקו בין Alice, Bob עם 5 נקודות')).toBeInTheDocument()
  })

  it('claims no winner when nobody scored', () => {
    render(
      <Finale
        sessionId="s1"
        hostUid="host"
        isHost={false}
        players={players}
        scores={{}}
        groupId={null}
      />,
    )

    expect(screen.queryByText(/ניצח/)).not.toBeInTheDocument()
    expect(screen.getByText('הניקוד הסופי')).toBeInTheDocument()
  })
})
