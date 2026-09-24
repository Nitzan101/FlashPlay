import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Gathering from './Gathering'
import { signInAsGuest, signInWithGoogle, signOutUser, useAuthUser } from './lib/auth'
import { db } from './lib/firebase'
import { paths } from './lib/model'
import {
  createRoom,
  errorCode,
  joinRoom,
  leaveRoom,
  resolveRoomCode,
  setPlayerEmoji,
  transferHost,
  useRoster,
  useSession,
} from './lib/room'
import {
  ensureContacts,
  importSharedGroup,
  nameGroup,
  useGroupName,
  writeProfileFacts,
  writeRemainingFacts,
} from './lib/memory'
import { endGathering } from './lib/secondGame'
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
import { PROFILE_QUESTIONS } from './content/profileQuestions'
import { useAction } from './lib/useAction'
import { HelpButton, useScreenTour } from './Tutorial'

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

/** A shared-group link is `/share/<uuid>` - the handing-over half of
 *  `shareGroup`/`importSharedGroup`. Validated to the shape a uuid actually
 *  has rather than passed through raw, for the same reason `?code=` is: an
 *  unvalidated value reaching a Firestore path fails inside the SDK instead
 *  of here, where it can be explained. */
function readShareIdFromUrl(): string | null {
  const fromPath = /^\/share\/([0-9a-fA-F-]{36})$/.exec(window.location.pathname)
  if (fromPath) return fromPath[1]
  const fromQuery = new URLSearchParams(window.location.search).get('share')
  return fromQuery && /^[0-9a-fA-F-]{36}$/.test(fromQuery) ? fromQuery : null
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
  // Read here, one level above Gathering, purely for the leave-room control
  // below: whether this viewer can currently close or transfer the room, and
  // who else is in it to transfer to. Gathering.tsx keeps its own identical
  // listeners for the screens it routes between - a second subscription to
  // the same two documents, not a shared one, the same way useRoster is
  // already called independently in more than one place in this app.
  const inRoomSessionId = screen.kind === 'in-room' ? screen.sessionId : null
  const { session: liveSession } = useSession(inRoomSessionId)
  const { players: liveRoster } = useRoster(inRoomSessionId)
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [loadingIsSlow, setLoadingIsSlow] = useState(false)
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
  useScreenTour(
    screen.kind === 'host-landing' && !detailsOf && !editingProfile && !editingQuestions
      ? user && !user.isAnonymous
        ? 'home'
        : 'welcome'
      : null,
  )

  useEffect(() => {
    if (screen.kind !== 'loading') {
      setLoadingIsSlow(false)
      return
    }
    const timer = setTimeout(() => setLoadingIsSlow(true), LOADING_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [screen.kind])

  const joinCode = useMemo(() => readJoinCodeFromUrl(), [])
  const shareId = useMemo(() => readShareIdFromUrl(), [])

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
   * Forgets this browser's room, so the local state matches "not in a room"
   * regardless of whether the roster write below succeeds - this is called
   * both for an ordinary leave and after a host closes or transfers the room,
   * see `LeaveRoomControl`. There was no way to do this at all before the
   * first version of this fix: a stored session resumes forever, with no
   * screen that ever clears it - found during the first manual walkthrough,
   * on a browser still holding a session from an earlier test.
   */
  function goHomeAfterLeaving(openDetailsForGroupId?: string) {
    clearStoredSession()
    window.history.pushState({}, '', '/')
    setScreen({ kind: 'host-landing' })
    // Right after naming a group in the leave flow, the host may have asked
    // to view/edit it immediately rather than finding it later from the room
    // picker - see LeaveRoomControl's 'group-saved' stage.
    if (openDetailsForGroupId) setDetailsOf(openDetailsForGroupId)
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
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <HelpButton />
      <h1 className="font-display text-3xl font-bold text-accent drop-shadow-glow">
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
                className="cursor-pointer rounded-full bg-accent-2/15 px-4 py-2 text-accent-2"
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
            className="cursor-pointer rounded-full bg-accent-2/15 px-4 py-2 text-accent-2"
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
          ) : editingProfile ? (
            /* Takes over the landing page the same way GroupDetails does -
               the room list and "open a room" showing underneath the profile
               editor was a real bug: tapping "עריכת הפרופיל שלי" left every
               other control on screen too. No separate "back" button here on
               purpose, by request, 2026-09-22: "שמירה" saves and returns,
               "ביטול" (inside ProfileEditor) discards and returns - a third
               button that does neither is one control too many. */
            <div className="flex w-full max-w-sm flex-col items-center gap-3">
              <ProfileEditor
                uid={user.uid}
                fallbackName={user.displayName ?? ''}
                profile={profile}
                onDone={() => setEditingProfile(false)}
              />
            </div>
          ) : editingQuestions ? (
            <div className="flex w-full max-w-sm flex-col items-center gap-3">
              <CustomQuestionsEditor
                uid={user.uid}
                questions={customQuestions.questions}
                onDone={() => setEditingQuestions(false)}
              />
            </div>
          ) : (
            <div className="flex w-full max-w-sm flex-col items-center gap-3">
              <p>
                {profile.emoji && <span className="me-1">{profile.emoji}</span>}
                {t('greeting', { name: user.displayName ?? user.email })}
              </p>

              {/* Someone handed this host a group - see GroupShareDoc. Offered
                  rather than applied on arrival: a link that silently wrote
                  someone else's people into your account the moment you
                  opened it would be a surprise, not a feature. */}
              {shareId && <ImportSharedGroup uid={user.uid} shareId={shareId} />}

              <button
                type="button"
                onClick={() => setEditingProfile(true)}
                data-tour="edit-profile"
                className="cursor-pointer text-xs text-accent-2 rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 font-medium"
              >
                {t('editProfileButton')}
              </button>

              <button
                type="button"
                onClick={() => setEditingQuestions(true)}
                data-tour="edit-questions"
                className="cursor-pointer text-xs text-accent-2 rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 font-medium"
              >
                {t('editQuestionsButton')}
              </button>

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
                      className="cursor-pointer rounded-full bg-danger/15 px-4 py-2 text-sm text-danger"
                    >
                      {t('signOutYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingSignOut(false)}
                      className="cursor-pointer rounded-full px-4 py-2 text-sm text-muted"
                    >
                      {t('signOutNo')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingSignOut(true)}
                  className="cursor-pointer text-sm text-muted rounded-full bg-ink/8 px-3 py-1"
                >
                  {t('signOut')}
                </button>
              )}
            </div>
          )
        ) : (
          <div className="flex w-full max-w-sm flex-col items-center gap-4">
            {/* A share link only means something once there is an account to
                save the group into. */}
            {shareId && <p className="text-sm text-muted">{t('shareNeedsSignIn')}</p>}
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              data-tour="sign-in"
              className="cursor-pointer rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-2 font-semibold text-white shadow-glow"
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
            className="cursor-pointer rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-2 font-semibold text-white shadow-glow disabled:opacity-50"
          >
            {busy ? t('joining') : t('joinButton')}
          </button>
        </form>
      )}

      {screen.kind === 'in-room' && (
        <>
          <Gathering sessionId={screen.sessionId} roomCode={screen.roomCode} uid={screen.uid} />
          {/* Deliberately quiet, and deliberately not a bare underlined link:
              leaving is a real action that deserves a real control, but it
              must never compete with the host's game buttons for attention.
              Asked for directly - "כפתור היציאה מהחדר לא הכי נחמד". */}
          {liveSession && (
            <LeaveRoomControl
              sessionId={screen.sessionId}
              uid={screen.uid}
              isActiveHost={liveSession.hostUid === screen.uid}
              originalHostUid={liveSession.originalHostUid ?? liveSession.hostUid}
              groupId={liveSession.groupId}
              players={liveRoster}
              onLeft={(openDetailsForGroupId) => goHomeAfterLeaving(openDetailsForGroupId)}
            />
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

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/40 p-3">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t('profileNamePlaceholder')}
        maxLength={40}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
      />
      <EmojiPicker value={emoji} onChange={setEmoji} label={t('pickEmojiLabel')} />
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          disabled={save.busy || !name.trim()}
          onClick={() =>
            // Saves and returns immediately, by request 2026-09-22: "שמירה
            // שומרת ומחזירה ללובי" - no confirmation message to linger on,
            // since there is no longer a screen left to show it on.
            void save.run(async () => {
              await saveUserProfile(db, uid, { displayName: name.trim(), emoji })
              onDone()
            })
          }
          className="grow cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
        >
          {save.busy ? t('savingProfile') : t('saveProfile')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded-full px-3 py-2 text-sm text-muted"
        >
          {t('addGroupCancel')}
        </button>
      </div>
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
 * The full picture of "guided questions" for a host to review and extend -
 * the built-in bank (read-only: what every gathering already offers, shown
 * in a random subset per room) plus the host's own question bank, milestone
 * 8's "questions the host chooses themselves, with answers", persisted so it
 * is offered again in every future gathering (see `SessionDoc.customQuestions`,
 * taken as a snapshot at `createRoom` time). Add and delete only, deliberately
 * - editing an existing question is left out of this first pass, and deleting
 * and re-adding covers the rare case of a genuine mistake.
 *
 * **Both halves shown together, unlike the in-lobby GuidedQuestions screen.**
 * That screen paginates - a handful of the built-ins at a time, so the wait
 * screen never turns into a wall of text - but this is a review/edit context,
 * not a wait, so the whole built-in bank is listed plainly. Asked for
 * directly: "איפה כל השאלות המנחות שדיברנו עליהן בתוך עריכת המשחק?" and,
 * separately, "לא הבנתי מהו ה'שאלות מותאמות אישית' שיש בעמוד הבית" - both
 * point at the same gap: nothing here explained what the built-in bank even
 * was, or that "custom questions" only ever meant the host's own additions
 * on top of it.
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
  const [showBuiltins, setShowBuiltins] = useState(false)
  const add = useAction()
  const remove = useAction()

  const options = optionsInput
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/40 p-3">
      <button
        type="button"
        onClick={() => setShowBuiltins((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between text-start"
      >
        <span className="font-display text-sm font-semibold text-accent-2">{t('builtinQuestionsTitle')}</span>
        <span className="text-xs text-muted">{PROFILE_QUESTIONS.length}</span>
      </button>
      {showBuiltins && (
        <>
          <p className="text-start text-xs text-muted">{t('builtinQuestionsHint')}</p>
          <ul className="flex max-h-48 w-full flex-col gap-1 overflow-y-auto">
            {PROFILE_QUESTIONS.map((question) => (
              <li
                key={question.id}
                className="rounded-lg border border-line bg-surface/60 px-2 py-1.5 text-start text-sm text-muted"
              >
                {question.text}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="w-full border-t border-line pt-2">
        <p className="font-display text-start text-sm font-semibold text-accent-2">{t('customQuestionsTitle')}</p>
        <p className="text-start text-xs text-muted">{t('customQuestionsHint')}</p>
      </div>

      {questions.length === 0 ? (
        <p className="w-full text-start text-xs text-muted">{t('noCustomQuestionsYet')}</p>
      ) : (
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
          className="grow cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
        >
          {add.busy ? t('savingProfile') : t('addCustomQuestion')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded-full px-3 py-2 text-sm text-muted"
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
      data-tour="join-code"
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
          className="cursor-pointer rounded-full bg-accent-2/15 px-4 py-2 text-accent-2 disabled:opacity-50"
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

/**
 * The receiving end of a shared group - offered, never applied on arrival.
 * Importing writes a fresh, independent copy into this account: nothing links
 * the two afterwards, so both hosts edit their own from then on. See
 * `GroupShareDoc` in model.ts and `importSharedGroup` in memory.ts.
 */
function ImportSharedGroup({ uid, shareId }: { uid: string; shareId: string }) {
  const { t } = useTranslation()
  const action = useAction()
  const [done, setDone] = useState(false)

  if (done) {
    return <p className="text-sm text-accent-3">{t('sharedGroupImported')}</p>
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-accent-2/50 bg-surface/40 p-3">
      <p className="text-center text-sm">{t('sharedGroupOffer')}</p>
      <button
        type="button"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await importSharedGroup(db, uid, shareId)
            setDone(true)
            // The link has done its job - clear it so a refresh does not
            // re-offer an import that already happened.
            window.history.replaceState({}, '', '/')
          })
        }
        className="cursor-pointer rounded-full bg-accent-2/15 px-4 py-2 text-sm text-accent-2 disabled:opacity-40"
      >
        {action.busy ? t('importingSharedGroup') : t('importSharedGroup')}
      </button>
      {action.error && (
        <p role="alert" className="text-xs text-danger">
          {action.error === 'share-expired' || action.error === 'share-not-found'
            ? t('sharedGroupGone')
            : t('importSharedGroupError')}
        </p>
      )}
    </div>
  )
}

/**
 * Leaving a room, and - for the active host only - what happens to the room
 * when they do. Asked for directly: "כאשר מנהל בוחר לצאת מהחדר... שתהיה לו
 * האפשרות לבחור לסגור את החדר לכולם או להעביר את האירוח למשתמש לבחירתו."
 *
 * **Closing** runs the same collection pass the evening's last screen would
 * (`ensureContacts`/`writeRemainingFacts`/`writeProfileFacts`) before ending
 * it - a room closed early must be exactly as safe as one that reached
 * Finale normally, the same lesson the milestone-8 abandoned-session fix
 * already applies elsewhere in this app.
 *
 * **Transferring-and-leaving now runs that same collection pass too**, not
 * just closing - fixed 2026-09-22. The evening not ending is not a reason to
 * skip it: only the true owner's own client can ever write into their private
 * store (firestore.rules), and unlike the fallback effect in
 * `BetweenGames.tsx` (which only fires for someone who stays in the room),
 * someone who transfers away control *and leaves in the same tap* is never
 * again in a position to write anything for themselves - this is the one
 * moment their own client is still both able to and definitely present.
 *
 * **Both paths now also offer to name the group before finishing**, the same
 * offer Finale.tsx already makes at the natural end of an evening - closing
 * or transferring-and-leaving are the *other* ways an evening ends, and
 * skipping the offer there is why four unrelated one-off evenings could each
 * separately end up named "אלה" instead of one continuing group. Naming is
 * optional (skippable, same as at Finale); naming is what makes a "view/edit
 * now" offer meaningful afterwards. A group already named needs asking again
 * no more than Finale does.
 */
function LeaveRoomControl({
  sessionId,
  uid,
  isActiveHost,
  originalHostUid,
  groupId,
  players,
  onLeft,
}: {
  sessionId: string
  uid: string
  isActiveHost: boolean
  originalHostUid: string
  groupId: string | null
  players: { id: string; name: string; leftAt: number | null }[]
  onLeft: (openDetailsForGroupId?: string) => void
}) {
  const { t } = useTranslation()
  const [stage, setStage] = useState<
    | 'idle'
    | 'confirm-guest'
    | 'menu'
    | 'confirm-close'
    | 'pick-transfer'
    | 'confirm-transfer'
    | 'name-group'
    | 'group-saved'
    | 'evening-kept'
  >('idle')
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)
  const [pendingAction, setPendingAction] = useState<'close' | 'transfer-leave' | null>(null)
  const [groupNameInput, setGroupNameInput] = useState('')
  const [justNamed, setJustNamed] = useState<string | null>(null)
  const [skippingSave, setSkippingSave] = useState(false)
  const action = useAction()

  const effectiveGroupId = groupId ?? sessionId
  // Whether this evening's group already has a name from an earlier point
  // (a returning saved group, or named at a previous close/transfer/Finale) -
  // if so there is nothing new to ask here, the same way Finale.tsx only
  // offers the name once.
  const { name: savedGroupName, loading: nameLoading } = useGroupName(
    originalHostUid,
    effectiveGroupId,
  )
  const alreadyNamed = !nameLoading && savedGroupName !== ''

  const others = players.filter((p) => p.id !== uid && !p.leftAt)

  async function doLeave(openDetailsForGroupId?: string) {
    try {
      await leaveRoom(db, sessionId, uid)
    } catch (error) {
      // Best-effort, same reasoning as storeSession/clearStoredSession
      // elsewhere in this file: forgetting the room locally must not be
      // blocked by a flaky write that only updates how this player looks to
      // everyone else's roster.
      console.error('[FlashPlay] leaveRoom failed:', error)
    }
    onLeft(openDetailsForGroupId)
  }

  /** The collection pass both closing and transferring-and-leaving need
   *  before they finish - see the module comment above for why
   *  transfer-and-leave now runs this too. Never blocks on a failure here:
   *  a delegate host acting on a room they were only handed, rather than
   *  opened, cannot write into the true owner's store at all
   *  (firestore.rules), and that owner's own client will still collect
   *  independently once it sees the gathering finish, as long as they have
   *  not also left. */
  async function collectTheEvening() {
    try {
      await ensureContacts(db, originalHostUid, sessionId, players, groupId)
      await writeRemainingFacts(db, originalHostUid, sessionId)
      await writeProfileFacts(db, originalHostUid, sessionId, players)
    } catch (error) {
      console.error(
        '[FlashPlay] keeping the evening before leaving failed:',
        errorCode(error),
        error,
      )
    }
  }

  // `startClose`/`startTransferLeave` pass the action explicitly to `finish`
  // rather than relying on the `pendingAction` state they also set - reading
  // that state back inside the very same call would read its pre-update
  // value (a `setState` call does not apply before the next render), so a
  // group already named would silently do nothing at all on "close"/
  // "transfer and leave". `pendingAction` still exists for the 'name-group'
  // stage's own buttons below, which render on a later, already-updated pass.
  function startClose() {
    if (alreadyNamed) {
      void action.run(() => finish('close'))
    } else {
      setPendingAction('close')
      setStage('name-group')
    }
  }

  function startTransferLeave() {
    if (alreadyNamed) {
      void action.run(() => finish('transfer-leave'))
    } else {
      setPendingAction('transfer-leave')
      setStage('name-group')
    }
  }

  /** Runs after the naming step (named or explicitly skipped) - the
   *  collection pass, the action itself (ending the gathering, or moving
   *  hostUid), and naming the group if a name was given. When a name was
   *  just given (or this evening's group already had one), leaving is
   *  deferred to the 'group-saved' stage, so the host can choose to
   *  view/edit before this screen disappears. */
  async function finish(which: 'close' | 'transfer-leave', name?: string) {
    await collectTheEvening()
    if (name) {
      try {
        await nameGroup(db, originalHostUid, effectiveGroupId, name)
      } catch (error) {
        console.error('[FlashPlay] naming the group failed:', errorCode(error), error)
      }
    }
    if (which === 'close') await endGathering(db, sessionId)
    else if (target) await transferHost(db, sessionId, target.id)

    if (name || alreadyNamed) {
      setJustNamed(name ?? savedGroupName)
      setStage('group-saved')
    } else {
      // Explicitly declined to save (the 'dontSaveGroup' button on the
      // 'name-group' stage) - leave straight away, with no "saved, view it
      // now?" screen. That screen used to show unconditionally so a skip
      // wasn't a silent no-op, but Nitzan asked for the opposite once the
      // "don't save" button's own label already says what happens
      // (2026-09-23): a choice this explicit needs no follow-up message.
      await doLeave()
    }
  }

  async function doTransferAndStay() {
    if (!target) return
    await action.run(async () => {
      await transferHost(db, sessionId, target.id)
      setStage('idle')
    })
  }

  if (stage === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setStage(isActiveHost ? 'menu' : 'confirm-guest')}
        data-tour="leave-room"
        className="mt-2 cursor-pointer rounded-full bg-ink/8 px-4 py-1.5 text-xs text-muted"
      >
        {t('leaveRoom')}
      </button>
    )
  }

  const panelClass =
    'mt-2 flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-danger/40 bg-surface/80 p-4'

  if (stage === 'confirm-guest') {
    return (
      <div className={panelClass}>
        <p className="text-sm font-medium">{t('leaveRoomConfirmQuestion')}</p>
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            onClick={() => void doLeave()}
            className="grow cursor-pointer rounded-full bg-danger/15 px-3 py-2 text-sm font-medium text-danger"
          >
            {t('leaveRoomConfirmYes')}
          </button>
          <button
            type="button"
            onClick={() => setStage('idle')}
            className="grow cursor-pointer rounded-full bg-ink/8 px-3 py-2 text-sm text-muted"
          >
            {t('leaveRoomConfirmNo')}
          </button>
        </div>
      </div>
    )
  }

  if (stage === 'menu') {
    return (
      <div className={panelClass}>
        <p className="text-sm font-medium">{t('leaveRoomHostQuestion')}</p>
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={() => setStage('confirm-close')}
            className="cursor-pointer rounded-full bg-danger/15 px-3 py-2 text-sm font-medium text-danger"
          >
            {t('closeRoomForEveryone')}
          </button>
          <button
            type="button"
            onClick={() => setStage('pick-transfer')}
            className="cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2"
          >
            {t('transferHostOption')}
          </button>
          <button
            type="button"
            onClick={() => setStage('idle')}
            className="cursor-pointer rounded-full bg-ink/8 px-3 py-2 text-sm text-muted"
          >
            {t('leaveRoomConfirmNo')}
          </button>
        </div>
      </div>
    )
  }

  if (stage === 'confirm-close') {
    return (
      <div className={panelClass}>
        <p className="text-center text-sm font-medium">{t('closeRoomConfirm')}</p>
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            disabled={action.busy}
            onClick={() => startClose()}
            className="grow cursor-pointer rounded-full bg-danger/15 px-3 py-2 text-sm font-medium text-danger disabled:opacity-50"
          >
            {action.busy ? t('closingRoom') : t('closeRoomYes')}
          </button>
          <button
            type="button"
            disabled={action.busy}
            onClick={() => setStage('menu')}
            className="grow cursor-pointer rounded-full bg-ink/8 px-3 py-2 text-sm text-muted disabled:opacity-50"
          >
            {t('backToOptions')}
          </button>
        </div>
        {action.error && (
          <p role="alert" className="text-xs text-danger">
            {t('closeRoomError')}{' '}
            <span dir="ltr" className="font-mono">
              ({action.error})
            </span>
          </p>
        )}
      </div>
    )
  }

  if (stage === 'pick-transfer') {
    return (
      <div className={panelClass}>
        <p className="text-sm font-medium">{t('pickTransferTarget')}</p>
        {others.length === 0 ? (
          <p className="text-xs text-muted">{t('noOtherPlayersToTransfer')}</p>
        ) : (
          <div className="flex w-full flex-col gap-2">
            {others.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => {
                  setTarget(player)
                  setStage('confirm-transfer')
                }}
                className="cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2"
              >
                {player.name}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setStage('menu')}
          className="cursor-pointer rounded-full bg-ink/8 px-3 py-2 text-sm text-muted"
        >
          {t('backToOptions')}
        </button>
      </div>
    )
  }

  if (stage === 'confirm-transfer' && target) {
    return (
      <div className={panelClass}>
        <p className="text-center text-sm font-medium">
          {t('confirmTransferTo', { name: target.name })}
        </p>
        <p className="text-center text-xs text-muted">{t('transferLeaveWarning')}</p>
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            disabled={action.busy}
            onClick={() => startTransferLeave()}
            className="cursor-pointer rounded-full bg-danger/15 px-3 py-2 text-sm font-medium text-danger disabled:opacity-50"
          >
            {action.busy ? t('transferringHost') : t('transferAndLeave')}
          </button>
          <button
            type="button"
            disabled={action.busy}
            onClick={() => void doTransferAndStay()}
            className="cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2 disabled:opacity-50"
          >
            {action.busy ? t('transferringHost') : t('transferAndStay')}
          </button>
          <button
            type="button"
            disabled={action.busy}
            onClick={() => setStage('pick-transfer')}
            className="cursor-pointer rounded-full bg-ink/8 px-3 py-2 text-sm text-muted disabled:opacity-50"
          >
            {t('backToOptions')}
          </button>
        </div>
        {action.error && (
          <p role="alert" className="text-xs text-danger">
            {t('transferError')}{' '}
            <span dir="ltr" className="font-mono">
              ({action.error})
            </span>
          </p>
        )}
      </div>
    )
  }

  // Offered before closing or transferring-and-leave finishes, unless this
  // evening's group already has a name - see the module comment above and
  // Finale.tsx's own identical offer at the natural end of an evening.
  if (stage === 'name-group') {
    return (
      <div className={panelClass}>
        <p className="text-center text-sm">{t('saveGroupOffer')}</p>
        <input
          value={groupNameInput}
          onChange={(event) => setGroupNameInput(event.target.value)}
          placeholder={t('groupNamePlaceholder')}
          maxLength={40}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
        />
        {/* Each button shows its own busy label - they share one action, and
            "don't save" used to light up "שומרים..." on the save button. */}
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            disabled={action.busy || !groupNameInput.trim() || !pendingAction}
            onClick={() => {
              if (!pendingAction) return
              setSkippingSave(false)
              void action.run(() => finish(pendingAction, groupNameInput.trim()))
            }}
            className="cursor-pointer rounded-full bg-linear-135 from-accent to-accent-deep px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 shadow-glow"
          >
            {action.busy && !skippingSave ? t('savingGroup') : t('saveGroup')}
          </button>
          <button
            type="button"
            disabled={action.busy || !pendingAction}
            onClick={() => {
              if (!pendingAction) return
              setSkippingSave(true)
              void action.run(() => finish(pendingAction))
            }}
            className="cursor-pointer rounded-full bg-ink/8 px-3 py-2 text-sm text-muted disabled:opacity-50"
          >
            {action.busy && skippingSave
              ? pendingAction === 'close'
                ? t('closingRoom')
                : t('transferringHost')
              : t('dontSaveGroup')}
          </button>
        </div>
        {action.error && (
          <p role="alert" className="text-xs text-danger">
            {pendingAction === 'close' ? t('closeRoomError') : t('transferError')}{' '}
            <span dir="ltr" className="font-mono">
              ({action.error})
            </span>
          </p>
        )}
      </div>
    )
  }

  // Only reached when the group has a name - just given here, or already
  // saved from before - since `finish` leaves straight away on a genuine
  // "don't save" skip (see its own comment).
  if (stage === 'group-saved') {
    return (
      <div className={panelClass}>
        <p className="text-center text-sm">{t('groupSavedInto', { name: justNamed })}</p>
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={() => void doLeave(effectiveGroupId)}
            className="cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2"
          >
            {t('viewGroupNowYes')}
          </button>
          <button
            type="button"
            onClick={() => void doLeave()}
            className="cursor-pointer rounded-full bg-ink/8 px-3 py-2 text-sm text-muted"
          >
            {t('viewGroupNowLater')}
          </button>
        </div>
      </div>
    )
  }

  return null
}

