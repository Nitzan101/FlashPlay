import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import './i18n'
import { useAuthUser } from './lib/auth'

vi.mock('./lib/auth', () => ({
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
  signInAsGuest: vi.fn(),
  useAuthUser: vi.fn(),
}))

// These tests exercise only the host-landing screen (no join code, no stored
// session), so the room flow itself is never invoked - but App.tsx imports
// `db` at module scope via ./lib/room and ./lib/firebase, and the real
// firebase.ts throws if Firebase env vars aren't configured. Mocking it keeps
// this suite independent of that configuration entirely.
vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {}, authDomain: 'example.firebaseapp.com' }))

const mockGetDoc = vi.fn()
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => ({ path: args }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}))

const mockCreateRoom = vi.fn()
const mockJoinRoom = vi.fn()
const mockResolveRoomCode = vi.fn()

vi.mock('./lib/room', () => ({
  createRoom: (...args: unknown[]) => mockCreateRoom(...args),
  joinRoom: (...args: unknown[]) => mockJoinRoom(...args),
  resolveRoomCode: (...args: unknown[]) => mockResolveRoomCode(...args),
  useRoster: () => [],
  usePresenceHeartbeat: () => {},
}))

const mockedUseAuthUser = vi.mocked(useAuthUser)

afterEach(() => {
  localStorage.clear()
  window.history.pushState({}, '', '/')
  vi.clearAllMocks()
})

describe('app shell', () => {
  beforeEach(() => {
    mockedUseAuthUser.mockReturnValue({ user: null, loading: false, redirectError: null })
  })

  it('renders its text through i18n rather than hardcoded strings', () => {
    render(<App />)
    // The key resolves only if i18next initialised; an unresolved key would
    // render as the literal 'tagline'.
    expect(screen.getByText('משחקים שנבנים מהאנשים שבחדר')).toBeInTheDocument()
    expect(screen.queryByText('tagline')).not.toBeInTheDocument()
  })

  it('serves an RTL Hebrew document', () => {
    // Guards the RTL decision at its only real home. A stray `npm create`
    // regenerating index.html would silently ship an LTR English document.
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).toMatch(/<html[^>]*\blang="he"/)
    expect(html).toMatch(/<html[^>]*\bdir="rtl"/)
  })
})

