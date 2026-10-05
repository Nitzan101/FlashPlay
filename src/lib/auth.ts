import {
  GoogleAuthProvider,
  getRedirectResult,
  linkWithRedirect,
  onAuthStateChanged,
  signInAnonymously,
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

/**
 * Upgrades the current anonymous guest to a Google account IN PLACE: the uid
 * is kept, so the guest's player document and room membership survive the
 * round trip. Redirect, for the same reason as above. If the Google account
 * already belongs to another uid the redirect comes back with
 * `auth/credential-already-in-use` and the guest simply stays anonymous - see
 * DECISIONS.md, "Guests can sign in to be remembered".
 */
export function linkGuestWithGoogle(): Promise<void> {
  const current = auth.currentUser
  if (!current || !current.isAnonymous) return Promise.reject(new Error('not-a-guest'))
  return linkWithRedirect(current, googleProvider)
}

export function signOutUser(): Promise<void> {
  return signOut(auth)
}

/**
 * A guest "enters with a name only and is never blocked" (DESIGN.md,
 * "Identity and data"). Anonymous sign-in is what gives them a uid for the
 * security rules to authorise against - see firestore.rules, isRegistered().
 * Resolves to the signed-in user's uid.
 */
export async function signInAsGuest(): Promise<string> {
  const credential = await signInAnonymously(auth)
  return credential.user.uid
}

export interface AuthState {
  user: User | null
  /** True until the initial auth state (including a pending redirect) is known. */
  loading: boolean
  /** Set if the redirect sign-in itself failed - e.g. account-exists-with-different-credential. */
  redirectError: Error | null
  /** Bumped when a redirect finished linking a guest to a real account. The
   *  `User` object is the same instance before and after (its `isAnonymous`
   *  just flips), so React cannot see the change by itself. Optional so test
   *  doubles for this hook need not set it. */
  upgradedAt?: number
}

export function useAuthUser(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [redirectError, setRedirectError] = useState<Error | null>(null)
  const [upgradedAt, setUpgradedAt] = useState(0)

  useEffect(() => {
    // Surfaces errors from a just-completed redirect sign-in. The signed-in
    // user itself arrives through onAuthStateChanged below regardless of
    // whether this promise has resolved yet.
    getRedirectResult(auth)
      .then(async (result) => {
        // A completed link (as opposed to a plain sign-in): the same user, now
        // non-anonymous. Its ID token still carries the anonymous provider
        // claim until refreshed, and firestore.rules reads that claim.
        if (result && result.operationType === 'link') {
          await result.user.getIdToken(true)
          setUpgradedAt(Date.now())
        }
      })
      .catch((error: Error) => {
        setRedirectError(error)
      })

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })

    return unsubscribe
  }, [])

  return { user, loading, redirectError, upgradedAt }
}
