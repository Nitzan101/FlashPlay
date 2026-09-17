/**
 * Guided questions - milestone 8. Two halves live here: a host's own
 * persisted question bank (`useCustomQuestions`/`addCustomQuestion`/
 * `deleteCustomQuestion`, under their own account), and a player's answers
 * within one gathering (`saveProfileAnswer`/`useMyProfileAnswers`). Turning an
 * answered question into a private `FactDoc` is `writeProfileFacts`, in
 * `memory.ts` alongside the party games' own fact-writing - this file is the
 * question mechanism, `memory.ts` is the store it feeds.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from './firebase'
import { errorCode, step } from './room'
import { paths, type CustomQuestionDoc, type ProfileAnswerDoc, type ProfileQuestion } from './model'

// --- A host's own question bank, reused across every gathering they open ----

export interface CustomQuestionsState {
  questions: ProfileQuestion[]
  loading: boolean
  error: string | null
}

export function useCustomQuestions(hostUid: string | null): CustomQuestionsState {
  const [state, setState] = useState<CustomQuestionsState>({
    questions: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!hostUid) {
      setState({ questions: [], loading: false, error: null })
      return
    }
    setState({ questions: [], loading: true, error: null })
    const unsubscribe = onSnapshot(
      collection(db, paths.customQuestions(hostUid)),
      (snap) => {
        const questions = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as CustomQuestionDoc) }))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map(({ id, text, kind, options }) => ({ id, text, kind, options }))
        setState({ questions, loading: false, error: null })
      },
      (error) => {
        console.error('[FlashPlay] custom questions listener failed:', errorCode(error), error)
        setState((prev) => ({ ...prev, loading: false, error: errorCode(error) }))
      },
    )
    return unsubscribe
  }, [hostUid])

  return state
}

export async function addCustomQuestion(
  firestore: Firestore,
  hostUid: string,
  question: { text: string; kind: ProfileQuestion['kind']; options?: string[] },
): Promise<void> {
  const id = crypto.randomUUID()
  await step('add-custom-question', () =>
    setDoc(doc(firestore, paths.customQuestion(hostUid, id)), {
      ...question,
      createdAt: Date.now(),
    } satisfies CustomQuestionDoc),
  )
}

export async function deleteCustomQuestion(
  firestore: Firestore,
  hostUid: string,
  id: string,
): Promise<void> {
  await step('delete-custom-question', () =>
    deleteDoc(doc(firestore, paths.customQuestion(hostUid, id))),
  )
}

/** A one-off read of the host's current bank, for `createRoom`'s snapshot into
 *  `SessionDoc.customQuestions` - a listener would be the wrong tool for a
 *  value read exactly once at room creation. */
export async function readCustomQuestions(
  firestore: Firestore,
  hostUid: string,
): Promise<ProfileQuestion[]> {
  const snap = await getDocs(collection(firestore, paths.customQuestions(hostUid)))
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as CustomQuestionDoc) }))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ id, text, kind, options }) => ({ id, text, kind, options }))
}

// --- A player's own answers within one gathering ----------------------------

/** Editable at any time by its own author - see the module comment on
 *  `ProfileAnswerDoc` for why. `answer` empty (`''` or `[]`) is treated the
 *  same as "never answered" by the collector, so clearing a text field and
 *  saving is a legitimate way to retract an answer rather than a value that
 *  gets written as an empty fact. */
export async function saveProfileAnswer(
  firestore: Firestore,
  sessionId: string,
  uid: string,
  questionId: string,
  answer: string | string[],
): Promise<void> {
  await step('save-profile-answer', () =>
    setDoc(doc(firestore, paths.profileAnswer(sessionId, uid, questionId)), {
      questionId,
      answer,
      updatedAt: Date.now(),
    } satisfies ProfileAnswerDoc),
  )
}

/**
 * The signed-in player's own answers to a known list of questions, keyed by
 * question id - read once on mount to prefill the lobby's form, not a live
 * listener: nobody else can see these regardless, and the form is the only
 * thing that changes them.
 */
export function useMyProfileAnswers(
  sessionId: string,
  uid: string,
  questionIds: string[],
): { answers: Record<string, string | string[]>; loading: boolean } {
  const [state, setState] = useState<{
    answers: Record<string, string | string[]>
    loading: boolean
  }>({ answers: {}, loading: true })

  // questionIds is derived fresh every render from the built-ins plus the
  // session doc - a new array literal with the same actual contents every
  // time. Joined into one string and re-split inside the effect so the only
  // thing the effect closes over is that string, which is what keeps it from
  // re-running on every render despite the identity change.
  const key = questionIds.join(',')

  useEffect(() => {
    let cancelled = false
    const ids = key ? key.split(',') : []
    void Promise.all(
      ids.map(async (id) => {
        const snap = await getDoc(doc(db, paths.profileAnswer(sessionId, uid, id)))
        const data = snap.data() as ProfileAnswerDoc | undefined
        return [id, data?.answer] as const
      }),
    )
      .then((pairs) => {
        if (cancelled) return
        const answers: Record<string, string | string[]> = {}
        for (const [id, answer] of pairs) if (answer !== undefined) answers[id] = answer
        setState({ answers, loading: false })
      })
      .catch((error: unknown) => {
        console.error('[FlashPlay] reading profile answers failed:', errorCode(error), error)
        if (!cancelled) setState({ answers: {}, loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, uid, key])

  return state
}
