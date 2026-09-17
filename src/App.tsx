import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Gathering from './Gathering'
import { signInAsGuest, signInWithGoogle, signOutUser, useAuthUser } from './lib/auth'
import { db } from './lib/firebase'
import { paths } from './lib/model'
import { createRoom, joinRoom, leaveRoom, resolveRoomCode, setPlayerEmoji } from './lib/room'
import { saveUserProfile, useUserProfile } from './lib/profile'
import {
  addCustomQuestion,
  deleteCustomQuestion,
  useCustomQuestions,
} from './lib/profileQuestions'
import type { QuestionKind } from './lib/model'
import GroupDetails from './GroupDetails'
import RoomPicker from './RoomPicker'
import EmojiPicker from './EmojiPicker'
import { useAction } from './lib/useAction'

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

function clearStoredSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Best-effort - a refresh will resume the old room, which is the same
    // failure mode as storeSession's, not a new one.
  }
}

const CODE_PATTERN = /^\d{4}$/

/** A join link is `/join/<code>`, with `?code=<code>` as a fallback for
 *  anything that mangles the path (DESIGN.md: QR is the fallback channel;
 *  this is the equivalent fallback at the URL level). Both forms are
 *  validated the same way - an unvalidated `?code=` value used to reach
 *  `paths.roomCode()` and fail inside the Firestore SDK instead of here. */
function readJoinCodeFromUrl(): string | null {
  const fromPath = /^\/join\/(\d{4})$/.exec(window.location.pathname)
  if (fromPath) return fromPath[1]
  const fromQuery = new URLSearchParams(window.location.search).get('code')
  return fromQuery && CODE_PATTERN.test(fromQuery) ? fromQuery : null
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'host-landing' }
  | { kind: 'guest-name-entry'; sessionId: string; roomCode: string }
  | { kind: 'in-room'; sessionId: string; roomCode: string; uid: string; isHost: boolean }
  | { kind: 'error'; message: string; detail?: string }

/** Shared by the join-link effect and the typed-code flow below: once a code
 *  has resolved to a session, both paths decide the same way between resuming
 *  a room this browser already joined and asking a first-timer for a name. */
async function resolveJoinScreen(sessionId: string, roomCode: string, uid: string): Promise<Screen> {
  const stored = readStoredSession()
  if (stored?.sessionId === sessionId) {
    // Tapping your own share link (or retyping its code) is a real thing
    // hosts do, to check it works - this must not demote them to a guest in
    // their own room, which is what a hardcoded `isHost: false` here used to do.
    const sessionSnap = await getDoc(doc(db, paths.session(sessionId)))
    return {
      kind: 'in-room',
      sessionId,
      roomCode,
      uid,
      isHost: sessionSnap.data()?.hostUid === uid,
    }
  }
  return { kind: 'guest-name-entry', sessionId, roomCode }
}

/** The friendly message is for the person; `detail` is the technical cause,
 *  shown small underneath. A failure on a phone has no console to open, so an
 *  error that does not say what went wrong cannot be diagnosed at all - which
 *  is exactly how this screen's first version wasted a debugging round. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** How long `loading` may sit with no explanation before offering a way out.
 *  Below this, a normal load just looks instant; above it, a stuck load used
 *  to look identical to a slow one, with nothing on screen to tell them apart
 *  and no way forward either way. */
const LOADING_TIMEOUT_MS = 8_000

