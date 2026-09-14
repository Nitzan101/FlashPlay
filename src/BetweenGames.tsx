import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import HostButton from './HostButton'
import Scoreboard from './Scoreboard'
import { db } from './lib/firebase'
import { endGathering, startSecondGame } from './lib/secondGame'
import { useAction } from './lib/useAction'

interface BetweenGamesProps {
  sessionId: string
  /** The game that just ended - what comes next depends on which one it was. */
  finishedType: 'who-said-that' | 'most-likely-to'
  finishedOrder: number
  players: { id: string; name: string }[]
  scores: Record<string, number>
  isHost: boolean
}

/**
 * The pause between the two games, and the last decision of the evening.
 *
 * The scores stay on screen throughout: DESIGN scores cumulatively across the
 * gathering precisely so the room can see where it stands between games, and
 * a bare "waiting for the host" would throw that away at the one moment it is
 * most interesting.
 */
export default function BetweenGames({
  sessionId,
  finishedType,
  finishedOrder,
  players,
  scores,
  isHost,
}: BetweenGamesProps) {
  const { t } = useTranslation()
  const { busy, slow, error, run } = useAction()
  // Ending the evening cannot be undone - the session's phase is monotonic -
  // and it is the only button on the screen, so it asks first.
  const [confirmingEnd, setConfirmingEnd] = useState(false)

  const nextIsSecondGame = finishedType === 'who-said-that'

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <p className="text-center">
        {nextIsSecondGame ? t('firstGameOver') : t('secondGameOver')}
      </p>
      <Scoreboard players={players} scores={scores} title={t('scoreboardTitle')} />

      {isHost ? (
        <div className="flex flex-col items-center gap-2">
          {nextIsSecondGame ? (
            <HostButton
              busy={busy}
              busyLabel={t('startingSecondGame')}
              onClick={() =>
                void run(() => startSecondGame(db, sessionId, finishedOrder + 1))
              }
              primary
            >
              {t('startSecondGame')}
            </HostButton>
          ) : confirmingEnd ? (
            <>
              <p>{t('endGatheringConfirm')}</p>
              <HostButton
                busy={busy}
                busyLabel={t('endingGathering')}
                onClick={() => void run(() => endGathering(db, sessionId))}
                primary
              >
                {t('endGatheringYes')}
              </HostButton>
              <HostButton busy={busy} onClick={() => setConfirmingEnd(false)}>
                {t('endGatheringNo')}
              </HostButton>
            </>
          ) : (
            <HostButton busy={busy} onClick={() => setConfirmingEnd(true)} primary>
              {t('endGathering')}
            </HostButton>
          )}
          {slow && <p className="text-xs text-neutral-500">{t('stillWorking')}</p>}
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {t('roundActionError')}{' '}
              <span dir="ltr" className="font-mono">
                ({error})
              </span>
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-neutral-500">{t('waitingForHostNextGame')}</p>
      )}
    </div>
  )
}
