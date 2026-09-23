import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import QuestionRow from './QuestionRow'
import { PROFILE_QUESTIONS } from './content/profileQuestions'
import { db } from './lib/firebase'
import type { ProfileQuestion } from './lib/model'
import { saveProfileAnswer, useMyProfileAnswers } from './lib/profileQuestions'

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
/** The free-paragraph built-in ("משהו כללי שתרצה/י לספר על עצמך") is always
 *  shown, never subject to the random reveal below - it is the direct answer
 *  to DESIGN's own "a free paragraph" requirement, not one option among many,
 *  and a random shuffle hiding it defeats the point of it being there at all.
 *  Asked about directly, 2026-09-22: "לא ראיתי אפשרות לפסקה חופשית... בתוך
 *  המשחק" turned out to be exactly this - it simply hadn't been drawn into
 *  the first six. */
const ALWAYS_VISIBLE_BUILTIN_IDS = new Set(['general'])

/** How many of the built-in questions show before "more questions" is
 *  needed, and how many more each tap of that button reveals. The bank is
 *  large precisely so different people can find one that resonates (see the
 *  module comment on PROFILE_QUESTIONS) - stacking all of it in the lobby by
 *  default would turn "pick what flows for you" into a wall of text
 *  competing with the roster and the start-game button for the same screen.
 *  Asked for directly: "בטעינת שאלות נוספות הוספת עוד כמה מלמטה" - a few more
 *  each time, not everything at once. The host's own custom questions are
 *  never behind this: they were added specifically for this gathering,
 *  presumably because they matter more here than the shipped defaults do. */
const DEFAULT_VISIBLE_BUILTINS = 6
const REVEAL_BATCH_SIZE = 8

/** A pure Fisher-Yates shuffle - never mutates its input, so the shipped
 *  content array stays stable across calls. */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function isAnswered(answer: string | string[] | undefined): boolean {
  if (answer === undefined) return false
  return Array.isArray(answer) ? answer.length > 0 : answer.trim() !== ''
}

export default function GuidedQuestions({ sessionId, uid, customQuestions }: GuidedQuestionsProps) {
  const { t } = useTranslation()
  // Shuffled together, once per mount (a different order per gathering, not a
  // reshuffle on every render) - see REVEAL_BATCH_SIZE's comment for why a
  // random subset is the point. The host's own questions used to be
  // concatenated in front of the shuffled built-ins, which always put them
  // first rather than mixed in - reported directly, 2026-09-22: "שאלה
  // שהוספתי תמיד מופיעה ראשונה ולא מערובבת עם האחרות". Being *pinned*
  // (never hidden behind "more") and being *first* are different things; only
  // the first was ever the point.
  const [allQuestions] = useState(() => shuffled([...customQuestions, ...PROFILE_QUESTIONS]))
  const customQuestionIds = new Set(customQuestions.map((q) => q.id))
  const { answers, loading } = useMyProfileAnswers(
    sessionId,
    uid,
    allQuestions.map((q) => q.id),
  )
  const [open, setOpen] = useState(true)
  const [revealCount, setRevealCount] = useState(DEFAULT_VISIBLE_BUILTINS)

  const answeredCount = Object.values(answers).filter(isAnswered).length

  if (loading) return null // avoids a flash of empty, unsaved-looking inputs

  // Pinned - always shown, wherever the shuffle put them: the host's own
  // questions (added specifically for this gathering), the free-paragraph
  // built-in (see ALWAYS_VISIBLE_BUILTIN_IDS), and anything already answered
  // (so editing a saved answer is never a step behind a "more" tap). Only the
  // rest is subject to the reveal count.
  const isPinned = (q: ProfileQuestion) =>
    customQuestionIds.has(q.id) || ALWAYS_VISIBLE_BUILTIN_IDS.has(q.id) || isAnswered(answers[q.id])
  const unpinned = allQuestions.filter((q) => !isPinned(q))
  const hiddenUnpinned = unpinned.slice(revealCount)
  const hiddenIds = new Set(hiddenUnpinned.map((q) => q.id))
  const visibleQuestions = allQuestions.filter((q) => !hiddenIds.has(q.id))
  const hiddenCount = hiddenUnpinned.length

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
                question={question}
                initialAnswer={answers[question.id]}
                onSave={(answer) => saveProfileAnswer(db, sessionId, uid, question.id, answer)}
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setRevealCount((count) => count + REVEAL_BATCH_SIZE)}
              className="cursor-pointer self-start text-xs text-accent-2 underline decoration-dotted underline-offset-4"
            >
              {t('showMoreQuestions', { count: Math.min(hiddenCount, REVEAL_BATCH_SIZE) })}
            </button>
          )}
        </>
      )}
    </div>
  )
}
