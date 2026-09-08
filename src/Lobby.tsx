import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePresenceHeartbeat, useRoster } from './lib/room'

interface LobbyProps {
  sessionId: string
  roomCode: string
  uid: string
  isHost: boolean
}

export default function Lobby({ sessionId, roomCode, uid, isHost }: LobbyProps) {
  const { t } = useTranslation()
  const { players, error } = useRoster(sessionId)
  usePresenceHeartbeat(sessionId, uid)

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const joinUrl = `${window.location.origin}/join/${roomCode}`

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
        {players.length === 1 ? t('memberCountOne') : t('memberCount', { count: players.length })}
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
            <span>{player.name}</span>
            {player.id === uid && <span className="text-neutral-500"> {t('youSuffix')}</span>}
          </li>
        ))}
      </ul>

      <p className="text-neutral-500">{isHost ? t('lobbyWaitingHost') : t('lobbyWaitingGuest')}</p>
    </div>
  )
}
