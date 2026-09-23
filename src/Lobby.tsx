import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EmojiPicker from './EmojiPicker'
import GuidedQuestions from './GuidedQuestions'
import LinkPlayers from './LinkPlayers'
import { pickHarvestPromptIds, startHarvestGame } from './lib/harvest'
import { db } from './lib/firebase'
import { MIN_PLAYERS_TO_START, type PlayerDoc, type ProfileQuestion } from './lib/model'
import { renamePlayer, useRoster } from './lib/room'
import { useAction } from './lib/useAction'

interface LobbyProps {
  sessionId: string
  roomCode: string
  uid: string
  isHost: boolean
  /** The *active* host, for the roster's own "(מארח/ת)" label - who is
   *  running the room right now, which after a transfer is not necessarily
   *  who opened it. */
  hostUid: string
  /** This gathering's snapshot of the host's own question bank - see
   *  SessionDoc.customQuestions. Optional, defaulting to none, so every
   *  existing test that renders this screen without it stays valid. */
  customQuestions?: ProfileQuestion[]
  /** The evening's true owner and the group it continues - both needed only
   *  by the host-only "link a returning player" panel, which is skipped
   *  entirely without them. Optional for the same test-compatibility reason
   *  as customQuestions. */
  originalHostUid?: string
  groupId?: string | null
  contactIds?: Record<string, string>
}

