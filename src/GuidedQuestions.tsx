import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROFILE_QUESTIONS } from './content/profileQuestions'
import { db } from './lib/firebase'
import { PROFILE_ANSWER_MAX_LENGTH, type ProfileQuestion } from './lib/model'
import { saveProfileAnswer, useMyProfileAnswers } from './lib/profileQuestions'
import { useAction } from './lib/useAction'

interface GuidedQuestionsProps {
  sessionId: string
  uid: string
  /** This gathering's snapshot of the host's own bank - see
   *  `SessionDoc.customQuestions`. */
  customQuestions: ProfileQuestion[]
}

/**
 * "Tell us about yourself" - milestone 8's self-report half, shown in the
 * lobby while everyone is waiting for the host to start. Optional, and framed
 * as something to fill the wait rather than a gate on it - DESIGN's earlier
 * screens never made a player do anything before the room could move on, and
 * this keeps that.
 *
 * Every question is a **question, not a form** - it has its own answer, its
 * own "did I save this" state, and its own save button. Asked for directly:
 * one shared save would risk keeping a half-typed or since-regretted answer
 * that the player never actually meant to submit, and would leave no way to
 * tell which answers actually landed if the write failed partway through a
 * batch.
 */
/** How many of the built-in questions show before "more questions" is
 *  needed. Twenty exist precisely so different people can find one that
 *  resonates (see the module comment on PROFILE_QUESTIONS) - stacking all
 *  twenty in the lobby by default would turn "pick what flows for you" into
 *  a wall of text competing with the roster and the start-game button for the
 *  same screen. The host's own custom questions are never behind this: they
 *  were added specifically for this gathering, presumably because they
 *  matter more here than the shipped defaults do. */
const DEFAULT_VISIBLE_BUILTINS = 6

export default function GuidedQuestions({ sessionId, uid, customQuestions }: GuidedQuestionsProps) {
  const { t } = useTranslation()
  const allQuestions = [...customQuestions, ...PROFILE_QUESTIONS]
  const { answers, loading } = useMyProfileAnswers(
    sessionId,
    uid,
    allQuestions.map((q) => q.id),
  )
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const hiddenCount = Math.max(0, PROFILE_QUESTIONS.length - DEFAULT_VISIBLE_BUILTINS)
  const visibleQuestions = showAll
    ? allQuestions
    : [...customQuestions, ...PROFILE_QUESTIONS.slice(0, DEFAULT_VISIBLE_BUILTINS)]

  const answeredCount = Object.values(answers).filter((a) =>
    Array.isArray(a) ? a.length > 0 : a.trim() !== '',
  ).length

  if (loading) return null // avoids a flash of empty, unsaved-looking inputs

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between text-start"
      >
        <span className="font-medium text-accent-2">{t('tellUsAboutYourself')}</span>
        <span className="text-xs text-muted">
          {answeredCount}/{allQuestions.length}
        </span>
      </button>
      {open && (
        <>
          <p className="text-xs text-muted">{t('tellUsAboutYourselfHint')}</p>
          <div className="flex flex-col gap-3">
            {visibleQuestions.map((question) => (
              <QuestionRow
                key={question.id}
                sessionId={sessionId}
                uid={uid}
                question={question}
                initialAnswer={answers[question.id]}
              />
            ))}
          </div>
          {!showAll && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="cursor-pointer self-start text-xs text-accent-2 underline decoration-dotted underline-offset-4"
            >
              {t('showMoreQuestions', { count: hiddenCount })}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function QuestionRow({
  sessionId,
  uid,
  question,
  initialAnswer,
}: {
  sessionId: string
  uid: string
  question: ProfileQuestion
  initialAnswer: string | string[] | undefined
}) {
  const { t } = useTranslation()
  const empty = question.kind === 'multi-choice' ? ([] as string[]) : ''
  const [draft, setDraft] = useState<string | string[]>(initialAnswer ?? empty)
  const [saved, setSaved] = useState<string | string[]>(initialAnswer ?? empty)
  const action = useAction()

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const isSaved = !dirty && (Array.isArray(saved) ? saved.length > 0 : saved.trim() !== '')

  async function save() {
    await action.run(async () => {
      await saveProfileAnswer(db, sessionId, uid, question.id, draft)
      setSaved(draft)
    })
  }

  function toggleOption(option: string) {
    const current = Array.isArray(draft) ? draft : []
    setDraft(
      current.includes(option) ? current.filter((o) => o !== option) : [...current, option],
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">{question.text}</p>

      {question.kind === 'text' && (
        <textarea
          value={typeof draft === 'string' ? draft : ''}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('profileAnswerTextPlaceholder')}
          maxLength={PROFILE_ANSWER_MAX_LENGTH}
          rows={2}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
        />
      )}

      {question.kind === 'single-choice' && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={question.text}>
          {question.options?.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={draft === option}
              onClick={() => setDraft(draft === option ? '' : option)}
              className={
                draft === option
                  ? 'cursor-pointer rounded-full border-2 border-accent bg-accent/15 px-3 py-1 text-xs'
                  : 'cursor-pointer rounded-full border border-line bg-surface/60 px-3 py-1 text-xs'
              }
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {question.kind === 'multi-choice' && (
        <div className="flex flex-wrap gap-1.5">
          {question.options?.map((option) => {
            const checked = Array.isArray(draft) && draft.includes(option)
            return (
              <button
                key={option}
                type="button"
                aria-pressed={checked}
                onClick={() => toggleOption(option)}
                className={
                  checked
                    ? 'cursor-pointer rounded-full border-2 border-accent bg-accent/15 px-3 py-1 text-xs'
                    : 'cursor-pointer rounded-full border border-line bg-surface/60 px-3 py-1 text-xs'
                }
              >
                {option}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={action.busy || !dirty}
          onClick={() => void save()}
          aria-label={`${t('saveAnswer')} - ${question.text}`}
          className="cursor-pointer rounded-lg border border-accent-2 px-3 py-1 text-xs text-accent-2 disabled:opacity-40"
        >
          {action.busy ? t('savingAnswer') : t('saveAnswer')}
        </button>
        {isSaved && <span className="text-xs text-accent-3">{t('questionSaved')}</span>}
        {action.error && (
          <span role="alert" className="text-xs text-danger">
            {t('answerSaveError')}
          </span>
        )}
      </div>
    </div>
  )
}
