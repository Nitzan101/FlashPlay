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

const players = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Carol' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockStartSecondGame.mockResolvedValue('game2')
  mockEndGathering.mockResolvedValue(undefined)
})

describe('BetweenGames', () => {
  // The scores are cumulative across the gathering precisely so the room can
  // see where it stands between games; a bare "waiting for the host" would
  // throw that away at the most interesting moment.
  it('keeps the standings on screen while the room waits', () => {
    render(
      <BetweenGames
        sessionId="s1"
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

  it('offers the host the second game after the first one', async () => {
    render(
      <BetweenGames
        sessionId="s1"
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

describe('Finale', () => {
  it('names the winner and shows the final standings', () => {
    render(<Finale players={players} scores={{ a: 7, b: 3 }} />)

    expect(screen.getByText('זהו, נגמר!')).toBeInTheDocument()
    expect(screen.getByText('Alice ניצח/ה עם 7 נקודות')).toBeInTheDocument()
    const board = screen.getByText('הניקוד הסופי').parentElement
    expect(board?.textContent).toMatch(/Alice7.*Bob3.*Carol0/)
  })

  it('names everyone on a tie rather than picking one', () => {
    render(<Finale players={players} scores={{ a: 5, b: 5 }} />)

    expect(screen.getByText('תיקו בין Alice, Bob עם 5 נקודות')).toBeInTheDocument()
  })

  it('claims no winner when nobody scored', () => {
    render(<Finale players={players} scores={{}} />)

    expect(screen.queryByText(/ניצח/)).not.toBeInTheDocument()
    expect(screen.getByText('הניקוד הסופי')).toBeInTheDocument()
  })
})
