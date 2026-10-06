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

const mockStartWhoAnswered = vi.fn()
const mockDescribeAnswerPool = vi.fn()

vi.mock('./lib/whoAnsweredWhat', () => ({
  startWhoAnsweredWhat: (...args: unknown[]) => mockStartWhoAnswered(...args),
  describeWhoAnsweredWhatPool: (...args: unknown[]) => mockDescribeAnswerPool(...args),
}))

const mockWriteFactsForGame = vi.fn()
const mockWriteRemainingFacts = vi.fn()
const mockEnsureContacts = vi.fn()
const mockNameGroup = vi.fn()
const mockRecordFeedback = vi.fn()
const mockRecordPlayerFeedback = vi.fn()

const mockGroupName = vi.fn()

vi.mock('./lib/memory', () => ({
  writeFactsForGame: (...args: unknown[]) => mockWriteFactsForGame(...args),
  writeRemainingFacts: (...args: unknown[]) => mockWriteRemainingFacts(...args),
  writeProfileFacts: vi.fn().mockResolvedValue(0),
  ensureContacts: (...args: unknown[]) => mockEnsureContacts(...args),
  nameGroup: (...args: unknown[]) => mockNameGroup(...args),
  useGroupName: () => mockGroupName(),
  recordFeedback: (...args: unknown[]) => mockRecordFeedback(...args),
  recordPlayerFeedback: (...args: unknown[]) => mockRecordPlayerFeedback(...args),
  useGroupMemory: () => ({ groupName: '', facts: [], loading: false, error: null }),
  deleteFact: vi.fn(),
  deleteGroup: vi.fn(),
}))

const players = [
  { id: 'a', name: 'Alice', hasDevice: true, leftAt: null },
  { id: 'b', name: 'Bob', hasDevice: true, leftAt: null },
  { id: 'c', name: 'Carol', hasDevice: true, leftAt: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockStartSecondGame.mockResolvedValue('game2')
  mockStartWhoAnswered.mockResolvedValue('game2')
  mockDescribeAnswerPool.mockResolvedValue({ availableQuestions: 4 })
  mockEndGathering.mockResolvedValue(undefined)
  mockWriteFactsForGame.mockResolvedValue(2)
  mockWriteRemainingFacts.mockResolvedValue(5)
  mockEnsureContacts.mockResolvedValue({})
  mockNameGroup.mockResolvedValue(undefined)
  mockGroupName.mockReturnValue({ name: '', loading: false })
  mockRecordFeedback.mockResolvedValue(undefined)
  mockRecordPlayerFeedback.mockResolvedValue(undefined)
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
    expect(screen.getByText('ממתינים להמשך מהמארח')).toBeInTheDocument()
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

    fireEvent.click(screen.getByText('מי הכי סביר?'))

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

    fireEvent.click(screen.getByText('מי הכי סביר?'))
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

    expect(screen.queryByText('מי הכי סביר?')).not.toBeInTheDocument()

    // The second game is the last one: no "are you sure" in the way.
    expect(screen.queryByText('לסיים את הערב?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('סיום הערב'))
    await waitFor(() => expect(mockEndGathering).toHaveBeenCalledTimes(1))
  })
})

