import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Gathering from './Gathering'
import MarkedLeftNotice from './MarkedLeftNotice'
import './i18n'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const mockRejoinRoom = vi.fn()
let players: { id: string; name: string; emoji?: string; leftAt: number | null }[] = []
let session: Record<string, unknown> = {}

vi.mock('./lib/room', () => ({
  rejoinRoom: (...args: unknown[]) => mockRejoinRoom(...args) as unknown,
  useRoster: () => ({ players, error: null }),
  useSession: () => ({ session, error: null }),
  usePresenceHeartbeat: () => undefined,
  errorCode: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))
vi.mock('./lib/harvest', () => ({ useGame: () => ({ game: null, error: null }) }))
vi.mock('./Lobby', () => ({ default: () => <p>lobby screen</p> }))

beforeEach(() => {
  vi.clearAllMocks()
  mockRejoinRoom.mockResolvedValue(undefined)
})

describe('MarkedLeftNotice', () => {
  it('lets the player back in under a new name', async () => {
    render(<MarkedLeftNotice sessionId="s1" uid="u1" emoji="🔥" requestedName="דוד" />)

    fireEvent.change(screen.getByLabelText('השם החדש שלי'), { target: { value: ' דוד ב ' } })
    fireEvent.click(screen.getByRole('button', { name: 'חזרה למשחק' }))

    await waitFor(() =>
      expect(mockRejoinRoom).toHaveBeenCalledWith({}, 's1', 'u1', 'דוד ב', '🔥'),
    )
  })

  it('refuses the very name they were asked to change', () => {
    render(<MarkedLeftNotice sessionId="s1" uid="u1" emoji={null} requestedName="דוד" />)

    fireEvent.change(screen.getByLabelText('השם החדש שלי'), { target: { value: 'דוד' } })

    expect(screen.getByRole('alert')).toHaveTextContent('צריך לבחור שם שונה')
    expect(screen.getByRole('button', { name: 'חזרה למשחק' })).toBeDisabled()
  })

  it('says so when the new name is taken', async () => {
    mockRejoinRoom.mockRejectedValue(new Error('name-taken'))
    render(<MarkedLeftNotice sessionId="s1" uid="u1" emoji={null} requestedName="דוד" />)

    fireEvent.change(screen.getByLabelText('השם החדש שלי'), { target: { value: 'שרה' } })
    fireEvent.click(screen.getByRole('button', { name: 'חזרה למשחק' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})

describe('Gathering, a player the host started without', () => {
  const base = { phase: 'lobby', hostUid: 'host', scores: {}, contactIds: {}, groupId: null }

  it('shows the notice, not the game, to a player marked left after a rename request', () => {
    players = [{ id: 'u1', name: 'דוד', leftAt: 123 }]
    session = { ...base, renameRequests: { u1: 'דוד' } }

    render(<Gathering sessionId="s1" roomCode="1234" uid="u1" />)

    expect(screen.getByText('המארח התחיל את המשחק בלי שבחרת שם אחר')).toBeInTheDocument()
    expect(screen.queryByText('lobby screen')).not.toBeInTheDocument()
  })

  it('leaves a player who simply left, with no rename request, alone', () => {
    players = [{ id: 'u1', name: 'דוד', leftAt: 123 }]
    session = { ...base }

    render(<Gathering sessionId="s1" roomCode="1234" uid="u1" />)

    expect(screen.queryByText('המארח התחיל את המשחק בלי שבחרת שם אחר')).not.toBeInTheDocument()
  })

  it('does not interrupt a player who is present, even with a rename request on file', () => {
    players = [{ id: 'u1', name: 'דוד ב', leftAt: null }]
    session = { ...base, renameRequests: { u1: 'דוד' } }

    render(<Gathering sessionId="s1" roomCode="1234" uid="u1" />)

    expect(screen.queryByText('המארח התחיל את המשחק בלי שבחרת שם אחר')).not.toBeInTheDocument()
  })
})