export default function App() {
  const { t } = useTranslation()
  const { user, loading: authLoading, redirectError } = useAuthUser()
  // Anonymous users get nothing here - the store this reads is per registered
  // account, and a guest's uid is a new one every gathering anyway (see
  // matchName in memory.ts).
  const profile = useUserProfile(user && !user.isAnonymous ? user.uid : null)
  const customQuestions = useCustomQuestions(user && !user.isAnonymous ? user.uid : null)
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [loadingIsSlow, setLoadingIsSlow] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  // A group's details take over the whole landing screen rather than replacing
  // part of it. They used to be rendered from inside the saved-groups list, so
  // the sign-out button and the "got a room code?" field stayed visible
  // underneath - two controls that have nothing to do with the group being
  // inspected, one of which throws away the session.
  const [detailsOf, setDetailsOf] = useState<string | null>(null)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [editingQuestions, setEditingQuestions] = useState(false)
  const [joinEmoji, setJoinEmoji] = useState<string | null>(null)

  useEffect(() => {
    if (screen.kind !== 'loading') {
      setLoadingIsSlow(false)
      return
    }
    const timer = setTimeout(() => setLoadingIsSlow(true), LOADING_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [screen.kind])

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
          const nextScreen = await resolveJoinScreen(sessionId, joinCode, uid)
          if (cancelled) return
          setScreen(nextScreen)
        } catch (error) {
          console.error('[FlashPlay] resolving the join link failed:', error)
          if (!cancelled) {
            const message = detailOf(error) === 'room-expired' ? t('roomExpired') : t('roomNotFound')
            setScreen({ kind: 'error', message, detail: detailOf(error) })
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

  async function handleCreateRoom(groupId: string | null = null) {
    if (!user) return
    setBusy(true)
    try {
      const { sessionId, roomCode } = await createRoom(
        db,
        user.uid,
        undefined,
        groupId,
        customQuestions.questions,
      )
      // Falls back to a generic label, never the email - the roster is
      // visible to every guest, and an email address has no business in it.
      await joinRoom(
        db,
        sessionId,
        user.uid,
        profile.displayName.trim() || user.displayName || t('hostFallbackName'),
      )
      if (profile.emoji) {
        // Best-effort, same as touchPresence: a cosmetic write failing here
        // must not undo an otherwise successful join.
        await setPlayerEmoji(db, sessionId, user.uid, profile.emoji).catch((error: unknown) => {
          console.error('[FlashPlay] applying the saved emoji failed:', error)
        })
      }
      storeSession({ sessionId, roomCode })
      setScreen({ kind: 'in-room', sessionId, roomCode, uid: user.uid, isHost: true })
    } catch (error) {
      console.error('[FlashPlay] createRoom failed:', error)
      setScreen({ kind: 'error', message: t('createRoomError'), detail: detailOf(error) })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Forgets this browser's room and marks the player doc left, so the roster
   * can say so - the game itself is otherwise untouched, matching DESIGN's
   * "leaving is allowed at any moment, an active round is never broken."
   * There was no way to do this at all before the first version of this fix:
   * a stored session resumes forever, with no screen that ever clears it -
   * found during the first manual walkthrough, on a browser still holding a
   * session from an earlier test. The confirmation step and the `leftAt`
   * write were added after Nitzan's own first manual walkthrough of *this*
   * fix: leaving needs a step back for a mis-tap, and the room looked exactly
   * as stale to everyone else as it had to him, just for a different reason -
   * nothing ever recorded that a player had gone.
   */
  async function confirmLeaveRoom(sessionId: string, uid: string) {
    try {
      await leaveRoom(db, sessionId, uid)
    } catch (error) {
      // Best-effort, same reasoning as storeSession/clearStoredSession below:
      // forgetting the room locally must not be blocked by a flaky write that
      // only updates how this player looks to everyone else's roster.
      console.error('[FlashPlay] leaveRoom failed:', error)
    }
    clearStoredSession()
    window.history.pushState({}, '', '/')
    setConfirmingLeave(false)
    setScreen({ kind: 'host-landing' })
  }

  async function handleJoinByCode() {
    const code = codeInput.trim()
    if (!CODE_PATTERN.test(code)) {
      setCodeError(t('codeNotFound'))
      return
    }
    setCodeBusy(true)
    setCodeError(null)
    try {
      const uid = user?.uid ?? (await signInAsGuest())
      const sessionId = await resolveRoomCode(db, code)
      setScreen(await resolveJoinScreen(sessionId, code, uid))
    } catch (error) {
      console.error('[FlashPlay] joining by typed code failed:', error)
      // Its own wording, not roomNotFound/roomExpired: those say "the LINK
      // may no longer be valid", which makes no sense for a code someone
      // typed by hand. Found in Nitzan's own play session, 2026-09-16.
      setCodeError(detailOf(error) === 'room-expired' ? t('codeExpired') : t('codeNotFound'))
    } finally {
      setCodeBusy(false)
    }
  }

  async function handleJoin(sessionId: string, roomCode: string) {
    const name = nameInput.trim()
    if (!name) return
    setBusy(true)
    setNameError(null)
    try {
      const uid = user?.uid ?? (await signInAsGuest())
      await joinRoom(db, sessionId, uid, name)
      if (joinEmoji) {
        await setPlayerEmoji(db, sessionId, uid, joinEmoji).catch((error: unknown) => {
          console.error('[FlashPlay] applying the chosen emoji failed:', error)
        })
      }
      storeSession({ sessionId, roomCode })
      setScreen({ kind: 'in-room', sessionId, roomCode, uid, isHost: false })
    } catch (error) {
      console.error('[FlashPlay] joinRoom failed:', error)
      // A taken name is "pick a different one", not "something is broken" -
      // shown inline so the same name-entry form can be resubmitted, rather
      // than wiping the whole screen the way an unrecoverable join failure
      // does. Found in Nitzan's own play session: two players who both typed
      // "אלה" (one having left and rejoined under a new identity) made every
      // reveal and the scoreboard ambiguous about which one was meant.
      if (detailOf(error) === 'name-taken') {
        setNameError(t('nameTaken'))
      } else {
        setScreen({ kind: 'error', message: t('joinError'), detail: detailOf(error) })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-black text-accent drop-shadow-[0_0_18px_rgba(255,46,154,0.6)]">
        {t('appName')}
      </h1>
      <p className="text-muted">{t('tagline')}</p>

      {redirectError && (
        <p role="alert" className="text-danger">
          {t('signInError')}
        </p>
      )}

      {screen.kind === 'loading' && (
        <div className="flex flex-col items-center gap-2">
          <p>{t('loading')}</p>
          {loadingIsSlow && (
            <>
              <p className="text-sm text-muted">{t('loadingSlow')}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="cursor-pointer rounded-xl border border-accent-2 px-4 py-2 text-accent-2"
              >
                {t('retryButton')}
              </button>
            </>
          )}
        </div>
      )}

      {screen.kind === 'error' && (
        <div role="alert" className="flex flex-col items-center gap-2">
          <p className="text-danger">{screen.message}</p>
          {screen.detail && (
            <p dir="ltr" className="font-mono text-xs text-muted">
              {screen.detail}
            </p>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="cursor-pointer rounded-xl border border-accent-2 px-4 py-2 text-accent-2"
          >
            {t('retryButton')}
          </button>
        </div>
      )}

      {screen.kind === 'host-landing' &&
        // Anonymous counts as "not really signed in" here: it is a guest
        // identity, minted only so the rules have a subject to authorise a
        // join against (see signInAsGuest's comment), and isRegistered() in
        // firestore.rules refuses it as a host. Before this check, a guest
        // who left a room landed on this exact screen with `user` truthy and
        // fell into this branch: a "sign out" button for an account they
        // never signed in to, and a "create room" button whose write
        // firestore.rules was always going to refuse - surfacing as a bare
        // permission-denied error instead of the plain "you need to sign in"
        // this screen means to say. Found in Nitzan's own manual walkthrough.
        (user && !user.isAnonymous ? (
          detailsOf ? (
            /* The details screen owns the landing page while it is open -
               nothing else renders alongside it. */
            <GroupDetails
              hostUid={user.uid}
              groupId={detailsOf}
              onClose={() => setDetailsOf(null)}
              onOpenRoom={() => void handleCreateRoom(detailsOf)}
              onDeleted={() => setDetailsOf(null)}
            />
          ) : (
            <div className="flex w-full max-w-sm flex-col items-center gap-3">
              <p>
                {profile.emoji && <span className="me-1">{profile.emoji}</span>}
                {t('greeting', { name: user.displayName ?? user.email })}
              </p>

              {editingProfile ? (
                <ProfileEditor
                  uid={user.uid}
                  fallbackName={user.displayName ?? ''}
                  profile={profile}
                  onDone={() => setEditingProfile(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingProfile(true)}
                  className="cursor-pointer text-xs text-accent-2 underline decoration-dotted underline-offset-4"
                >
                  {t('editProfileButton')}
                </button>
              )}

              {editingQuestions ? (
                <CustomQuestionsEditor
                  uid={user.uid}
                  questions={customQuestions.questions}
                  onDone={() => setEditingQuestions(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingQuestions(true)}
                  className="cursor-pointer text-xs text-accent-2 underline decoration-dotted underline-offset-4"
                >
                  {t('editCustomQuestionsButton')}
                </button>
              )}

              {/* A gathering opened for a group the host has saved adds to that
                  group's memory at the end instead of starting a second copy of
                  the same family (milestone 7). */}
              <RoomPicker
                hostUid={user.uid}
                busy={busy}
                onOpenRoom={(groupId) => void handleCreateRoom(groupId)}
                onShowDetails={setDetailsOf}
              />

              {/* A registered host can also be handed someone else's room code
                  (a different family's gathering) - the review that found this
                  fix's other gaps flagged that the code input had only been
                  added to the signed-out branch, leaving a signed-in host with
                  no way to use a typed code at all. */}
              <JoinByCode
                codeInput={codeInput}
                setCodeInput={setCodeInput}
                busy={codeBusy}
                error={codeError}
                onSubmit={() => void handleJoinByCode()}
                bordered
              />

              {/* Signing out is not destructive, but it is one tap from
                  losing a half-set-up evening and it sits under the same
                  thumb as everything else here. */}
              {confirmingSignOut ? (
                <div className="flex w-full flex-col items-center gap-2 border-t border-line pt-4">
                  <p className="text-sm">{t('signOutConfirm')}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void signOutUser()}
                      className="cursor-pointer rounded-xl border border-danger/50 px-4 py-2 text-sm text-danger"
                    >
                      {t('signOutYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingSignOut(false)}
                      className="cursor-pointer rounded-xl px-4 py-2 text-sm text-muted"
                    >
                      {t('signOutNo')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingSignOut(true)}
                  className="cursor-pointer text-sm text-muted underline decoration-dotted underline-offset-4"
                >
                  {t('signOut')}
                </button>
              )}
            </div>
          )
        ) : (
          <div className="flex w-full max-w-sm flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="cursor-pointer rounded-xl bg-accent px-4 py-2 font-semibold text-white shadow-[0_0_18px_rgba(255,46,154,0.5)]"
            >
              {t('signInWithGoogle')}
            </button>

            {/* The typed-code counterpart to the join link: `roomCodes` and
                `resolveRoomCode` exist precisely to turn a typed code into a
                session (see DECISIONS.md, "the room code stopped being the
                session's document id"), but until this fix nothing in the UI
                ever called it except by parsing a `/join/<code>` URL - a
                4-digit code with nowhere to type it. Found alongside the
                anonymous-landing bug above, same manual walkthrough. */}
            <JoinByCode
              codeInput={codeInput}
              setCodeInput={setCodeInput}
              busy={codeBusy}
              error={codeError}
              onSubmit={() => void handleJoinByCode()}
              bordered
            />
          </div>
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
            onChange={(event) => {
              setNameInput(event.target.value)
              setNameError(null)
            }}
            placeholder={t('yourNamePlaceholder')}
            // A pasted or joke name with no bound would overflow the roster
            // on every phone in the room - see Lobby.tsx's truncate class,
            // which handles the rest of it.
            maxLength={40}
            enterKeyHint="done"
            className="rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
            autoFocus
          />
          {nameError && (
            <p role="alert" className="text-xs text-danger">
              {nameError}
            </p>
          )}
          <EmojiPicker value={joinEmoji} onChange={setJoinEmoji} label={t('pickEmojiLabel')} />
          <button
            type="submit"
            disabled={busy || !nameInput.trim()}
            className="cursor-pointer rounded-xl bg-accent px-4 py-2 font-semibold text-white shadow-[0_0_18px_rgba(255,46,154,0.5)] disabled:opacity-50"
          >
            {busy ? t('joining') : t('joinButton')}
          </button>
        </form>
      )}

      {screen.kind === 'in-room' && (
        <>
          <Gathering
            sessionId={screen.sessionId}
            roomCode={screen.roomCode}
            uid={screen.uid}
            isHost={screen.isHost}
          />
          {/* Deliberately quiet, and deliberately not a bare underlined link:
              leaving is a real action that deserves a real control, but it
              must never compete with the host's game buttons for attention.
              Asked for directly - "כפתור היציאה מהחדר לא הכי נחמד". */}
          {confirmingLeave ? (
            <div className="mt-2 flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-danger/40 bg-surface/80 p-4">
              <p className="text-sm font-medium">{t('leaveRoomConfirmQuestion')}</p>
              <div className="flex w-full items-center gap-2">
                <button
                  type="button"
                  onClick={() => void confirmLeaveRoom(screen.sessionId, screen.uid)}
                  className="grow cursor-pointer rounded-xl bg-danger/15 px-3 py-2 text-sm font-medium text-danger"
                >
                  {t('leaveRoomConfirmYes')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingLeave(false)}
                  className="grow cursor-pointer rounded-xl border border-line px-3 py-2 text-sm text-muted"
                >
                  {t('leaveRoomConfirmNo')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingLeave(true)}
              className="mt-2 cursor-pointer rounded-full border border-line px-4 py-1.5 text-xs text-muted"
            >
              {t('leaveRoom')}
            </button>
          )}
        </>
      )}
    </main>
  )
}

/**
 * The registered host's own default name and emoji - saved once, offered on
 * every future join (see handleCreateRoom, which applies `profile.emoji`
 * without asking again). Google's own name is the fallback the field starts
 * from, not a value this screen can lose: leaving the field untouched and
 * saving keeps using it, since `saveUserProfile` writes exactly what is on
 * screen.
 */
function ProfileEditor({
  uid,
  fallbackName,
  profile,
  onDone,
}: {
  uid: string
  fallbackName: string
  profile: { displayName: string; emoji: string | null }
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(profile.displayName || fallbackName)
  const [emoji, setEmoji] = useState(profile.emoji)
  const save = useAction()
  const [saved, setSaved] = useState(false)

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/40 p-3">
      <input
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setSaved(false)
        }}
        placeholder={t('profileNamePlaceholder')}
        maxLength={40}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
      />
      <EmojiPicker
        value={emoji}
        onChange={(value) => {
          setEmoji(value)
          setSaved(false)
        }}
        label={t('pickEmojiLabel')}
      />
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          disabled={save.busy || !name.trim()}
          onClick={() =>
            void save.run(async () => {
              await saveUserProfile(db, uid, { displayName: name.trim(), emoji })
              setSaved(true)
            })
          }
          className="grow cursor-pointer rounded-xl border border-accent-2 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
        >
          {save.busy ? t('savingProfile') : t('saveProfile')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded-xl px-3 py-2 text-sm text-muted"
        >
          {t('addGroupCancel')}
        </button>
      </div>
      {saved && <p className="text-xs text-accent-3">{t('profileSaved')}</p>}
      {save.error && (
        <p role="alert" className="text-xs text-danger">
          {t('profileSaveError')}{' '}
          <span dir="ltr" className="font-mono">
            ({save.error})
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * The host's own question bank - milestone 8's "questions the host chooses
 * themselves, with answers", persisted so it is offered again in every future
 * gathering (see `SessionDoc.customQuestions`, taken as a snapshot at
 * `createRoom` time). Add and delete only, deliberately - editing an existing
 * question is left out of this first pass, and deleting and re-adding covers
 * the rare case of a genuine mistake.
 */
function CustomQuestionsEditor({
  uid,
  questions,
  onDone,
}: {
  uid: string
  questions: { id: string; text: string; kind: QuestionKind; options?: string[] }[]
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [kind, setKind] = useState<QuestionKind>('text')
  const [optionsInput, setOptionsInput] = useState('')
  const add = useAction()
  const remove = useAction()

  const options = optionsInput
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/40 p-3">
      {questions.length > 0 && (
        <ul className="flex w-full flex-col gap-1">
          {questions.map((question) => (
            <li
              key={question.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface/60 px-2 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate text-start">{question.text}</span>
              <button
                type="button"
                disabled={remove.busy}
                onClick={() => void remove.run(() => deleteCustomQuestion(db, uid, question.id))}
                className="shrink-0 cursor-pointer text-xs text-danger disabled:opacity-50"
              >
                {t('deleteFact')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('customQuestionTextPlaceholder')}
        maxLength={120}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted"
      />
      <select
        value={kind}
        onChange={(event) => setKind(event.target.value as QuestionKind)}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink"
      >
        <option value="text">{t('questionKindText')}</option>
        <option value="single-choice">{t('questionKindSingleChoice')}</option>
        <option value="multi-choice">{t('questionKindMultiChoice')}</option>
      </select>
      {kind !== 'text' && (
        <input
          value={optionsInput}
          onChange={(event) => setOptionsInput(event.target.value)}
          placeholder={t('customQuestionOptionsPlaceholder')}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted"
        />
      )}

      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          disabled={add.busy || !text.trim() || (kind !== 'text' && options.length < 2)}
          onClick={() =>
            void add.run(async () => {
              await addCustomQuestion(db, uid, {
                text: text.trim(),
                kind,
                ...(kind !== 'text' && { options }),
              })
              setText('')
              setOptionsInput('')
            })
          }
          className="grow cursor-pointer rounded-xl border border-accent-2 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
        >
          {add.busy ? t('savingProfile') : t('addCustomQuestion')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded-xl px-3 py-2 text-sm text-muted"
        >
          {t('backButton')}
        </button>
      </div>
      {(add.error ?? remove.error) && (
        <p role="alert" className="text-xs text-danger">
          {t('customQuestionSaveError')}{' '}
          <span dir="ltr" className="font-mono">
            ({add.error ?? remove.error})
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * The typed-code counterpart to the join link, shared by both the signed-out
 * and the signed-in-host branches of the landing screen so a room code works
 * the same way regardless of who is holding it.
 */
function JoinByCode({
  codeInput,
  setCodeInput,
  busy,
  error,
  onSubmit,
  bordered = false,
}: {
  codeInput: string
  setCodeInput: (value: string) => void
  busy: boolean
  error: string | null
  onSubmit: () => void
  bordered?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={
        bordered
          ? 'flex w-full flex-col items-center gap-2 border-t border-line pt-4'
          : 'flex w-full flex-col items-center gap-2'
      }
    >
      <label htmlFor="room-code-input" className="text-sm text-muted">
        {t('haveCodeIntro')}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="room-code-input"
          value={codeInput}
          onChange={(event) => setCodeInput(event.target.value)}
          placeholder={t('roomCodePlaceholder')}
          maxLength={4}
          inputMode="numeric"
          className="w-24 rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !CODE_PATTERN.test(codeInput.trim())}
          className="cursor-pointer rounded-xl border border-accent-2 px-4 py-2 text-accent-2 disabled:opacity-50"
        >
          {busy ? t('joining') : t('joinByCode')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

