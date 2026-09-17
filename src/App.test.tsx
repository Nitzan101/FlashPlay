import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import './i18n'
import { signOutUser, useAuthUser } from './lib/auth'

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
const mockLeaveRoom = vi.fn()

vi.mock('./lib/room', () => ({
  createRoom: (...args: unknown[]) => mockCreateRoom(...args),
  joinRoom: (...args: unknown[]) => mockJoinRoom(...args),
  resolveRoomCode: (...args: unknown[]) => mockResolveRoomCode(...args),
  leaveRoom: (...args: unknown[]) => mockLeaveRoom(...args),
  setPlayerEmoji: vi.fn().mockResolvedValue(undefined),
  useRoster: () => ({ players: [], error: null }),
  usePresenceHeartbeat: () => {},
  // These tests never leave the lobby, so a fixed 'lobby' phase is enough to
  // route Gathering.tsx there - milestone 4's own screen (Harvest, driven by
  // useGame) is exercised in Harvest.test.tsx instead.
  useSession: () => ({ session: { phase: 'lobby', currentGameId: null }, error: null }),
}))

// Gathering.tsx (and, through it, Lobby.tsx and Harvest.tsx) import from
// here - mocked so these tests never touch real Firestore calls through a
// path App.tsx itself does not exercise.
vi.mock('./lib/harvest', () => ({
  useGame: () => ({ game: null, error: null }),
  useHarvestProgress: () => ({ submittedCount: 0, error: null }),
  pickHarvestPromptIds: () => ['p1', 'p2'],
  startHarvestGame: vi.fn(),
  submitHarvestItem: vi.fn(),
  getMySubmission: vi.fn().mockResolvedValue(null),
  getSubmissionState: vi.fn().mockResolvedValue('none'),
  advanceGamePhase: vi.fn(),
  extendGamePhase: vi.fn(),
}))

// App.tsx renders the host's saved groups, which listens to Firestore through
// this module. Mocked here rather than widening the `firebase/firestore` mock:
// the third time in this project that adding one import broke a suite that had
// no other connection to it (see CLAUDE.md, Known pitfalls).
// A registered host's own default identity - see src/lib/profile.ts. Mocked
// for the same reason ./lib/memory is: this suite has no real Firestore.
const mockUserProfile = vi.fn()
const mockSaveUserProfile = vi.fn()
vi.mock('./lib/profile', () => ({
  useUserProfile: () => mockUserProfile(),
  saveUserProfile: (...args: unknown[]) => mockSaveUserProfile(...args) as unknown,
}))

const mockSavedGroups = vi.fn()
const mockCreateGroup = vi.fn()
vi.mock('./lib/memory', () => ({
  useSavedGroups: () => mockSavedGroups(),
  createGroup: (...args: unknown[]) => mockCreateGroup(...args) as unknown,
  // GroupDetails reaches for these; the landing screen only renders it once
  // the host taps into a group, but the mock factory has to list every export
  // its consumers import regardless (CLAUDE.md, Known pitfalls - this has now
  // bitten three times).
  useGroupMemory: () => ({
    groupName: '',
    members: [],
    groupFacts: [],
    loading: false,
    error: null,
  }),
  deleteFact: vi.fn(),
  deleteGroup: vi.fn(),
  nameGroup: vi.fn(),
}))

const mockedUseAuthUser = vi.mocked(useAuthUser)
const mockSignOutUser = vi.mocked(signOutUser)

afterEach(() => {
  localStorage.clear()
  window.history.pushState({}, '', '/')
  vi.clearAllMocks()
})

