import { act, renderHook, waitFor } from '@testing-library/react'
import type { User } from 'firebase/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = { name: 'fake-auth-instance' } as never

vi.mock('./firebase', () => ({ auth: mockAuth }))

const mockOnAuthStateChanged = vi.fn()
const mockGetRedirectResult = vi.fn()
const mockSignInWithRedirect = vi.fn()
const mockSignOut = vi.fn()

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}))

// Imported after the mocks above so the module under test picks them up.
const { signInWithGoogle, signOutUser, useAuthUser } = await import('./auth')

describe('signInWithGoogle', () => {
  it('redirects rather than popping up, because mobile browsers block popups', () => {
    mockSignInWithRedirect.mockResolvedValue(undefined)
    void signInWithGoogle()
    expect(mockSignInWithRedirect).toHaveBeenCalledWith(mockAuth, expect.any(Object))
  })
})

describe('signOutUser', () => {
  it('calls firebase signOut with the shared auth instance', () => {
    mockSignOut.mockResolvedValue(undefined)
    void signOutUser()
    expect(mockSignOut).toHaveBeenCalledWith(mockAuth)
  })
})

describe('useAuthUser', () => {
  beforeEach(() => {
    mockOnAuthStateChanged.mockReset()
    mockGetRedirectResult.mockReset()
  })

  it('starts loading and resolves once onAuthStateChanged reports a user', async () => {
    let capturedCallback: ((user: User | null) => void) | undefined
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      capturedCallback = callback
      return vi.fn() // unsubscribe
    })
    mockGetRedirectResult.mockResolvedValue(null)

    const { result } = renderHook(() => useAuthUser())
    expect(result.current.loading).toBe(true)
    expect(result.current.user).toBeNull()

    act(() => {
      capturedCallback?.({ displayName: 'דוד' } as User)
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user?.displayName).toBe('דוד')
  })

  it('resolves loading to signed-out when onAuthStateChanged reports null', async () => {
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null)
      return vi.fn()
    })
    mockGetRedirectResult.mockResolvedValue(null)

    const { result } = renderHook(() => useAuthUser())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('surfaces a failed redirect without blocking loading on it', async () => {
    // getRedirectResult rejecting must not stop onAuthStateChanged from
    // resolving loading - a host who cancelled sign-in should still see the
    // sign-in button again, not a stuck spinner.
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null)
      return vi.fn()
    })
    mockGetRedirectResult.mockRejectedValue(
      new Error('auth/account-exists-with-different-credential'),
    )

    const { result } = renderHook(() => useAuthUser())

    await waitFor(() => expect(result.current.redirectError).not.toBeNull())
    expect(result.current.loading).toBe(false)
  })
})
