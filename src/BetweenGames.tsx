import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import HostButton from './HostButton'
import Scoreboard from './Scoreboard'
import { db } from './lib/firebase'
import { ensureContacts, writeFactsForGame } from './lib/memory'
import { errorCode } from './lib/room'
import { endGathering, startSecondGame } from './lib/secondGame'
import { useAction } from './lib/useAction'

interface BetweenGamesProps {
  sessionId: string
  hostUid: string
  /** The game that just finished - its facts are written here, at the end of
   *  that game rather than at the end of the evening, so a gathering that is
   *  abandoned halfway keeps whatever was actually played (DESIGN). */
  gameId: string
  /** The group this gathering belongs to, when the host opened the room for
   *  one they had saved. Passing it is what keeps a return visit adding to
   *  that group: without it `ensureContacts` treats the evening as its own
   *  new group and overwrites the session's `groupId` on the way past, which
   *  froze the saved group at its first evening. */
  groupId: string | null
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
  hostUid,
  gameId,
  groupId,
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

  /**
   * What this game leaves behind, written now rather than at the end of the
   * evening - DESIGN: "facts are written at the end of each game ... so an
   * abandoned session keeps whatever was already played."
   *
   * The contacts have to exist first, or there is nobody to attribute a fact
   * to. The first version of this only created them from the host's
   * end-of-evening "save the group" tap, which meant every per-game write
   * found an empty map and wrote nothing at all - the abandoned-session
   * promise was never kept. Both reviews found it.
   */
  async function keepThisGame() {
    try {
      await ensureContacts(db, hostUid, sessionId, players, groupId)
      await writeFactsForGame(db, hostUid, sessionId, gameId)
    } catch (caught) {
      // Never block the room on this: the evening's last screen writes
      // whatever this missed, and the writes are idempotent.
      console.error('[FlashPlay] keeping this game failed:', errorCode(caught), caught)
    }
  }

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
                void run(async () => {
                  // Best-effort and idempotent: a fact is keyed by its item,
                  // so whatever this misses is written again when the evening
                  // ends. It must not block the next game - the room is
                  // waiting on this tap.
                  await keepThisGame()
                  await startSecondGame(db, sessionId, finishedOrder + 1)
                })
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
                onClick={() =>
                  void run(async () => {
                    await keepThisGame()
                    await endGathering(db, sessionId)
                  })
                }
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
          {slow && <p className="text-xs text-muted">{t('stillWorking')}</p>}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {t('roundActionError')}{' '}
              <span dir="ltr" className="font-mono">
                ({error})
              </span>
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{t('waitingForHostNextGame')}</p>
      )}
    </div>
  )
}