beforeEach(() => {
  mockSavedGroups.mockReturnValue({ groups: [], loading: false, error: null })
  mockUserProfile.mockReturnValue({ displayName: '', emoji: null, loading: false })
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
    expect(screen.getByRole('alert')).toHaveTextContent('ההתחברות נכשלה. אפשר לנסות שוב.')
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

  /** The signed-in host with one saved group - the state every room-picker
   *  test below starts from. */
  function signedInWithOneGroup() {
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'host-uid', displayName: 'דוד', email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    mockSavedGroups.mockReturnValue({
      groups: [{ id: 'group-1', name: 'המשפחה', memberContactIds: [], createdAt: 0 }],
      loading: false,
      error: null,
    })
    mockCreateRoom.mockResolvedValue({ sessionId: 'session-2', roomCode: '4321' })
    mockJoinRoom.mockResolvedValue(undefined)
  }

  // Milestone 7: a second gathering with the same people continues their
  // memory instead of starting a parallel copy of the same family.
  it('opens a room for the saved group the host selected', async () => {
    signedInWithOneGroup()

    render(<App />)
    // Two steps, not one: picking the group only moves the selection. The
    // first version made every group its own "open a room" button, so there
    // was no way to see which gathering you were about to start.
    fireEvent.click(await screen.findByRole('radio', { name: /המשפחה/ }))
    expect(screen.getByRole('radio', { name: /המשפחה/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת חדר' }))

    await waitFor(() => expect(mockCreateRoom).toHaveBeenCalledTimes(1))
    expect(mockCreateRoom.mock.calls[0][3]).toBe('group-1')
  })

  it('defaults to a new room, so a host who ignores the list gets no group', async () => {
    signedInWithOneGroup()

    render(<App />)
    expect(await screen.findByRole('radio', { name: /חדר חדש/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת חדר' }))

    await waitFor(() => expect(mockCreateRoom).toHaveBeenCalledTimes(1))
    expect(mockCreateRoom.mock.calls[0][3]).toBeNull()
  })

  it('opens a room for nobody in particular when the host has no saved groups', async () => {
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'host-uid', displayName: 'דוד', email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    mockCreateRoom.mockResolvedValue({ sessionId: 'session-1', roomCode: '1234' })
    mockJoinRoom.mockResolvedValue(undefined)

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'פתיחת חדר' }))

    await waitFor(() => expect(mockCreateRoom).toHaveBeenCalledTimes(1))
    expect(mockCreateRoom.mock.calls[0][3]).toBeNull()
  })

  it('lets the host add a group before ever playing with those people', async () => {
    signedInWithOneGroup()
    mockCreateGroup.mockResolvedValue('group-new')

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '+ הוספת קבוצה' }))
    fireEvent.change(screen.getByPlaceholderText('שם הקבוצה (למשל: המשפחה)'), {
      target: { value: 'החברים' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }))

    await waitFor(() => expect(mockCreateGroup).toHaveBeenCalledTimes(1))
    expect(mockCreateGroup.mock.calls[0][2]).toBe('החברים')
  })

  // The details screen used to render from inside the saved-groups list, so
  // these two stayed on screen underneath it - one of which signs the host out.
  it('hides sign-out and the room-code field while a group is being inspected', async () => {
    signedInWithOneGroup()

    render(<App />)
    // Proves the absence below is caused by the details screen rather than by
    // a mistyped query: both controls are on the landing screen to begin with.
    expect(await screen.findByRole('button', { name: 'התנתקות' })).toBeInTheDocument()
    expect(screen.getByLabelText('יש לך קוד לחדר?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'פרטים' }))

    expect(screen.queryByRole('button', { name: 'התנתקות' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('יש לך קוד לחדר?')).not.toBeInTheDocument()
    // But opening a room for this very group stays available from here.
    expect(screen.getByRole('button', { name: 'פתיחת חדר לקבוצה הזאת' })).toBeInTheDocument()
  })

  it('asks before signing the host out', async () => {
    signedInWithOneGroup()

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'התנתקות' }))

    expect(screen.getByText('בטוח שברצונך להתנתק?')).toBeInTheDocument()
    expect(mockSignOutUser).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'כן, להתנתק' }))
    expect(mockSignOutUser).toHaveBeenCalledTimes(1)
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

    expect(await screen.findByRole('alert')).toHaveTextContent('אי אפשר לפתוח חדר כרגע.')
  })

  // Found during the first manual walkthrough: a browser holding a session
  // from an earlier test resumed it forever, with no screen that ever
  // cleared it.
  it('lets the host leave the room and forget it, after confirming', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'יציאה מהחדר' }))
    fireEvent.click(await screen.findByRole('button', { name: 'כן, לצאת' }))

    expect(await screen.findByRole('button', { name: 'פתיחת חדר' })).toBeInTheDocument()
    expect(localStorage.getItem('flashplay.session')).toBeNull()
    expect(mockLeaveRoom).toHaveBeenCalledWith(expect.anything(), 'session-1', 'host-uid')
  })

  // Found in Nitzan's own manual walkthrough of the first version of this fix:
  // a single tap left the room outright, with no way back from a mis-tap.
  it('does not leave the room until the leave is confirmed', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'יציאה מהחדר' }))
    fireEvent.click(await screen.findByRole('button', { name: 'להישאר' }))

    expect(screen.getByText('קוד החדר: 1234')).toBeInTheDocument()
    expect(mockLeaveRoom).not.toHaveBeenCalled()
  })
})

