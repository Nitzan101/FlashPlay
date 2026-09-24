import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import GroupDetails from './GroupDetails'
import HostButton from './HostButton'
import Scoreboard from './Scoreboard'
import { db } from './lib/firebase'
import { errorCode } from './lib/room'
import {
  ensureContacts,
  nameGroup,
  recordFeedback,
  useGroupName,
  writeRemainingFacts,
} from './lib/memory'
import type { SessionFeedbackDoc } from './lib/model'
import { useAction } from './lib/useAction'

interface FinaleProps {
  sessionId: string
  hostUid: string
  isHost: boolean
  players: { id: string; name: string }[]
  scores: Record<string, number>
  groupId: string | null
}

/**
 * The end of the evening - milestone 6 for the standings, milestone 7 for
 * everything the evening leaves behind.
 *
 * Two different things happen here, and the first version of this screen
 * confused them into one, which cost the whole feature on a return visit.
 *
 *   **Keeping the evening** happens on its own, as soon as this screen opens.
 *   The items nobody played only become attributable now (their authors are
 *   unreadable until the gathering is `finished` - see firestore.rules), so
 *   this is the last chance to write them, and it does not wait for a tap.
 *
 *   **Keeping the group** is the host's choice, and the offer DESIGN puts at
 *   the end: "the offer to save comes at the end, after the value has been
 *   demonstrated." Naming it is what puts it on the shelf for next time. The
 *   host can also throw the whole evening away instead, which is what makes
 *   the automatic keeping above consensual rather than presumptuous.
 */
