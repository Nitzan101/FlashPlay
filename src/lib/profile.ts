/**
 * The registered host's own default look - a display name override and an
 * emoji, offered on the landing screen and carried into the room they open.
 *
 * Lives at `users/{uid}` itself (not a subcollection), which every other
 * milestone 7 write already treats as owner-only in firestore.rules - this is
 * the first thing that actually reads or writes the document, `UserDoc` having
 * existed unused since milestone 2.
 */
import { doc, getDoc, onSnapshot, setDoc, type Firestore } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from './firebase'
import { errorCode } from './room'
import { paths, type UserDoc } from './model'

export interface UserProfile {
  displayName: string
  emoji: string | null
  loading: boolean
}

/** Live view of the host's own profile - null/empty until they have ever
 *  saved one, which is the ordinary first-time state, not an error. */
export function useUserProfile(uid: string | null): UserProfile {
  const [state, setState] = useState<UserProfile>({ displayName: '', emoji: null, loading: true })

  useEffect(() => {
    if (!uid) {
      setState({ displayName: '', emoji: null, loading: false })
      return
    }
    const unsubscribe = onSnapshot(
      doc(db, paths.user(uid)),
      (snap) => {
        const data = snap.data() as UserDoc | undefined
        setState({ displayName: data?.displayName ?? '', emoji: data?.emoji ?? null, loading: false })
      },
      (error) => {
        // Not surfaced as an error state: the editor falls back to empty
        // fields, and saving again from there is harmless - the same
        // reasoning useGroupName already uses for its own read failure.
        console.error('[FlashPlay] reading the user profile failed:', errorCode(error), error)
        setState({ displayName: '', emoji: null, loading: false })
      },
    )
    return unsubscribe
  }, [uid])

  return state
}

export async function saveUserProfile(
  firestore: Firestore,
  uid: string,
  profile: { displayName: string; emoji: string | null },
): Promise<void> {
  const existing = await getDoc(doc(firestore, paths.user(uid)))
  await setDoc(
    doc(firestore, paths.user(uid)),
    {
      ...profile,
      createdAt: (existing.data() as UserDoc | undefined)?.createdAt ?? Date.now(),
    } satisfies UserDoc,
  )
}