describe('joining by typed code', () => {
  // Found by the independent review of the first version of this fix: the
  // code input had only been added to the signed-out/anonymous branch, so a
  // registered host handed a friend's room code had no way to use it either.
  it('is also offered to an already signed-in host', async () => {
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'host-uid', displayName: 'דוד', email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    render(<App />)
    expect(await screen.findByLabelText('יש לך קוד לחדר?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הצטרפות עם קוד' })).toBeInTheDocument()
  })


  // `roomCodes`/`resolveRoomCode` exist precisely to turn a typed code into a
  // session (DECISIONS.md, milestone 3) - this is the UI path that had never
  // been wired to it. Found in Nitzan's own manual walkthrough.
  it('lets someone without a link type the room code instead', async () => {
    mockedUseAuthUser.mockReturnValue({ user: null, loading: false, redirectError: null })
    const { signInAsGuest } = await import('./lib/auth')
    vi.mocked(signInAsGuest).mockResolvedValue('guest-uid')
    mockResolveRoomCode.mockResolvedValue('session-1')
    mockJoinRoom.mockResolvedValue(undefined)

    render(<App />)
    fireEvent.change(screen.getByLabelText('יש לך קוד לחדר?'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'הצטרפות עם קוד' }))

    const nameField = await screen.findByLabelText('איך קוראים לך?')
    fireEvent.change(nameField, { target: { value: 'שרה' } })
    fireEvent.click(screen.getByRole('button', { name: 'הצטרפות' }))

    await waitFor(() => expect(screen.getByText('קוד החדר: 1234')).toBeInTheDocument())
    expect(mockJoinRoom).toHaveBeenCalledWith(expect.anything(), 'session-1', 'guest-uid', 'שרה')
  })

  it('shows an error for a typed code nobody has claimed', async () => {
    mockedUseAuthUser.mockReturnValue({ user: null, loading: false, redirectError: null })
    const { signInAsGuest } = await import('./lib/auth')
    vi.mocked(signInAsGuest).mockResolvedValue('guest-uid')
    mockResolveRoomCode.mockRejectedValue(new Error('room-not-found'))

    render(<App />)
    fireEvent.change(screen.getByLabelText('יש לך קוד לחדר?'), { target: { value: '9999' } })
    fireEvent.click(screen.getByRole('button', { name: 'הצטרפות עם קוד' }))

    // Its own wording, not the link path's "roomNotFound" (which talks about
    // a link, nonsensical for a typed code) - found in Nitzan's own play
    // session, 2026-09-16.
    expect(
      await screen.findByText('הקוד שהקלדת לא נמצא. אפשר לבדוק שוב עם מי שמארח/ת.'),
    ).toBeInTheDocument()
    // The landing page itself survives the error - unlike the link path, a
    // mistyped code should not blank the whole screen.
    expect(screen.getByRole('button', { name: 'התחברות עם Google' })).toBeInTheDocument()
  })
})

