import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Lobby from './Lobby'
import { signInAsGuest, signInWithGoogle, signOutUser, useAuthUser } from './lib/auth'
import { db } from './lib/firebase'
import { paths } from './lib/model'
import { createRoom, joinRoom, resolveRoomCode } from './lib/room'

const STORAGE_KEY = 'flashplay.session'

interface StoredSession {
  sessionId: string
  roomCode: string
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function storeSession(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Best-effort only - failing to persist means a refresh won't resume the
    // room automatically, not that joining itself failed.
  }
}

/** A join link is `/join/<code>`, with `?code=<code>` as a fallback for
 *  anything that mangles the path (DESIGN.md: QR is the fallback channel;
 *  this is the equivalent fallback at the URL level). */
function readJoinCodeFromUrl(): string | null {
  const fromPath = /^\/join\/(\d{4})$/.exec(window.location.pathname)
  if (fromPath) return fromPath[1]
  return new URLSearchParams(window.location.search).get('code')
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'host-landing' }
  | { kind: 'guest-name-entry'; sessionId: string; roomCode: string }
  | { kind: 'in-room'; sessionId: string; roomCode: string; uid: string; isHost: boolean }
  | { kind: 'error'; message: string; detail?: string }

/** The friendly message is for the person; `detail` is the technical cause,
 *  shown small underneath. A failure on a phone has no console to open, so an
 *  error that does not say what went wrong cannot be diagnosed at all - which
 *  is exactly how this screen's first version wasted a debugging round. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App() {
  const { t } = useTranslation()
  const { user, loading: authLoading, redirectError } = useAuthUser()
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const joinCode = useMemo(() => readJoinCodeFromUrl(), [])

  // A guest arriving on a join link has no identity yet, and EVERY rule -
  // including reading the room code itself - requires isSignedIn(). So the
  // anonymous sign-in has to happen before anything tries to read, not when
  // they submit their name: reading first is what broke the first live join
  // with "Missing or insufficient permissions".
  useEffect(() => {
    if (authLoading || user || !joinCode) return
    void signInAsGuest().catch((error: unknown) => {
      console.error('[FlashPlay] guest sign-in failed:', error)
      setScreen({ kind: 'error', message: t('joinError'), detail: detailOf(error) })
    })
  }, [authLoading, user, joinCode, t])

  // Decides what to show once auth state is known: joining by a link,
  // resuming a room this browser already joined, or the host landing page.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false

    async function resolveScreen() {
      if (joinCode) {
        // Wait for the sign-in above; this effect re-runs when it lands.
        if (!user) return
        const uid = user.uid
        try {
          const sessionId = await resolveRoomCode(db, joinCode)
          if (cancelled) return

          // Already joined this gathering? Answered from local state, never
          // by asking Firestore. Reading your own player document requires
          // isPlayer(), which is only true once that document exists - so a
          // first-time guest probing "am I already in?" is denied by the very
          // rule that protects the roster. That circularity is what broke the
          // first live join; see room.test.ts, which now pins it down.
          const stored = readStoredSession()
          if (stored?.sessionId === sessionId) {
            setScreen({ kind: 'in-room', sessionId, roomCode: joinCode, uid, isHost: false })
            return
          }

          setScreen({ kind: 'guest-name-entry', sessionId, roomCode: joinCode })
        } catch (error) {
          console.error('[FlashPlay] resolving the join link failed:', error)
          if (!cancelled) {
            setScreen({ kind: 'error', message: t('roomNotFound'), detail: detailOf(error) })
          }
        }
        return
      }

      const stored = readStoredSession()
      if (user && stored) {
        try {
          const [playerSnap, sessionSnap] = await Promise.all([
            getDoc(doc(db, paths.player(stored.sessionId, user.uid))),
            getDoc(doc(db, paths.session(stored.sessionId))),
          ])
          if (cancelled) return
          if (playerSnap.exists()) {
            setScreen({
              kind: 'in-room',
              sessionId: stored.sessionId,
              roomCode: stored.roomCode,
              uid: user.uid,
              isHost: sessionSnap.data()?.hostUid === user.uid,
            })
            return
          }
        } catch {
          // Falls through to the landing page - a stale or unreadable stored
          // session should not strand the user.
        }
      }
      if (!cancelled) setScreen({ kind: 'host-landing' })
    }

    void resolveScreen()
    return () => {
      cancelled = true
    }
  }, [authLoading, user, joinCode, t])

  async function handleCreateRoom() {
    if (!user) return
    setBusy(true)
    try {
      const { sessionId, roomCode } = await createRoom(db, user.uid)
      await joinRoom(db, sessionId, user.uid, user.displayName ?? user.email ?? t('appName'))
      storeSession({ sessionId, roomCode })
      setScreen({ kind: 'in-room', sessionId, roomCode, uid: user.uid, isHost: true })
    } catch (error) {
      console.error('[FlashPlay] createRoom failed:', error)
      setScreen({ kind: 'error', message: t('createRoomError'), detail: detailOf(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin(sessionId: string, roomCode: string) {
    const name = nameInput.trim()
    if (!name) return
    setBusy(true)
    try {
      const uid = user?.uid ?? (await signInAsGuest())
      await joinRoom(db, sessionId, uid, name)
      storeSession({ sessionId, roomCode })
      setScreen({ kind: 'in-room', sessionId, roomCode, uid, isHost: false })
    } catch (error) {
      console.error('[FlashPlay] joinRoom failed:', error)
      setScreen({ kind: 'error', message: t('joinError'), detail: detailOf(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold">{t('appName')}</h1>
      <p className="text-neutral-600">{t('tagline')}</p>

      {redirectError && (
        <p role="alert" className="text-red-600">
          {t('signInError')}
        </p>
      )}

      {screen.kind === 'loading' && <p>{t('loading')}</p>}

      {screen.kind === 'error' && (
        <div role="alert" className="flex flex-col items-center gap-1">
          <p className="text-red-600">{screen.message}</p>
          {screen.detail && (
            <p dir="ltr" className="font-mono text-xs text-neutral-500">
              {screen.detail}
            </p>
          )}
        </div>
      )}

      {screen.kind === 'host-landing' &&
        (user ? (
          <div className="flex flex-col items-center gap-2">
            <p>{t('greeting', { name: user.displayName ?? user.email })}</p>
            <button
              type="button"
              onClick={() => void handleCreateRoom()}
              disabled={busy}
              className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            >
              {busy ? t('creatingRoom') : t('createRoom')}
            </button>
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="cursor-pointer rounded-md border border-neutral-300 px-4 py-2"
            >
              {t('signOut')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-white"
          >
            {t('signInWithGoogle')}
          </button>
        ))}

      {screen.kind === 'guest-name-entry' && (
        <form
          className="flex flex-col items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void handleJoin(screen.sessionId, screen.roomCode)
          }}
        >
          <label htmlFor="guest-name">{t('yourNamePrompt')}</label>
          <input
            id="guest-name"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            placeholder={t('yourNamePlaceholder')}
            className="rounded-md border border-neutral-300 px-3 py-2 text-center"
            autoFocus
          />
          <button
            type="submit"
            disabled={busy || !nameInput.trim()}
            className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {busy ? t('joining') : t('joinButton')}
          </button>
        </form>
      )}

      {screen.kind === 'in-room' && (
        <Lobby
          sessionId={screen.sessionId}
          roomCode={screen.roomCode}
          uid={screen.uid}
          isHost={screen.isHost}
        />
      )}
    </main>
  )
}
