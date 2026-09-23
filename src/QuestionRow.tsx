import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROFILE_ANSWER_MAX_LENGTH, type ProfileQuestion } from './lib/model'
import { useAction } from './lib/useAction'
import { useFlash } from './lib/useFlash'

export type Answer = string | string[]

interface Selection {
  text: string
  picked: string[]
  customOn: boolean
  customText: string
}

/** The answer a selection currently stands for. Always derived, never stored
 *  alongside the selection - a second copy is what drifted out of sync in the
 *  first "אחר" version and made saving "sometimes possible and sometimes not". */
function composeAnswer(kind: ProfileQuestion['kind'], selection: Selection): Answer {
  if (kind === 'text') return selection.text.trim()
  const custom = selection.customOn ? selection.customText.trim() : ''
  if (kind === 'single-choice') return custom || selection.picked[0] || ''
  return custom ? [...selection.picked, custom] : [...selection.picked]
}

function sameAnswer(a: Answer, b: Answer): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
  }
  return a === b
}

function initialSelection(question: ProfileQuestion, answer: Answer | undefined): Selection {
  if (question.kind === 'text') {
    return { text: typeof answer === 'string' ? answer : '', picked: [], customOn: false, customText: '' }
  }
  const options = question.options ?? []
  const values = (answer === undefined ? [] : Array.isArray(answer) ? answer : [answer])
    .map((value) => value.trim())
    .filter((value) => value !== '')
  const picked = values.filter((value) => options.includes(value))
  const customText = values.filter((value) => !options.includes(value)).join(', ')
  return {
    text: '',
    picked: question.kind === 'single-choice' ? picked.slice(0, 1) : picked,
    customOn: customText !== '',
    customText,
  }
}

const CHIP = 'cursor-pointer rounded-full border border-line bg-surface/60 px-3 py-1 text-xs'
const CHIP_ON = 'cursor-pointer rounded-full border-2 border-accent bg-accent/15 px-3 py-1 text-xs'

/**
 * One guided question with its own answer, save button and "saved" notice -
 * shared by the lobby (a player about themselves) and the group's details
 * screen (the host about one person), so both show choice questions as the
 * same tappable options. The details screen used a plain text field with the
 * options squeezed into its placeholder, which cut most of them off; asked
 * directly why it wasn't "אמריקאי" like the lobby, 2026-09-23.
 *
 * **"אחר" is a real toggle that remembers its text.** Tapping it again turns
 * it off (and, in a single-choice question, picking another option does too);
 * tapping it once more brings back what was typed. Its box is shown only while
 * it is on. Two earlier versions each fixed one half of this and broke the
 * other: the first threw the text away on toggling off, the second could never
 * be turned off at all.
 */
export default function QuestionRow({
  question,
  initialAnswer,
  onSave,
}: {
  question: ProfileQuestion
  initialAnswer: Answer | undefined
  onSave: (answer: Answer) => Promise<void>
}) {
  const { t } = useTranslation()
  const options = question.options ?? []
  const stored = composeAnswer(question.kind, initialSelection(question, initialAnswer))
  const [selection, setSelection] = useState(() => initialSelection(question, initialAnswer))
  const [saved, setSaved] = useState<Answer>(stored)

  // The stored answer can change under this row - on the details screen the
  // host can delete the same fact from the person's list. When it changes to
  // something this row did not save itself, adopt it; otherwise the field kept
  // showing the deleted answer as "saved", with no way to save it again.
  // Found live, 2026-09-23. A change this row caused (its own save coming
  // back) is left alone, so it cannot wipe what is still on screen.
  const [lastStored, setLastStored] = useState<Answer>(stored)
  if (!sameAnswer(stored, lastStored)) {
    setLastStored(stored)
    if (!sameAnswer(stored, saved)) {
      setSelection(initialSelection(question, initialAnswer))
      setSaved(stored)
    }
  }
  // Focus the "אחר" box only when a tap just opened it - not when it opens
  // already filled on first render, which would pull focus down the lobby.
  const [focusCustom, setFocusCustom] = useState(false)
  const action = useAction()
  const savedNotice = useFlash()

  const answer = composeAnswer(question.kind, selection)
  const dirty = !sameAnswer(answer, saved)
  const customMissingText = selection.customOn && selection.customText.trim() === ''

  function pickOption(option: string) {
    setSelection((current) => {
      if (question.kind === 'single-choice') {
        return current.picked[0] === option
          ? { ...current, picked: [] }
          : { ...current, picked: [option], customOn: false }
      }
      return {
        ...current,
        picked: current.picked.includes(option)
          ? current.picked.filter((o) => o !== option)
          : [...current.picked, option],
      }
    })
  }

  function toggleCustom() {
    setFocusCustom(!selection.customOn)
    setSelection((current) =>
      current.customOn
        ? { ...current, customOn: false }
        : {
            ...current,
            customOn: true,
            picked: question.kind === 'single-choice' ? [] : current.picked,
          },
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-start text-sm">{question.text}</p>

      {question.kind === 'text' ? (
        <textarea
          value={selection.text}
          onChange={(event) => {
            const text = event.target.value
            setSelection((current) => ({ ...current, text }))
          }}
          placeholder={t('profileAnswerTextPlaceholder')}
          maxLength={PROFILE_ANSWER_MAX_LENGTH}
          rows={2}
          aria-label={question.text}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
        />
      ) : (
        <>
          <div
            className="flex flex-wrap gap-1.5"
            role={question.kind === 'single-choice' ? 'radiogroup' : 'group'}
            aria-label={question.text}
          >
            {options.map((option) => {
              const on = selection.picked.includes(option)
              return (
                <button
                  key={option}
                  type="button"
                  {...(question.kind === 'single-choice'
                    ? { role: 'radio', 'aria-checked': on }
                    : { 'aria-pressed': on })}
                  onClick={() => pickOption(option)}
                  className={on ? CHIP_ON : CHIP}
                >
                  {option}
                </button>
              )
            })}
            <button
              type="button"
              {...(question.kind === 'single-choice'
                ? { role: 'radio', 'aria-checked': selection.customOn }
                : { 'aria-pressed': selection.customOn })}
              onClick={toggleCustom}
              className={selection.customOn ? CHIP_ON : CHIP}
            >
              {t('otherOption')}
            </button>
          </div>
          {selection.customOn && (
            <input
              value={selection.customText}
              onChange={(event) => {
                const customText = event.target.value
                setSelection((current) => ({ ...current, customText }))
              }}
              placeholder={t('otherOptionPlaceholder')}
              maxLength={PROFILE_ANSWER_MAX_LENGTH}
              autoFocus={focusCustom}
              aria-label={`${t('otherOption')} - ${question.text}`}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          )}
        </>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          // "אחר" switched on with nothing written in it is not an answer yet -
          // saving it would silently store the other options alone (or, in a
          // single-choice question, clear the answer).
          disabled={action.busy || !dirty || customMissingText}
          onClick={() =>
            void action.run(async () => {
              await onSave(answer)
              setSaved(answer)
              savedNotice.flash()
            })
          }
          aria-label={`${t('saveAnswer')} - ${question.text}`}
          className="cursor-pointer rounded-lg border border-accent-2 px-3 py-1 text-xs text-accent-2 disabled:opacity-40"
        >
          {action.busy ? t('savingAnswer') : t('saveAnswer')}
        </button>
        {savedNotice.on && !dirty && (
          <span className="text-xs text-accent-3">{t('questionSaved')}</span>
        )}
        {action.error && (
          <span role="alert" className="text-xs text-danger">
            {t('answerSaveError')}
          </span>
        )}
      </div>
    </div>
  )
}