describe('host sign-in', () => {
  it('shows a sign-in button when no host is signed in', () => {
    mockedUseAuthUser.mockReturnValue({ user: null, loading: false, redirectError: null })
    render(<App />)
    expect(screen.getByRole('button', { name: 'התחברות עם Google' })).toBeInTheDocument()
  })

  it('shows a loading state instead of the button while auth state is unknown', () => {
    // Covers the moment right after a redirect completes: onAuthStateChanged
    // has not fired yet, so the UI must not flash a sign-in button the host
    // would otherwise be tempted to click again.
    mockedUseAuthUser.mockReturnValue({ user: null, loading: true, redirectError: null })
    render(<App />)
    expect(screen.queryByRole('button', { name: 'התחברות עם Google' })).not.toBeInTheDocument()
    expect(screen.getByText('טוען...')).toBeInTheDocument()
  })

  it('greets the signed-in host by name and offers to sign out', () => {
    mockedUseAuthUser.mockReturnValue({
      user: { displayName: 'דוד', email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    render(<App />)
    expect(screen.getByText('שלום, דוד')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'התנתקות' })).toBeInTheDocument()
  })

  it('falls back to the email when Google returns no display name', () => {
    mockedUseAuthUser.mockReturnValue({
      user: { displayName: null, email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    render(<App />)
    expect(screen.getByText('שלום, david@example.com')).toBeInTheDocument()
  })

  it('surfaces a failed redirect sign-in as an alert', () => {
    mockedUseAuthUser.mockReturnValue({
      user: null,
      loading: false,
      redirectError: new Error('auth/account-exists-with-different-credential'),
    })
    render(<App />)
    expect(screen.getByRole('alert')).toHaveTextContent('ההתחברות נכשלה. נסה שוב.')
  })
})

describe('creating a room', () => {
  it('opens a room and enters the lobby, host included as a player', async () => {
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'host-uid', displayName: 'דוד', email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    mockCreateRoom.mockResolvedValue({ sessionId: 'session-1', roomCode: '1234' })
    mockJoinRoom.mockResolvedValue(undefined)

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'פתיחת חדר' }))

    await waitFor(() => expect(screen.getByText('קוד החדר: 1234')).toBeInTheDocument())
    expect(mockJoinRoom).toHaveBeenCalledWith(expect.anything(), 'session-1', 'host-uid', 'דוד')
  })

  it('shows an error and stays put when opening a room fails', async () => {
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'host-uid', displayName: 'דוד', email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    mockCreateRoom.mockRejectedValue(new Error('offline'))

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'פתיחת חדר' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('לא הצלחנו לפתוח חדר. נסה שוב.')
  })
})

describe('joining by a link', () => {
  it('signs the guest in BEFORE reading anything, because every rule needs auth', async () => {
    // The first live join failed with "Missing or insufficient permissions":
    // the room code was read while the guest still had no identity at all,
    // and `roomCodes` is `allow get: if isSignedIn()`. Mocking resolveRoomCode
    // hid it, because a mock happily resolves for an unauthenticated caller -
    // a state that cannot exist against real Firestore.
    window.history.pushState({}, '', '/join/1234')
    mockedUseAuthUser.mockReturnValue({ user: null, loading: false, redirectError: null })
    const { signInAsGuest } = await import('./lib/auth')
    vi.mocked(signInAsGuest).mockResolvedValue('guest-uid')
    mockResolveRoomCode.mockResolvedValue('session-1')

    render(<App />)

    await waitFor(() => expect(signInAsGuest).toHaveBeenCalled())
    expect(mockResolveRoomCode).not.toHaveBeenCalled()
  })

  it('asks a guest for a name, then joins and shows the lobby', async () => {
    window.history.pushState({}, '', '/join/1234')
    // Anonymous sign-in has already landed by this point - that is what the
    // test above covers - so the guest arrives here with a uid.
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'guest-uid', displayName: null, email: null } as never,
      loading: false,
      redirectError: null,
    })
    mockResolveRoomCode.mockResolvedValue('session-1')
    mockJoinRoom.mockResolvedValue(undefined)

    render(<App />)
    const nameField = await screen.findByLabelText('איך קוראים לך?')
    fireEvent.change(nameField, { target: { value: 'שרה' } })
    fireEvent.click(screen.getByRole('button', { name: 'הצטרפות' }))

    await waitFor(() => expect(screen.getByText('קוד החדר: 1234')).toBeInTheDocument())
    expect(mockJoinRoom).toHaveBeenCalledWith(expect.anything(), 'session-1', 'guest-uid', 'שרה')
  })

  it('goes straight back into the room if this browser already joined it', async () => {
    // Resumption is decided from local state, not from Firestore: a guest
    // cannot read its own player document before joining (room.test.ts pins
    // that down against real rules), so asking would fail for the very people
    // who have not joined yet.
    window.history.pushState({}, '', '/join/1234')
    localStorage.setItem(
      'flashplay.session',
      JSON.stringify({ sessionId: 'session-1', roomCode: '1234' }),
    )
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'guest-uid', displayName: null, email: null } as never,
      loading: false,
      redirectError: null,
    })
    mockResolveRoomCode.mockResolvedValue('session-1')

    render(<App />)

    await waitFor(() => expect(screen.getByText('קוד החדר: 1234')).toBeInTheDocument())
    expect(screen.queryByLabelText('איך קוראים לך?')).not.toBeInTheDocument()
    // The join path must not touch Firestore for membership at all.
    expect(mockGetDoc).not.toHaveBeenCalled()
  })

  it('shows an error for a code nobody has claimed', async () => {
    window.history.pushState({}, '', '/join/9999')
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'guest-uid', displayName: null, email: null } as never,
      loading: false,
      redirectError: null,
    })
    mockResolveRoomCode.mockRejectedValue(new Error('room-not-found'))

    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('החדר לא נמצא. ודא שהקישור נכון.')
  })
})
