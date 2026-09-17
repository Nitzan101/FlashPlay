import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pickHarvestPromptIds, startHarvestGame } from './lib/harvest'
import { db } from './lib/firebase'
import { MIN_PLAYERS_TO_START } from './lib/model'
import { useRoster } from './lib/room'

interface LobbyProps {
  sessionId: string
  roomCode: string
  uid: string
  isHost: boolean
  hostUid: string
}

export default function Lobby({ sessionId, roomCode, uid, isHost, hostUid }: LobbyProps) {
  const { t } = useTranslation()
  const { players, error } = useRoster(sessionId)
  // "In the room" means present, not merely having joined at some point -
  // otherwise a player who explicitly left still counts, and the number on
  // screen looks exactly as stale as the roster row itself used to.
  const activeCount = players.filter((player) => !player.leftAt).length

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [startState, setStartState] = useState<'idle' | 'busy' | 'error'>('idle')
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
      <p className="text-lg font-semibold">{t('roomCodeLabel', { code: roomCode })}</p>

      {isHost && (
        <div className="flex w-full flex-col items-center gap-2">
          <p className="text-sm text-neutral-500">{t('roomLinkLabel')}</p>
          <code
            dir="ltr"
            className="w-full break-all rounded-md bg-neutral-100 px-3 py-2 text-center text-sm select-all"
          >
            {joinUrl}
          </code>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="cursor-pointer rounded-md border border-neutral-300 px-4 py-2"
          >
            {copyState === 'copied' ? t('linkCopied') : t('copyLink')}
          </button>
          {copyState === 'failed' && (
            <p role="alert" className="text-xs text-red-600">
              {t('copyFailed')}
            </p>
          )}
        </div>
      )}

      <p className="text-neutral-600">
        {activeCount === 1 ? t('memberCountOne') : t('memberCount', { count: activeCount })}
      </p>

      {error && (
        <p role="alert" className="text-red-600">
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
      <ul className="flex w-full flex-col gap-1">
        {players.map((player) => (
          <li key={player.id} className="min-w-0 truncate">
            <span className={player.leftAt ? 'text-neutral-400' : undefined}>{player.name}</span>
            {player.id === uid && <span className="text-neutral-500"> {t('youSuffix')}</span>}
            {player.id === hostUid && <span className="text-neutral-500"> {t('hostSuffix')}</span>}
            {player.leftAt && <span className="text-neutral-400"> {t('leftSuffix')}</span>}
          </li>
        ))}
      </ul>

      <p className="text-neutral-500">{isHost ? t('lobbyWaitingHost') : t('lobbyWaitingGuest')}</p>

      {isHost && (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void startGame()}
            disabled={startState === 'busy' || activeCount < MIN_PLAYERS_TO_START}
            className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {startState === 'busy' ? t('startingGame') : t('startGame')}
          </button>
          {/* "Who said that"'s vote screen excludes the voter, so starting
              alone would show zero candidates - found live, starting a game
              with only the host in the room. */}
          {activeCount < MIN_PLAYERS_TO_START && (
            <p className="text-xs text-neutral-500">
              {t('needMorePlayers', { count: MIN_PLAYERS_TO_START })}
            </p>
          )}
          {startState === 'error' && (
            <p role="alert" className="text-xs text-red-600">
              {t('startGameError')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