export default function Lobby({
  sessionId,
  roomCode,
  uid,
  isHost,
  hostUid,
  customQuestions = [],
  originalHostUid,
  groupId,
  contactIds = {},
}: LobbyProps) {
  const { t } = useTranslation()
  const { players, error } = useRoster(sessionId)
  // "In the room" means present, not merely having joined at some point -
  // otherwise a player who explicitly left still counts, and the number on
  // screen looks exactly as stale as the roster row itself used to.
  const activeCount = players.filter((player) => !player.leftAt).length

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [startState, setStartState] = useState<'idle' | 'busy' | 'error'>('idle')
  // Editing is self-service only: firestore.rules lets the host update any
  // player row, but the name half of a rename is guarded by claiming a slot
  // in playerNames, which only the row's own uid may claim - so editing
  // someone else's name here would either silently skip that guard (reopening
  // the exact "two players, one name" bug this project already fixed once) or
  // fail outright. Host-editable identity for a participant with no device of
  // their own is real, deferred work - see BACKLOG.md.
  const [editingSelf, setEditingSelf] = useState(false)
  const joinUrl = `${window.location.origin}/join/${roomCode}`

  async function startGame() {
    setStartState('busy')
    try {
      await startHarvestGame(db, sessionId, pickHarvestPromptIds())
      // No local success state to set - useSession() upstream (Gathering.tsx)
      // sees the phase flip to 'playing' and unmounts this screen for
      // Harvest for every device in the room, host included.
    } catch (error) {
      console.error('[FlashPlay] startHarvestGame failed:', error)
      setStartState('error')
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopyState('copied')
    } catch {
      // The visible, selectable URL below is the fallback - this is not a
      // dead end the way a silent failure with no other path would be.
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), 2500)
  }

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4">
      <p className="text-lg font-bold text-accent-2 drop-shadow-[0_0_10px_rgba(34,240,211,0.5)]">
        {t('roomCodeLabel', { code: roomCode })}
      </p>

      {isHost && (
        <div className="flex w-full flex-col items-center gap-2">
          <p className="text-sm text-muted">{t('roomLinkLabel')}</p>
          <code
            dir="ltr"
            className="w-full break-all rounded-xl border border-line bg-surface px-3 py-2 text-center text-sm text-ink select-all"
          >
            {joinUrl}
          </code>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="cursor-pointer rounded-xl border border-accent-2 px-4 py-2 text-accent-2"
          >
            {copyState === 'copied' ? t('linkCopied') : t('copyLink')}
          </button>
          {copyState === 'failed' && (
            <p role="alert" className="text-xs text-danger">
              {t('copyFailed')}
            </p>
          )}
        </div>
      )}

      <p className="text-muted">
        {activeCount === 1 ? t('memberCountOne') : t('memberCount', { count: activeCount })}
      </p>

      {error && (
        <p role="alert" className="text-danger">
          {t('rosterLoadError')}
        </p>
      )}

      {/* No per-player online/away indicator here on purpose. The heartbeat
          still runs (usePresenceHeartbeat, above) - lastSeenAt is real data
          milestone 4 can use - but a green/grey dot in THIS screen is
          actively misleading: everyone locks their phone while waiting, so
          within about a minute the host would see every dot go grey while
          the room is genuinely full. Tuning the threshold cannot fix that,
          since a locked phone's JS timers stop rather than merely slow down
          - "prefer removing a failure mode to tuning it." The member count
          above and the roster itself (both correct at every moment, since
          they come straight from who has actually joined) are the honest
          signal for this screen. See BACKLOG.md, "presence UI". */}
      <ul className="flex w-full flex-col gap-1 rounded-xl border border-line bg-surface/60 p-2">
        {players.map((player) => (
          <li
            key={player.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-1 py-0.5"
          >
            {/* No truncation here on purpose - a long real name (three words
                is common in Hebrew) was cut off with no way to read the rest,
                including a player's own name in their own row. Wrapping to a
                second line costs nothing; losing part of someone's name does. */}
            <span className="min-w-0 break-words">
              {player.emoji && <span className="me-1">{player.emoji}</span>}
              <span className={player.leftAt ? 'text-muted' : undefined}>{player.name}</span>
              {player.id === uid && <span className="text-accent-2"> {t('youSuffix')}</span>}
              {player.id === hostUid && (
                <span className="font-semibold text-accent-3"> {t('hostSuffix')}</span>
              )}
              {player.leftAt && <span className="text-muted italic"> {t('leftSuffix')}</span>}
            </span>
            {player.id === uid && !editingSelf && (
              <button
                type="button"
                onClick={() => setEditingSelf(true)}
                className="shrink-0 cursor-pointer text-xs text-accent-2 underline decoration-dotted underline-offset-4"
              >
                {t('editMyNameEmoji')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {editingSelf && (
        <SelfIdentityEditor
          sessionId={sessionId}
          uid={uid}
          current={players.find((p) => p.id === uid)}
          onDone={() => setEditingSelf(false)}
        />
      )}

      <p className="text-muted">{isHost ? t('lobbyWaitingHost') : t('lobbyWaitingGuest')}</p>

      {/* Host-only, and only when this gathering continues a saved group -
          the contacts it offers live in that host's own private store, which
          nobody else can read at all. */}
      {originalHostUid === uid && groupId && (
        <LinkPlayers
          sessionId={sessionId}
          hostUid={originalHostUid}
          groupId={groupId}
          players={players}
          contactIds={contactIds}
        />
      )}

      {/* Every player, host included - framed as something to fill the wait
          with, never a gate on it (milestone 8). */}
      <GuidedQuestions sessionId={sessionId} uid={uid} customQuestions={customQuestions} />

      {isHost && (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void startGame()}
            disabled={startState === 'busy' || activeCount < MIN_PLAYERS_TO_START}
            className="cursor-pointer rounded-xl bg-accent px-4 py-2 font-semibold text-white shadow-[0_0_18px_rgba(255,46,154,0.5)] disabled:opacity-50"
          >
            {startState === 'busy' ? t('startingGame') : t('startGame')}
          </button>
          {/* "Who said that"'s vote screen excludes the voter, so starting
              alone would show zero candidates - found live, starting a game
              with only the host in the room. */}
          {activeCount < MIN_PLAYERS_TO_START && (
            <p className="text-xs text-muted">
              {t('needMorePlayers', { count: MIN_PLAYERS_TO_START })}
            </p>
          )}
          {startState === 'error' && (
            <p role="alert" className="text-xs text-danger">
              {t('startGameError')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Self-only rename/re-emoji, opened from a player's own roster row. See the
 *  comment on `editingSelf` above for why this cannot yet edit anyone else's
 *  row. */
function SelfIdentityEditor({
  sessionId,
  uid,
  current,
  onDone,
}: {
  sessionId: string
  uid: string
  current: (PlayerDoc & { id: string }) | undefined
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(current?.name ?? '')
  const [emoji, setEmoji] = useState(current?.emoji ?? null)
  const save = useAction()

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/40 p-3">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={40}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
      />
      <EmojiPicker value={emoji} onChange={setEmoji} label={t('pickEmojiLabel')} />
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          disabled={save.busy || !name.trim()}
          onClick={() =>
            void save.run(async () => {
              await renamePlayer(db, sessionId, uid, name.trim(), emoji)
              onDone()
            })
          }
          className="grow cursor-pointer rounded-xl border border-accent-2 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
        >
          {save.busy ? t('savingProfile') : t('saveNameEmoji')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded-xl px-3 py-2 text-sm text-muted"
        >
          {t('addGroupCancel')}
        </button>
      </div>
      {save.error && (
        <p role="alert" className="text-xs text-danger">
          {save.error === 'name-taken' ? t('nameTaken') : t('nameEmojiSaveError')}{' '}
          {save.error !== 'name-taken' && (
            <span dir="ltr" className="font-mono">
              ({save.error})
            </span>
          )}
        </p>
      )}
    </div>
  )
}
