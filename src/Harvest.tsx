import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HARVEST_PROMPTS } from './content/prompts'
import {
  advanceGamePhase,
  extendGamePhase,
  getSubmissionState,
  submitHarvestItem,
  useHarvestProgress,
} from './lib/harvest'
import { db } from './lib/firebase'
import { ITEM_TEXT_MAX_LENGTH } from './lib/model'
import { errorCode } from './lib/room'

interface HarvestProps {
  sessionId: string
  gameId: string
  promptIds: string[]
  /** Advisory countdown target only - see harvest.ts's module comment. */
  phaseEndsAt: number
  uid: string
  isHost: boolean
}

type AnswerStatus = 'idle' | 'submitting' | 'submitted' | 'error'

interface AnswerState {
  text: string
  status: AnswerStatus
  error?: string
}

/**
 * The harvest phase - milestone 4. Every player (host included, DESIGN: "the
 * host is always a player") answers the same `promptIds`, one item each. A
 * player who joins after this screen is already up is not a special case:
 * DESIGN permits joining during submission, and this component has no
 * opinion about when it was mounted.
 */
export default function Harvest({
  sessionId,
  gameId,
  promptIds,
  phaseEndsAt,
  uid,
  isHost,
}: HarvestProps) {
  const { t } = useTranslation()
  const { submittedCount } = useHarvestProgress(sessionId, gameId)

  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() =>
    Object.fromEntries(promptIds.map((id) => [id, { text: '', status: 'idle' as const }])),
  )
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)),
  )
  const [extendState, setExtendState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [advanceState, setAdvanceState] = useState<'idle' | 'busy' | 'error'>('idle')

  // Purely a display countdown - nothing here or in firestore.rules compares
  // it against anything, so drift from a locked-then-resumed phone just makes
  // the number briefly wrong, never the game. See harvest.ts's module comment.
  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.round((phaseEndsAt - Date.now()) / 1000)))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [phaseEndsAt])

  // Resumes "already submitted" after a refresh or a screen lock - asked of
  // Firestore, not trusted to in-memory state alone, since a reload wipes it.
  // Only a `complete` state counts: a reserved slot whose item never landed
  // must show the input again, or a player whose device died mid-write is
  // told their answer is in when nothing of it exists.
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      promptIds.map(async (promptId) => {
        const state = await getSubmissionState(db, sessionId, gameId, promptId, uid)
        return [promptId, state] as const
      }),
    )
      .then((results) => {
        if (cancelled) return
        setAnswers((prev) => {
          const next = { ...prev }
          for (const [promptId, state] of results) {
            if (state === 'complete') {
              next[promptId] = { text: next[promptId]?.text ?? '', status: 'submitted' }
            }
          }
          return next
        })
      })
      .catch((error: unknown) => {
        // Logged with its code rather than swallowed (the room-code outage's
        // lesson), but not shown: the whole cost of failing to resume is an
        // empty input for a prompt already answered, and submitting into it
        // is harmless - submitHarvestItem returns as soon as it finds the
        // item that slot already points at.
        console.error('[FlashPlay] resuming submitted state failed:', errorCode(error), error)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, gameId, uid, promptIds])

  async function submit(promptId: string) {
    const text = answers[promptId]?.text.trim()
    if (!text) return
    setAnswers((prev) => ({ ...prev, [promptId]: { ...prev[promptId], status: 'submitting' } }))
    try {
      await submitHarvestItem(db, sessionId, gameId, promptId, uid, text)
      setAnswers((prev) => ({ ...prev, [promptId]: { text, status: 'submitted' } }))
    } catch (error) {
      console.error('[FlashPlay] submitHarvestItem failed:', error)
      setAnswers((prev) => ({
        ...prev,
        [promptId]: { ...prev[promptId], status: 'error', error: errorCode(error) },
      }))
    }
  }

  async function extend() {
    setExtendState('busy')
    try {
      await extendGamePhase(db, sessionId, gameId)
      setExtendState('idle')
    } catch (error) {
      console.error('[FlashPlay] extendGamePhase failed:', error)
      setExtendState('error')
    }
  }

  async function continueToRounds() {
    setAdvanceState('busy')
    try {
      await advanceGamePhase(db, sessionId, gameId, 'rounds')
      // No local success state to set - useGame() upstream will see the
      // phase flip and unmount this screen for a rounds one once milestone 5
      // builds it.
    } catch (error) {
      console.error('[FlashPlay] advanceGamePhase failed:', error)
      setAdvanceState('error')
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <p className="text-center">{t('harvestIntro')}</p>
      <p className="text-sm text-muted">
        {secondsLeft > 0 ? t('harvestTimeLeft', { seconds: secondsLeft }) : t('harvestTimeUp')}
      </p>

      {promptIds.map((promptId) => {
        const prompt = HARVEST_PROMPTS.find((p) => p.id === promptId)
        if (!prompt) return null
        const answer = answers[promptId] ?? { text: '', status: 'idle' as const }

        return (
          <form
            key={promptId}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/60 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void submit(promptId)
            }}
          >
            <p className="text-center font-medium">{prompt.text}</p>

            {answer.status === 'submitted' ? (
              <p className="text-accent-3">{t('alreadySubmitted')}</p>
            ) : (
              <>
                <input
                  value={answer.text}
                  onChange={(event) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [promptId]: { ...prev[promptId], text: event.target.value, status: 'idle' },
                    }))
                  }
                  placeholder={t('yourAnswerPlaceholder')}
                  // PUBLIC and shown on every phone the instant it lands - see
                  // ITEM_TEXT_MAX_LENGTH, which firestore.rules enforces too.
                  maxLength={ITEM_TEXT_MAX_LENGTH}
                  enterKeyHint="send"
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
                />
                <button
                  type="submit"
                  disabled={answer.status === 'submitting' || !answer.text.trim()}
                  className="cursor-pointer rounded-xl bg-accent px-4 py-2 font-semibold text-white shadow-[0_0_18px_rgba(255,46,154,0.5)] disabled:opacity-50"
                >
                  {answer.status === 'submitting' ? t('submittingAnswer') : t('submitAnswer')}
                </button>
                {answer.status === 'error' && (
                  <p role="alert" className="text-xs text-danger">
                    {t('submitAnswerError')}{' '}
                    {answer.error && (
                      <span dir="ltr" className="font-mono">
                        ({answer.error})
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </form>
        )
      })}

      <p className="text-muted">{t('harvestProgress', { count: submittedCount })}</p>

      {isHost && (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void extend()}
            disabled={extendState === 'busy'}
            className="cursor-pointer rounded-xl border border-accent-2 px-4 py-2 text-accent-2 disabled:opacity-50"
          >
            {extendState === 'busy' ? t('extendingTime') : t('extendTime')}
          </button>
          {extendState === 'error' && (
            <p role="alert" className="text-xs text-danger">
              {t('extendTimeError')}
            </p>
          )}

          {/* Always enabled, regardless of the countdown or submittedCount -
              DESIGN's host override, and Nitzan's explicit choice (2026-09-08)
              that there is no automatic minimum-submission gate. */}
          <button
            type="button"
            onClick={() => void continueToRounds()}
            disabled={advanceState === 'busy'}
            className="cursor-pointer rounded-xl bg-accent px-4 py-2 font-semibold text-white shadow-[0_0_18px_rgba(255,46,154,0.5)] disabled:opacity-50"
          >
            {advanceState === 'busy' ? t('advancingPhase') : t('continueToRounds')}
          </button>
          {advanceState === 'error' && (
            <p role="alert" className="text-xs text-danger">
              {t('advancePhaseError')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