describe('a guest who left a room', () => {
  // Anonymous auth gives a leaving guest a truthy `user`, which used to fall
  // into the signed-in host dashboard: a "sign out" button for an account
  // never signed in to, and a "create room" button firestore.rules was always
  // going to refuse. Found in Nitzan's own manual walkthrough.
  it('is offered sign-in, not the host dashboard', () => {
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'guest-uid', isAnonymous: true, displayName: null, email: null } as never,
      loading: false,
      redirectError: null,
    })
    render(<App />)
    expect(screen.getByRole('button', { name: 'התחברות עם Google' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'פתיחת חדר' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'התנתקות' })).not.toBeInTheDocument()
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

  // Found in Nitzan's own play session, 2026-09-16: two players both typed
  // "אלה" (one had left and rejoined under a new identity), and every reveal
  // and the scoreboard became ambiguous about which one a round's points
  // belonged to. joinRoom() now refuses a second, different player claiming a
  // name already in use - shown here inline, on the same name-entry form, so
  // the person can just try another name rather than the whole screen
  // wiping into the generic join-error page.
  it('lets someone try a different name instead of wiping the screen, when the name is taken', async () => {
    window.history.pushState({}, '', '/join/1234')
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'guest-uid', displayName: null, email: null } as never,
      loading: false,
      redirectError: null,
    })
    mockResolveRoomCode.mockResolvedValue('session-1')
    mockJoinRoom.mockRejectedValueOnce(new Error('name-taken'))
    mockJoinRoom.mockResolvedValueOnce(undefined)

    render(<App />)
    const nameField = await screen.findByLabelText('איך קוראים לך?')
    fireEvent.change(nameField, { target: { value: 'אלה' } })
    fireEvent.click(screen.getByRole('button', { name: 'הצטרפות' }))

    expect(
      await screen.findByText('השם הזה כבר תפוס בחדר הזה - אפשר לנסות שם אחר.'),
    ).toBeInTheDocument()
    // Still on the name-entry form, not the whole-page error screen.
    expect(screen.getByLabelText('איך קוראים לך?')).toBeInTheDocument()

    fireEvent.change(nameField, { target: { value: 'אלה 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'הצטרפות' }))

    await waitFor(() => expect(screen.getByText('קוד החדר: 1234')).toBeInTheDocument())
  })

  it('goes straight back into the room if this browser already joined it, as a guest', async () => {
    // Membership resumption is decided from local state, not from Firestore:
    // a guest cannot read its own player document before joining
    // (room.test.ts pins that down against real rules), so asking would fail
    // for the very people who have not joined yet.
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
    // isHost IS derived via one getDoc on the session, unlike membership.
    mockGetDoc.mockResolvedValue({ data: () => ({ hostUid: 'someone-else' }) })

    render(<App />)

    await waitFor(() => expect(screen.getByText('קוד החדר: 1234')).toBeInTheDocument())
    expect(screen.queryByLabelText('איך קוראים לך?')).not.toBeInTheDocument()
    // A guest does not get the host-only share panel.
    expect(screen.queryByText('קישור להצטרפות')).not.toBeInTheDocument()
  })

  it('keeps host controls when the host taps their own share link', async () => {
    // A hardcoded isHost:false on this exact path was a real bug: a host
    // checking the link they just posted was demoted to a guest in their own
    // room and lost the share button for good.
    window.history.pushState({}, '', '/join/1234')
    localStorage.setItem(
      'flashplay.session',
      JSON.stringify({ sessionId: 'session-1', roomCode: '1234' }),
    )
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'host-uid', displayName: 'דוד', email: null } as never,
      loading: false,
      redirectError: null,
    })
    mockResolveRoomCode.mockResolvedValue('session-1')
    mockGetDoc.mockResolvedValue({ data: () => ({ hostUid: 'host-uid' }) })

    render(<App />)

    await waitFor(() => expect(screen.getByText('קישור להצטרפות')).toBeInTheDocument())
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
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'החדר לא נמצא. ייתכן שהקישור כבר לא בתוקף.',
    )
  })

  it('shows a distinct message for a code that has expired', async () => {
    window.history.pushState({}, '', '/join/9999')
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'guest-uid', displayName: null, email: null } as never,
      loading: false,
      redirectError: null,
    })
    mockResolveRoomCode.mockRejectedValue(new Error('room-expired'))

    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'הקישור הזה כבר לא בתוקף. אפשר לבקש מהמארח לשלוח קישור חדש.',
    )
  })

  it('offers a retry button on a join failure', async () => {
    window.history.pushState({}, '', '/join/9999')
    mockedUseAuthUser.mockReturnValue({
      user: { uid: 'guest-uid', displayName: null, email: null } as never,
      loading: false,
      redirectError: null,
    })
    mockResolveRoomCode.mockRejectedValue(new Error('room-not-found'))

    render(<App />)
    expect(await screen.findByRole('button', { name: 'ניסיון נוסף' })).toBeInTheDocument()
  })
})