describe('BetweenGames, choosing "who answered what"', () => {
  const base = {
    sessionId: 's1',
    hostUid: 'host',
    uid: 'host',
    gameId: 'game1',
    groupId: null,
    finishedType: 'who-said-that' as const,
    finishedOrder: 0,
    players,
    scores: {},
    isHost: true,
  }

  it('offers it next to "most likely to", with how many questions are available', async () => {
    render(<BetweenGames {...base} />)

    expect(screen.getByText('מי הכי סביר?')).toBeInTheDocument()
    expect(screen.getByText('מי ענה מה?')).toBeInTheDocument()
    expect(await screen.findByText('שאלות זמינות ל"מי ענה מה?": 4')).toBeInTheDocument()
    // Only a count of questions is ever asked for - never what anyone answered.
    expect(mockDescribeAnswerPool).toHaveBeenCalledWith(expect.anything(), 's1', players)
  })

  it('writes the finished game’s facts, then starts it as the next game', async () => {
    render(<BetweenGames {...base} />)
    await screen.findByText('שאלות זמינות ל"מי ענה מה?": 4')

    fireEvent.click(screen.getByText('מי ענה מה?'))

    await waitFor(() => expect(mockStartWhoAnswered).toHaveBeenCalledTimes(1))
    expect(mockEnsureContacts).toHaveBeenCalledTimes(1)
    expect(mockStartWhoAnswered.mock.calls[0][2]).toBe(1)
    expect(mockStartSecondGame).not.toHaveBeenCalled()
  })

  // A greyed button with no reason reads as broken, so the reason is written.
  it('disables it with a plain explanation when no question has enough answers', async () => {
    mockDescribeAnswerPool.mockResolvedValue({ availableQuestions: 0 })
    render(<BetweenGames {...base} />)

    expect(await screen.findByText(/צריך לפחות 3 שחקנים שענו בלובי/)).toBeInTheDocument()
    expect(screen.getByText('מי ענה מה?').closest('button')).toBeDisabled()
    expect(screen.getByText('מי הכי סביר?').closest('button')).not.toBeDisabled()
  })

  it('stays disabled while the check is still running, and when it fails', async () => {
    mockDescribeAnswerPool.mockReturnValue(new Promise(() => {}))
    const pending = render(<BetweenGames {...base} />)
    expect(screen.getByText('מי ענה מה?').closest('button')).toBeDisabled()
    pending.unmount()

    mockDescribeAnswerPool.mockRejectedValue({ code: 'permission-denied' })
    render(<BetweenGames {...base} />)
    expect(await screen.findByText(/לא הצלחנו לבדוק/)).toBeInTheDocument()
    expect(screen.getByText('מי ענה מה?').closest('button')).toBeDisabled()
  })

  it('does not count anything for a player who is not running the room, nor after the second game', () => {
    const guest = render(<BetweenGames {...base} isHost={false} />)
    expect(screen.queryByText('מי ענה מה?')).not.toBeInTheDocument()
    guest.unmount()

    render(<BetweenGames {...base} finishedType="who-answered-what" finishedOrder={1} />)
    expect(screen.queryByText('מי ענה מה?')).not.toBeInTheDocument()
    expect(screen.getByText('סיום הערב')).toBeInTheDocument()
    expect(mockDescribeAnswerPool).not.toHaveBeenCalled()
  })

  // Only who is PRESENT matters to the count, not the heartbeat that makes
  // every roster snapshot a new array: re-reading every player's answers on
  // each heartbeat would be hundreds of reads for nothing.
  it('does not re-read the answers when only a heartbeat changed', async () => {
    const view = render(<BetweenGames {...base} />)
    await screen.findByText('שאלות זמינות ל"מי ענה מה?": 4')
    view.rerender(<BetweenGames {...base} players={players.map((p) => ({ ...p }))} />)
    expect(mockDescribeAnswerPool).toHaveBeenCalledTimes(1)

    view.rerender(
      <BetweenGames {...base} players={[...players, { id: 'd', name: 'Dan', hasDevice: true, leftAt: null }]} />,
    )
    await waitFor(() => expect(mockDescribeAnswerPool).toHaveBeenCalledTimes(2))
  })
})

