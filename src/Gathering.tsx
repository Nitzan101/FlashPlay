import { useTranslation } from 'react-i18next'
import Harvest from './Harvest'
import { useGame } from './lib/harvest'
import { usePresenceHeartbeat, useSession } from './lib/room'
import Lobby from './Lobby'

interface GatheringProps {
  sessionId: string
  roomCode: string
  uid: string
  isHost: boolean
}

/**
 * Everything shown once a player is in a room, routed off the live session
 * and game documents rather than the one-off screen decision App.tsx makes on
 * load - so a phase change the host makes shows up on every other device the
 * instant it happens, not on their next refresh.
 *
 * The presence heartbeat lives here, one level above Lobby/Harvest, so it
 * keeps running across the whole gathering rather than stopping the moment
 * the host leaves the lobby screen.
 */
export default function Gathering({ sessionId, roomCode, uid, isHost }: GatheringProps) {
  const { t } = useTranslation()
  usePresenceHeartbeat(sessionId, uid)

  const { session, error: sessionError } = useSession(sessionId)
  const gameId = session?.currentGameId ?? null
  const { game, error: gameError } = useGame(sessionId, gameId)

  // Every error screen carries a retry, the same as App.tsx's - a phone with
  // no console is the only place these are ever seen, and a dead end there is
  // indistinguishable from the app being broken (milestone 3's review).
  if (sessionError) {
    return <LoadFailure message={t('sessionLoadError')} retryLabel={t('retryButton')} />
  }
  if (!session) {
    return <p>{t('loading')}</p>
  }

  if (session.phase === 'lobby') {
    return <Lobby sessionId={sessionId} roomCode={roomCode} uid={uid} isHost={isHost} />
  }

  if (gameError) {
    return <LoadFailure message={t('gameLoadError')} retryLabel={t('retryButton')} />
  }
  if (!game) {
    return <p>{t('loading')}</p>
  }

  if (game.phase === 'harvesting') {
    return (
      <Harvest
        sessionId={sessionId}
        gameId={game.id}
        promptIds={game.promptIds}
        phaseEndsAt={game.phaseEndsAt}
        uid={uid}
        isHost={isHost}
      />
    )
  }

  // The round loop (game.phase 'rounds') and scoring ('done') are milestone
  // 5 - this milestone's scope is the state machine and the harvest phase
  // only (MILESTONES.md). Reaching here proves the transition works; there is
  // deliberately nothing to play yet.
  return <p className="text-neutral-500">{t('roundsComingSoon')}</p>
}

function LoadFailure({ message, retryLabel }: { message: string; retryLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p role="alert" className="text-red-600">
        {message}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="cursor-pointer rounded-md border border-neutral-300 px-4 py-2"
      >
        {retryLabel}
      </button>
    </div>
  )
}
