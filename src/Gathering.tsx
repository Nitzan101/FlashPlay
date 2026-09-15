import { useTranslation } from 'react-i18next'
import BetweenGames from './BetweenGames'
import Finale from './Finale'
import Harvest from './Harvest'
import LoadFailure from './LoadFailure'
import Rounds from './Rounds'
import SecondGame from './SecondGame'
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
  const { players, error: rosterError } = useRoster(sessionId)

  const { session, error: sessionError } = useSession(sessionId)
  const gameId = session?.currentGameId ?? null
  const { game, error: gameError } = useGame(sessionId, gameId)

  // Every error screen carries a retry, the same as App.tsx's - a phone with
  // no console is the only place these are ever seen, and a dead end there is
  // indistinguishable from the app being broken (milestone 3's review).
  // The roster is not decoration on the last screens of the evening: the
  // scoreboard and the winner are drawn from it, and an empty one renders a
  // finale with no scores and no explanation.
  if (sessionError || rosterError) {
    return <LoadFailure message={t('sessionLoadError')} code={sessionError ?? rosterError} />
  }
  if (!session) {
    return <p>{t('loading')}</p>
  }

  // The evening is over: the last screen is the standings, not a redirect
  // back to a lobby that no longer means anything (session phase is
  // monotonic, so there is no way out of this state by design).
  if (session.phase === 'finished') {
    return (
      <Finale
        sessionId={sessionId}
        hostUid={session.hostUid}
        isHost={isHost}
        players={players}
        scores={session.scores ?? {}}
        groupId={session.groupId}
      />
    )
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
    return game.type === 'most-likely-to' ? (
      <SecondGame
        sessionId={sessionId}
        gameId={game.id}
        uid={uid}
        isHost={isHost}
        scores={session.scores ?? {}}
      />
    ) : (
      <Rounds
        sessionId={sessionId}
        gameId={game.id}
        uid={uid}
        isHost={isHost}
        scores={session.scores ?? {}}
      />
    )
  }

  // A game has ended. What comes next - the second game, or the end of the
  // evening - depends on which one it was.
  return (
    <BetweenGames
      sessionId={sessionId}
      hostUid={session.hostUid}
      gameId={game.id}
      groupId={session.groupId}
      finishedType={game.type}
      finishedOrder={game.order}
      players={players}
      scores={session.scores ?? {}}
      isHost={isHost}
    />
  )
}