export default function Finale({
  sessionId,
  hostUid,
  isHost,
  players,
  scores,
  groupId,
}: FinaleProps) {
  const { t } = useTranslation()
  const save = useAction()
  const feedback = useAction()
  const { name: savedName, loading: nameLoading } = useGroupName(
    isHost ? hostUid : null,
    groupId,
  )
  const [groupName, setGroupName] = useState('')
  const [named, setNamed] = useState(false)
  const [factsWritten, setFactsWritten] = useState<number | null>(null)
  const [keepError, setKeepError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SessionFeedbackDoc['outcome'] | null>(null)
  const [headcount, setHeadcount] = useState(String(players.length))
  const [feedbackDone, setFeedbackDone] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const kept = useRef(false)

  // Runs once, for the host only: the guests' devices have no access to the
  // host's store and nothing to write.
  useEffect(() => {
    if (!isHost || kept.current || players.length === 0) return
    kept.current = true
    void (async () => {
      try {
        await ensureContacts(db, hostUid, sessionId, players, groupId)
        setFactsWritten(await writeRemainingFacts(db, hostUid, sessionId))
      } catch (error) {
        console.error('[FlashPlay] keeping the evening failed:', errorCode(error), error)
        setKeepError(errorCode(error))
      }
    })()
  }, [isHost, hostUid, sessionId, players, groupId])

  const best = Math.max(0, ...players.map((player) => scores[player.id] ?? 0))
  const winners = players.filter((player) => (scores[player.id] ?? 0) === best && best > 0)
  const groupKept = named || savedName !== ''

  if (showMemory) {
    // No `onOpenRoom` here on purpose: a room is already open, and this is the
    // screen that ends it.
    return (
      <GroupDetails
        hostUid={hostUid}
        groupId={groupId ?? sessionId}
        onClose={() => setShowMemory(false)}
      />
    )
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <p className="font-display text-xl font-semibold">{t('gatheringOver')}</p>
      {winners.length > 0 && (
        <p className="font-display text-center text-lg font-medium">
          {t(
            // Hebrew has no "1 points": the singular gets its own string, the
            // same way memberCountOne does.
            winners.length === 1
              ? best === 1
                ? 'winnerIsOnePoint'
                : 'winnerIs'
              : best === 1
                ? 'winnersAreOnePoint'
                : 'winnersAre',
            { names: winners.map((w) => w.name).join(', '), points: best },
          )}
        </p>
      )}
      <Scoreboard players={players} scores={scores} title={t('finalScoresTitle')} />

      {isHost && (
        <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-line bg-surface/60 p-3">
          {/* What is happening, before the number that reports it - a count
              with no sentence above it told the host their evening was saved
              and then asked whether to save it. */}
          <p className="text-center text-sm text-muted">{t('keepingExplained')}</p>
          {factsWritten !== null && (
            <p className="text-center text-sm">
              {factsWritten === 0
                ? t('keptNothing')
                : factsWritten === 1
                  ? t('keptFromTonightOne')
                  : t('keptFromTonight', { count: factsWritten })}
            </p>
          )}
          {keepError && (
            <p role="alert" className="text-xs text-danger">
              {t('keepEveningError')}{' '}
              <span dir="ltr" className="font-mono">
                ({keepError})
              </span>
            </p>
          )}

          {!nameLoading && !groupKept ? (
            <>
              <p className="text-center text-sm">{t('saveGroupOffer')}</p>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder={t('groupNamePlaceholder')}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
              />
              <HostButton
                busy={save.busy}
                busyLabel={t('savingGroup')}
                onClick={() =>
                  void save.run(async () => {
                    if (!groupName.trim()) return
                    await nameGroup(db, hostUid, groupId ?? sessionId, groupName.trim())
                    setNamed(true)
                  })
                }
                primary
              >
                {t('saveGroup')}
              </HostButton>
            </>
          ) : (
            !nameLoading && (
              <p className="text-center text-sm">
                {savedName ? t('groupSavedNamed', { name: savedName }) : t('groupSaved')}
              </p>
            )
          )}

          <HostButton busy={false} onClick={() => setShowMemory(true)}>
            {t('viewMemory')}
          </HostButton>

          {save.slow && <p className="text-xs text-muted">{t('stillWorking')}</p>}
          {save.error && (
            <p role="alert" className="text-xs text-danger">
              {t('saveGroupError')}{' '}
              <span dir="ltr" className="font-mono">
                ({save.error})
              </span>
            </p>
          )}

          {/* DESIGN: "outcome feedback after a gathering - did it work, did it
              die, how many were you - is in the first version, because it is
              the asset no language model can generate." */}
          {feedbackDone ? (
            <p className="text-center text-sm text-accent-3">{t('feedbackThanks')}</p>
          ) : (
            <>
              <p className="text-center text-sm">{t('feedbackQuestion')}</p>
              <div className="flex w-full flex-col gap-2">
                {(['good', 'mixed', 'died'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setOutcome(value)}
                    className={
                      outcome === value
                        ? 'cursor-pointer rounded-xl border-2 border-accent bg-accent/15 px-4 py-3 font-medium text-ink'
                        : 'cursor-pointer rounded-xl border border-line bg-surface/60 px-4 py-3'
                    }
                  >
                    {t(`feedbackOutcome_${value}`)}
                  </button>
                ))}
              </div>
              <label className="flex w-full items-center justify-between gap-2 text-sm">
                {t('feedbackHeadcount')}
                <input
                  value={headcount}
                  onChange={(event) => setHeadcount(event.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  className="w-20 rounded-xl border border-line bg-surface px-2 py-2 text-center text-ink"
                />
              </label>
              {/* Disabled until an answer is picked: a send button that does
                  nothing reads as a broken app, not as a missing choice. */}
              <HostButton
                busy={feedback.busy || outcome === null}
                busyLabel={feedback.busy ? t('savingFeedback') : t('sendFeedback')}
                onClick={() =>
                  void feedback.run(async () => {
                    if (!outcome) return
                    await recordFeedback(db, hostUid, sessionId, outcome, Number(headcount) || 0)
                    setFeedbackDone(true)
                  })
                }
                primary
              >
                {t('sendFeedback')}
              </HostButton>
              {feedback.slow && <p className="text-xs text-muted">{t('stillWorking')}</p>}
              {feedback.error && (
                <p role="alert" className="text-xs text-danger">
                  {t('feedbackError')}{' '}
                  <span dir="ltr" className="font-mono">
                    ({feedback.error})
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      )}

      <p className="text-center text-sm text-muted">{t('thanksForPlaying')}</p>
    </div>
  )
}
