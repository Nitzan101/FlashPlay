import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'
import { useEffect, useState } from 'react'
import { auth } from './firebase'

const googleProvider = new GoogleAuthProvider()

/**
 * Redirect, not popup. Mobile browsers block popups, which silently breaks
 * sign-in on exactly the devices this app targets - see DESIGN, "platform
 * reality". signInWithRedirect navigates away from the page; the result is
 * picked up by getRedirectResult()/onAuthStateChanged in useAuthUser below
 * once the browser returns here.
 */
export function signInWithGoogle(): Promise<void> {
  return signInWithRedirect(auth, googleProvider)
}

export function signOutUser(): Promise<void> {
  return signOut(auth)
}

export interface AuthState {
  user: User | null
  /** True until the initial auth state (including a pending redirect) is known. */
  loading: boolean
  /** Set if the redirect sign-in itself failed - e.g. account-exists-with-different-credential. */
  redirectError: Error | null
}

export function useAuthUser(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [redirectError, setRedirectError] = useState<Error | null>(null)

  useEffect(() => {
    // Surfaces errors from a just-completed redirect sign-in. The signed-in
    // user itself arrives through onAuthStateChanged below regardless of
    // whether this promise has resolved yet.
    getRedirectResult(auth).catch((error: Error) => {
      setRedirectError(error)
    })

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })

    return unsubscribe
  }, [])

  return { user, loading, redirectError }
}
