import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePresenceHeartbeat, useRoster } from './lib/room'

/** Matches the ~30s phone lock cycle from DESIGN.md - a player who has not
 *  sent a heartbeat within this window reads as away, not present. */
const PRESENT_WINDOW_MS = 60_000
const TICK_MS = 10_000

interface LobbyProps {
  sessionId: string
  roomCode: string
  uid: string
  isHost: boolean
}

export default function Lobby({ sessionId, roomCode, uid, isHost }: LobbyProps) {
  const { t } = useTranslation()
  const roster = useRoster(sessionId)
  usePresenceHeartbeat(sessionId, uid)

  // Presence dots are computed from `lastSeenAt` on every render, but nothing
  // re-renders this component on its own as time passes - this tick forces
  // one periodically so a player who went quiet is shown as such.
  const [, tick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => tick((n) => n + 1), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${roomCode}`)
    } catch {
      // Clipboard access can be denied - the code itself is shown regardless.
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-lg font-semibold">{t('roomCodeLabel', { code: roomCode })}</p>

      {isHost && (
        <button
          type="button"
          onClick={() => void copyLink()}
          className="cursor-pointer rounded-md border border-neutral-300 px-4 py-2"
        >
          {t('copyLink')}
        </button>
      )}

      <ul className="flex w-full max-w-xs flex-col gap-1">
        {roster.map((player) => {
          const present = Date.now() - player.lastSeenAt < PRESENT_WINDOW_MS
          return (
            <li key={player.id} className="flex items-center gap-2">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${present ? 'bg-green-500' : 'bg-neutral-300'}`}
              />
              <span>{player.name}</span>
              {player.id === uid && <span className="text-neutral-500">{t('youSuffix')}</span>}
            </li>
          )
        })}
      </ul>

      <p className="text-neutral-500">{t('lobbyWaiting')}</p>
    </div>
  )
}