describe('BetweenGames leader', () => {
  const base = {
    sessionId: 's1',
    hostUid: 'host',
    uid: 'host',
    gameId: 'game1',
    groupId: null,
    finishedOrder: 0,
    isHost: true,
  }

  it('names the leader after the first game', () => {
    render(
      <BetweenGames {...base} finishedType="who-said-that" players={players} scores={{ a: 3, b: 1 }} />,
    )
    expect(screen.getByText(`${players[0].name} מוביל/ה!`)).toBeInTheDocument()
  })

  it('names nobody when nobody has scored, and not after the second game', () => {
    const first = render(
      <BetweenGames {...base} finishedType="who-said-that" players={players} scores={{}} />,
    )
    expect(screen.queryByText(/מוביל/)).not.toBeInTheDocument()
    first.unmount()

    render(
      <BetweenGames {...base} finishedType="most-likely-to" players={players} scores={{ a: 3 }} />,
    )
    expect(screen.queryByText(/מוביל/)).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByText('מי הכי סביר?'))

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

    fireEvent.click(screen.getByText('מי הכי סביר?'))

    await waitFor(() => expect(mockStartSecondGame).toHaveBeenCalledTimes(1))
  })

  // Keeping the evening is not the same decision as keeping the group, and
  // conflating them is what made a return visit record nothing at all: the
  // screen saw a groupId, assumed "already saved", and never wrote a thing.
  it('keeps the evening by itself, before anyone taps anything', async () => {
    render(
      <Finale sessionId="s1" hostUid="host" uid="host" isHost players={players} scores={{}} groupId={null} />,
    )

    await waitFor(() => expect(mockWriteRemainingFacts).toHaveBeenCalledTimes(1))
    expect(mockEnsureContacts).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('נשמרו 5 תשובות מהערב')).toBeInTheDocument()
  })

  it('keeps a returning group’s evening too, and does not re-ask for its name', async () => {
    mockGroupName.mockReturnValue({ name: 'המשפחה', loading: false })

    render(
      <Finale sessionId="s1" hostUid="host" uid="host" isHost players={players} scores={{}} groupId="g1" />,
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
        uid="host"
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
        uid="host"
        isHost={false}
        players={players}
        scores={{}}
        groupId={null}
      />,
    )
    expect(screen.queryByText('שמירת הקבוצה')).not.toBeInTheDocument()
    guest.unmount()

    render(
      <Finale sessionId="s1" hostUid="host" uid="host" isHost players={players} scores={{}} groupId={null} />,
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
      <Finale sessionId="s1" hostUid="host" uid="host" isHost players={players} scores={{}} groupId="g1" />,
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

describe('Finale play again', () => {
  it('lets the host open a new room for the same group', async () => {
    const onPlayAgain = vi.fn().mockResolvedValue(undefined)
    render(
      <Finale sessionId="s1" hostUid="host" uid="host" isHost players={players} scores={{}} groupId="g1" onPlayAgain={onPlayAgain} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'לשחק שוב' }))

    await waitFor(() => expect(onPlayAgain).toHaveBeenCalledWith('g1'))
  })

  it('uses this evening as the group when none was ever named', async () => {
    const onPlayAgain = vi.fn().mockResolvedValue(undefined)
    render(
      <Finale sessionId="s1" hostUid="host" uid="host" isHost players={players} scores={{}} groupId={null} onPlayAgain={onPlayAgain} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'לשחק שוב' }))

    await waitFor(() => expect(onPlayAgain).toHaveBeenCalledWith('s1'))
  })

  it('does not offer it to a guest', () => {
    render(
      <Finale sessionId="s1" hostUid="host" uid="guest" isHost={false} players={players} scores={{}} groupId="g1" />,
    )

    expect(screen.queryByRole('button', { name: 'לשחק שוב' })).not.toBeInTheDocument()
  })
})

describe('Finale feedback', () => {
  it('asks a guest too, and records only their own answer', async () => {
    render(
      <Finale sessionId="s1" hostUid="host" uid="guest-uid" isHost={false} players={players} scores={{}} groupId={null} />,
    )

    expect(screen.getByText('איך היה הערב?')).toBeInTheDocument()
    expect(screen.queryByText('כמה הייתם?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('עבד מצוין'))
    fireEvent.click(screen.getByRole('button', { name: 'שליחה' }))

    await waitFor(() =>
      expect(mockRecordPlayerFeedback).toHaveBeenCalledWith(expect.anything(), 's1', 'guest-uid', 'good'),
    )
    expect(mockRecordFeedback).not.toHaveBeenCalled()
  })

  it('keeps the host’s private note with the headcount as well', async () => {
    render(
      <Finale sessionId="s1" hostUid="host" uid="host" isHost players={players} scores={{}} groupId={null} />,
    )

    fireEvent.click(screen.getByText('עבד מצוין'))
    fireEvent.click(screen.getByRole('button', { name: 'שליחה' }))

    await waitFor(() => expect(mockRecordFeedback).toHaveBeenCalledTimes(1))
    expect(mockRecordPlayerFeedback).toHaveBeenCalledTimes(1)
  })
})

describe('Finale', () => {
  it('names the winner and shows the final standings', () => {
    render(
      <Finale
        sessionId="s1"
        hostUid="host"
        uid="host"
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
        uid="host"
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
        uid="host"
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
