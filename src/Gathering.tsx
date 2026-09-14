import { useTranslation } from 'react-i18next'
import Harvest from './Harvest'
import LoadFailure from './LoadFailure'
import Rounds from './Rounds'
import Scoreboard from './Scoreboard'
import { useGame } from './lib/harvest'
import { usePresenceHeartbeat, useRoster, useSession } from './lib/room'
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
  const { players } = useRoster(sessionId)

  const { session, error: sessionError } = useSession(sessionId)
  const gameId = session?.currentGameId ?? null
  const { game, error: gameError } = useGame(sessionId, gameId)

  // Every error screen carries a retry, the same as App.tsx's - a phone with
  // no console is the only place these are ever seen, and a dead end there is
  // indistinguishable from the app being broken (milestone 3's review).
  if (sessionError) {
    return <LoadFailure message={t('sessionLoadError')} code={sessionError} />
  }
  if (!session) {
    return <p>{t('loading')}</p>
  }

  if (session.phase === 'lobby') {
    return <Lobby sessionId={sessionId} roomCode={roomCode} uid={uid} isHost={isHost} />
  }

  if (gameError) {
    return <LoadFailure message={t('gameLoadError')} code={gameError} />
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

  if (game.phase === 'rounds') {
    return (
      <Rounds
        sessionId={sessionId}
        gameId={game.id}
        uid={uid}
        isHost={isHost}
        scores={session.scores ?? {}}
      />
    )
  }

  // The first game is over. The second one ("most likely to", built from the
  // items this game revealed) is milestone 6 - but the scores stay on screen:
  // ten rounds of guessing that end on a bare grey sentence is not an ending,
  // and DESIGN wants the evening to have an arc.
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <Scoreboard players={players} scores={session.scores ?? {}} title={t('finalScoresTitle')} />
      <p className="text-neutral-500">{t('gameFinishedComingSoon')}</p>
    </div>
  )
}
