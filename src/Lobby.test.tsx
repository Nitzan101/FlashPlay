import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Lobby from './Lobby'
import './i18n'
import type { PlayerDoc } from './lib/model'

// Lobby.tsx reaches Firestore only through ./lib/room and ./lib/harvest;
// mocking both keeps this suite independent of real Firestore/env config.
vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))
vi.mock('./lib/harvest', () => ({
  pickHarvestPromptIds: () => ['p1', 'p2'],
  startHarvestGame: vi.fn(),
}))

let players: (PlayerDoc & { id: string })[] = []
const mockRenamePlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('./lib/room', () => ({
  useRoster: () => ({ players, error: null }),
  renamePlayer: (...args: unknown[]) => mockRenamePlayer(...args) as unknown,
  // useAction() (used by the self-edit form) reaches for this - see
  // CLAUDE.md, Known pitfalls: a mock factory must list every export its
  // consumers import, even transitively.
  errorCode: (error: unknown) =>
    error && typeof error === 'object' && 'code' in error
      ? (error as { code: string }).code
      : error instanceof Error
        ? error.message
        : String(error),
}))

function player(id: string, overrides: Partial<PlayerDoc> = {}): PlayerDoc & { id: string } {
  return {
    id,
    name: id,
    uid: id,
    hasDevice: true,
    lastSeenAt: 0,
    joinedAt: 0,
    votedRoundId: null,
    leftAt: null,
    ...overrides,
  }
}

afterEach(() => {
  mockRenamePlayer.mockClear()
})

describe('Lobby', () => {
  it('shows a player\'s chosen emoji next to their name', () => {
    players = [player('host-uid', { name: 'דוד', emoji: '🦄' })]
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    expect(screen.getByText('דוד').closest('li')).toHaveTextContent('🦄')
  })

  it('offers editing only on the current player\'s own row', () => {
    players = [player('host-uid', { name: 'דוד' }), player('guest-uid', { name: 'שרה' })]
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    const editButtons = screen.getAllByRole('button', { name: 'עריכת השם/הסמל שלי' })
    expect(editButtons).toHaveLength(1)
  })

  it('renames the current player through renamePlayer, not any other row', async () => {
    players = [player('host-uid', { name: 'דוד' }), player('guest-uid', { name: 'שרה' })]
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    fireEvent.click(screen.getByRole('button', { name: 'עריכת השם/הסמל שלי' }))
    const nameInput = screen.getByDisplayValue('דוד')
    fireEvent.change(nameInput, { target: { value: 'דויד' } })
    fireEvent.click(screen.getByRole('radio', { name: /🦄/ }))
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))

    await waitFor(() => expect(mockRenamePlayer).toHaveBeenCalledWith(
      expect.anything(),
      's1',
      'host-uid',
      'דויד',
      '🦄',
    ))
  })

  it('shows a taken-name error inline rather than a raw error code', async () => {
    players = [player('host-uid', { name: 'דוד' })]
    mockRenamePlayer.mockRejectedValueOnce(new Error('name-taken'))
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    fireEvent.click(screen.getByRole('button', { name: 'עריכת השם/הסמל שלי' }))
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))

    expect(await screen.findByText('השם הזה כבר תפוס בחדר הזה - אפשר לנסות שם אחר.')).toBeInTheDocument()
  })

  // Found in Nitzan's own manual walkthrough: with a host and a guest in the
  // room, nothing on screen said which one was the host.
  it('labels the host in the roster', () => {
    players = [player('host-uid', { name: 'דוד' }), player('guest-uid', { name: 'שרה' })]
    render(<Lobby sessionId="s1" roomCode="1234" uid="guest-uid" isHost={false} hostUid="host-uid" />)

    const hostRow = screen.getByText('דוד').closest('li')
    expect(hostRow).toHaveTextContent('(מארח/ת)')
    const guestRow = screen.getByText('שרה').closest('li')
    expect(guestRow).not.toHaveTextContent('(מארח/ת)')
  })

  // Found in the same walkthrough: a player who explicitly left the room
  // still looked exactly as present as everyone else to the rest of the room.
  it('marks a player who explicitly left, and excludes them from the count', () => {
    players = [
      player('host-uid', { name: 'דוד' }),
      player('guest-uid', { name: 'שרה', leftAt: Date.now() }),
    ]
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    const leftRow = screen.getByText('שרה').closest('li')
    expect(leftRow).toHaveTextContent('(עזב/ה)')
    expect(screen.getByText('משתתף אחד בחדר')).toBeInTheDocument()
  })

  it('does not mark a player who is still present', () => {
    players = [player('host-uid', { name: 'דוד' })]
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    expect(screen.getByText('דוד').closest('li')).not.toHaveTextContent('(עזב/ה)')
  })

  // Found live: starting a game with only the host in the room showed a vote
  // screen with zero candidates, since "who said that" excludes the voter.
  it('refuses to start the game with only the host in the room', () => {
    players = [player('host-uid', { name: 'דוד' })]
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    expect(screen.getByRole('button', { name: 'התחלת המשחק' })).toBeDisabled()
    expect(screen.getByText('צריך לפחות 2 משתתפים כדי להתחיל')).toBeInTheDocument()
  })

  it('allows starting the game once there are enough players', () => {
    players = [player('host-uid', { name: 'דוד' }), player('guest-uid', { name: 'שרה' })]
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    expect(screen.getByRole('button', { name: 'התחלת המשחק' })).not.toBeDisabled()
    expect(screen.queryByText('צריך לפחות 2 משתתפים כדי להתחיל')).not.toBeInTheDocument()
  })

  it('still refuses to start when the second player has left, even though they once joined', () => {
    players = [
      player('host-uid', { name: 'דוד' }),
      player('guest-uid', { name: 'שרה', leftAt: Date.now() }),
    ]
    render(<Lobby sessionId="s1" roomCode="1234" uid="host-uid" isHost={true} hostUid="host-uid" />)

    expect(screen.getByRole('button', { name: 'התחלת המשחק' })).toBeDisabled()
  })
})
