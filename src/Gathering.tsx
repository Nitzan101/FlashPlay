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
}

/**
 * Everything shown once a player is in a room, routed off the live session
 * and game documents rather than the one-off screen decision App.tsx makes on
 * load - so a phase change the host makes shows up on every other device the
 * instant it happens, not on their next refresh.
 *
 * **Whether this viewer is the host is computed here, live, not passed in as
 * a prop.** App.tsx used to decide `isHost` once, at the moment a screen was
 * first resolved, and hand it down as a static value - which meant a host
 * transfer (`transferHost` in room.ts) was invisible to the *new* host's own
 * client: `session.hostUid` changed, but the boolean built from it at load
 * time never did, so their screen kept showing them as an ordinary player
 * until they happened to reload. Deriving it from the same live `session`
 * this component already reads fixes that for free.
 *
 * **Two different "host" questions, not one.** `isActiveHost` -
 * `session.hostUid === uid` - is who currently runs the room's controls, and
 * gates every operational action (starting a game, opening voting, ending
 * the evening). `isOriginalHost` - `(session.originalHostUid ?? hostUid) ===
 * uid` - is who the evening's memory actually belongs to, and never changes
 * even after a transfer (see `SessionDoc.originalHostUid`). Only the second
 * one can ever succeed at writing into `users/{uid}/...` at all
 * (firestore.rules), so `BetweenGames`/`Finale` key their private-store work
 * off it, independently of who is currently holding the controls - see the
 * comment on `BetweenGames`'s own collection effect for what that protects
 * against.
 *
 * The presence heartbeat lives here, one level above Lobby/Harvest, so it
 * keeps running across the whole gathering rather than stopping the moment
 * the host leaves the lobby screen.
 */
export default function Gathering({ sessionId, roomCode, uid }: GatheringProps) {
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

  const isActiveHost = session.hostUid === uid
  const originalHostUid = session.originalHostUid ?? session.hostUid
  const isOriginalHost = originalHostUid === uid

  // The evening is over: the last screen is the standings, not a redirect
  // back to a lobby that no longer means anything (session phase is
  // monotonic, so there is no way out of this state by design).
  if (session.phase === 'finished') {
    return (
      <Finale
        sessionId={sessionId}
        hostUid={originalHostUid}
        isHost={isOriginalHost}
        players={players}
        scores={session.scores ?? {}}
        groupId={session.groupId}
      />
    )
  }

  if (session.phase === 'lobby') {
    return (
      <Lobby
        sessionId={sessionId}
        roomCode={roomCode}
        uid={uid}
        isHost={isActiveHost}
        hostUid={session.hostUid}
        customQuestions={session.customQuestions ?? []}
        originalHostUid={originalHostUid}
        groupId={session.groupId}
        contactIds={session.contactIds ?? {}}
      />
    )
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
        isHost={isActiveHost}
      />
    )
  }

  if (game.phase === 'rounds') {
    return game.type === 'most-likely-to' ? (
      <SecondGame
        sessionId={sessionId}
        gameId={game.id}
        uid={uid}
        isHost={isActiveHost}
        scores={session.scores ?? {}}
      />
    ) : (
      <Rounds
        sessionId={sessionId}
        gameId={game.id}
        uid={uid}
        isHost={isActiveHost}
        scores={session.scores ?? {}}
      />
    )
  }

  // A game has ended. What comes next - the second game, or the end of the
  // evening - depends on which one it was.
  return (
    <BetweenGames
      sessionId={sessionId}
      hostUid={originalHostUid}
      uid={uid}
      gameId={game.id}
      groupId={session.groupId}
      finishedType={game.type}
      finishedOrder={game.order}
      players={players}
      scores={session.scores ?? {}}
      isHost={isActiveHost}
    />
  )
}
