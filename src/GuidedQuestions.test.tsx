import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GuidedQuestions from './GuidedQuestions'
import { PROFILE_QUESTIONS } from './content/profileQuestions'
import './i18n'
import { SAVED_NOTICE_MS } from './lib/useFlash'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))
const mockUseMyProfileAnswers = vi.fn()
const mockSaveProfileAnswer = vi.fn().mockResolvedValue(undefined)
vi.mock('./lib/profileQuestions', () => ({
  useMyProfileAnswers: (...args: unknown[]) => mockUseMyProfileAnswers(...args) as unknown,
  saveProfileAnswer: (...args: unknown[]) => mockSaveProfileAnswer(...args) as unknown,
}))

/** How many `<p>` question labels are on screen - counts questions rendered,
 *  regardless of which ones a random shuffle happened to pick this run. */
function visibleQuestionCount(): number {
  return PROFILE_QUESTIONS.filter((q) => screen.queryByText(q.text)).length
}

// Milestone 8, expanded from six to a much larger bank: "everyone answers
// whatever comes to mind or flows for them" only works as real choice if the
// bank has real variety and a different subset shows each time - but the
// whole bank stacked in the lobby by default would be a wall of text
// competing with the roster and the start-game button.
describe('GuidedQuestions - showing more without overwhelming the lobby', () => {
  beforeEach(() => {
    mockUseMyProfileAnswers.mockReturnValue({ answers: {}, loading: false })
  })

  // +1 throughout: the free-paragraph built-in ('general') is pinned always
  // visible (ALWAYS_VISIBLE_BUILTIN_IDS), on top of the 6/14 unpinned ones
  // the reveal count actually governs.
  it('shows only a handful of built-ins at first, with the rest behind a button', () => {
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)

    expect(visibleQuestionCount()).toBe(7)
    expect(screen.getByRole('button', { name: /עוד \d+ שאלות/ })).toBeInTheDocument()
  })

  it('reveals a further batch, not the whole bank, on "more"', () => {
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /עוד \d+ שאלות/ }))

    // 6 to start, 8 more revealed - some, not everything (the bank has far
    // more than 14 questions).
    expect(visibleQuestionCount()).toBe(15)
    expect(screen.getByRole('button', { name: /עוד \d+ שאלות/ })).toBeInTheDocument()
  })

  it('eventually reveals every built-in once "more" is tapped enough times', () => {
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)

    for (let i = 0; i < 10; i++) {
      const more = screen.queryByRole('button', { name: /עוד \d+ שאלות/ })
      if (!more) break
      fireEvent.click(more)
    }

    expect(visibleQuestionCount()).toBe(PROFILE_QUESTIONS.length)
    expect(screen.queryByRole('button', { name: /עוד \d+ שאלות/ })).not.toBeInTheDocument()
  })

  it("a host's own custom questions are visible immediately, never behind the 'more' button", () => {
    render(
      <GuidedQuestions
        sessionId="s1"
        uid="u1"
        customQuestions={[{ id: 'c1', text: 'שאלה של המארח', kind: 'text' }]}
      />,
    )

    expect(screen.getByText('שאלה של המארח')).toBeInTheDocument()
  })

  it('the answered-count badge reflects every question, including ones not yet shown', () => {
    render(
      <GuidedQuestions
        sessionId="s1"
        uid="u1"
        customQuestions={[{ id: 'c1', text: 'שאלה של המארח', kind: 'text' }]}
      />,
    )

    expect(screen.getByText(`0/${PROFILE_QUESTIONS.length + 1}`)).toBeInTheDocument()
  })
})

// Milestone 8's original limitation, fixed 2026-09-22: an already-answered
// question used to be able to fall behind the "more" button in the shuffle,
// hiding a saved answer the player would reasonably expect to still see and
// edit.
describe('GuidedQuestions - an already-answered question is never hidden', () => {
  it('shows an answered built-in even when it would otherwise be behind "more"', () => {
    // Answer every single-choice question there is - guaranteed to include at
    // least one that a random shuffle would otherwise have hidden behind the
    // default 6, since the bank has far more than 6 questions.
    const answers: Record<string, string> = {}
    for (const q of PROFILE_QUESTIONS) if (q.kind === 'text') answers[q.id] = 'תשובה'
    mockUseMyProfileAnswers.mockReturnValue({ answers, loading: false })

    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)

    for (const q of PROFILE_QUESTIONS) {
      if (q.kind === 'text') expect(screen.getByText(q.text)).toBeInTheDocument()
    }
  })
})

// Both reported 2026-09-22, after the random order first shipped.
describe('GuidedQuestions - what is pinned, and where it lands', () => {
  beforeEach(() => {
    mockUseMyProfileAnswers.mockReturnValue({ answers: {}, loading: false })
  })

  it('always shows the free-paragraph question, whatever the shuffle drew', () => {
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)

    expect(screen.getByText('משהו כללי שתרצה/י לספר על עצמך')).toBeInTheDocument()
  })

  // "שאלה שהוספתי תמיד מופיעה ראשונה ולא מערובבת עם האחרות" - the host's own
  // questions used to be concatenated in front of the shuffle. With
  // Math.random pinned at 0, Fisher-Yates swaps the first element to the very
  // end, so a question that is still first here was never shuffled at all.
  it("mixes the host's own question into the shuffle instead of pinning it first", () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      render(
        <GuidedQuestions
          sessionId="s1"
          uid="u1"
          customQuestions={[{ id: 'c1', text: 'שאלה של המארח', kind: 'text' }]}
        />,
      )
      const custom = screen.getByText('שאלה של המארח')
      const general = screen.getByText('משהו כללי שתרצה/י לספר על עצמך')

      expect(custom.compareDocumentPosition(general) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    } finally {
      random.mockRestore()
    }
  })
})

// Asked for directly: "באופציות מרובות בחירה תוסיף אפשרות 'אחר: ' עם אופציה
// לכתוב." - a fixed option list should never be a dead end.
describe('GuidedQuestions - an "אחר" option for choice questions', () => {
  const singleChoiceQuestion = PROFILE_QUESTIONS.find((q) => q.kind === 'single-choice')!
  const multiChoiceQuestion = PROFILE_QUESTIONS.find((q) => q.kind === 'multi-choice')!

  beforeEach(() => {
    mockUseMyProfileAnswers.mockReturnValue({ answers: {}, loading: false })
    mockSaveProfileAnswer.mockClear()
  })

  it('lets a single-choice answer be free text instead of one of the options', async () => {
    mockUseMyProfileAnswers.mockReturnValue({
      // A real option, purely to guarantee this question is visible (an
      // answered question is never hidden behind "more") without also
      // pre-opening the custom box, which a non-option value would.
      answers: { [singleChoiceQuestion.id]: singleChoiceQuestion.options![0] },
      loading: false,
    })
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)
    const row = within(screen.getByText(singleChoiceQuestion.text).parentElement!)

    fireEvent.click(row.getByRole('radio', { name: 'אחר' }))
    fireEvent.change(row.getByPlaceholderText('פירוט...'), { target: { value: 'תשובה משלי' } })
    fireEvent.click(row.getByRole('button', { name: /שמירה/ }))

    await waitFor(() =>
      expect(mockSaveProfileAnswer).toHaveBeenCalledWith(
        expect.anything(),
        's1',
        'u1',
        singleChoiceQuestion.id,
        'תשובה משלי',
      ),
    )
  })

  it('lets a multi-choice answer include free text alongside the fixed options', async () => {
    mockUseMyProfileAnswers.mockReturnValue({
      // A different real option than the one this test selects, purely to
      // guarantee visibility without pre-opening the custom box.
      answers: { [multiChoiceQuestion.id]: [multiChoiceQuestion.options![1]] },
      loading: false,
    })
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)
    const row = within(screen.getByText(multiChoiceQuestion.text).parentElement!)

    fireEvent.click(row.getByRole('button', { name: multiChoiceQuestion.options![0] }))
    fireEvent.click(row.getByRole('button', { name: 'אחר' }))
    fireEvent.change(row.getByPlaceholderText('פירוט...'), { target: { value: 'תשובה משלי' } })
    fireEvent.click(row.getByRole('button', { name: /שמירה/ }))

    await waitFor(() =>
      expect(mockSaveProfileAnswer).toHaveBeenCalledWith(
        expect.anything(),
        's1',
        'u1',
        multiChoiceQuestion.id,
        expect.arrayContaining([multiChoiceQuestion.options![0], 'תשובה משלי']),
      ),
    )
  })

  // Two reports, one on each side: "אם מורידים ולוחצים נעלם מה שכתבו בו"
  // (2026-09-22 - turning it off threw the text away), then "בלחיצה על 'אחר'
  // לא ניתן יותר לבטל אותו" (2026-09-23 - the fix made it impossible to turn
  // off at all). It has to be a real toggle that remembers its text.
  it('turns "אחר" off on a second tap, and brings the text back on a third', () => {
    mockUseMyProfileAnswers.mockReturnValue({
      answers: { [multiChoiceQuestion.id]: [multiChoiceQuestion.options![1]] },
      loading: false,
    })
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)
    const row = within(screen.getByText(multiChoiceQuestion.text).parentElement!)
    const other = row.getByRole('button', { name: 'אחר' })

    fireEvent.click(other)
    fireEvent.change(row.getByPlaceholderText('פירוט...'), { target: { value: 'תשובה משלי' } })
    fireEvent.click(other)

    expect(other).toHaveAttribute('aria-pressed', 'false')
    expect(row.queryByPlaceholderText('פירוט...')).not.toBeInTheDocument()

    fireEvent.click(other)

    expect(other).toHaveAttribute('aria-pressed', 'true')
    expect(row.getByPlaceholderText('פירוט...')).toHaveValue('תשובה משלי')
  })

  it('leaves the text out of a multi-choice answer once "אחר" is off', async () => {
    mockUseMyProfileAnswers.mockReturnValue({
      answers: { [multiChoiceQuestion.id]: [multiChoiceQuestion.options![1], 'ישן'] },
      loading: false,
    })
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)
    const row = within(screen.getByText(multiChoiceQuestion.text).parentElement!)

    // A saved answer outside the options opens with "אחר" already on.
    expect(row.getByRole('button', { name: 'אחר' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(row.getByRole('button', { name: 'אחר' }))
    fireEvent.click(row.getByRole('button', { name: /שמירה/ }))

    await waitFor(() =>
      expect(mockSaveProfileAnswer).toHaveBeenCalledWith(
        expect.anything(),
        's1',
        'u1',
        multiChoiceQuestion.id,
        [multiChoiceQuestion.options![1]],
      ),
    )
  })

  // "כשזה חד-בחירה ומעבירים ממנו אי אפשר לסמן אותו בחזרה אלא רק עובר אליו
  // אוטומטית בהקלדה" - moving to another option and back has to work by tap.
  it('lets a single-choice "אחר" be picked again by tap after choosing another option', async () => {
    mockUseMyProfileAnswers.mockReturnValue({
      answers: { [singleChoiceQuestion.id]: singleChoiceQuestion.options![0] },
      loading: false,
    })
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)
    const row = within(screen.getByText(singleChoiceQuestion.text).parentElement!)
    const other = row.getByRole('radio', { name: 'אחר' })

    fireEvent.click(other)
    fireEvent.change(row.getByPlaceholderText('פירוט...'), { target: { value: 'תשובה משלי' } })
    fireEvent.click(row.getByRole('radio', { name: singleChoiceQuestion.options![1] }))
    expect(other).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(other)

    expect(other).toHaveAttribute('aria-checked', 'true')
    expect(row.getByRole('radio', { name: singleChoiceQuestion.options![1] })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    fireEvent.click(row.getByRole('button', { name: /שמירה/ }))
    await waitFor(() =>
      expect(mockSaveProfileAnswer).toHaveBeenCalledWith(
        expect.anything(),
        's1',
        'u1',
        singleChoiceQuestion.id,
        'תשובה משלי',
      ),
    )
  })

  it('cannot save "אחר" switched on with nothing written in it', () => {
    mockUseMyProfileAnswers.mockReturnValue({
      answers: { [singleChoiceQuestion.id]: singleChoiceQuestion.options![0] },
      loading: false,
    })
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)
    const row = within(screen.getByText(singleChoiceQuestion.text).parentElement!)

    fireEvent.click(row.getByRole('radio', { name: 'אחר' }))

    expect(row.getByRole('button', { name: /שמירה/ })).toBeDisabled()
  })
})

// Asked for directly, 2026-09-23: "נשמר" should acknowledge a save and then
// go away, not sit there indefinitely.
describe('GuidedQuestions - the "saved" notice', () => {
  const custom = { id: 'c1', text: 'שאלה של המארח', kind: 'text' as const }

  it('shows only after a save, and clears a few seconds later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mockUseMyProfileAnswers.mockReturnValue({ answers: { c1: 'תשובה קודמת' }, loading: false })
      render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[custom]} />)
      const row = within(screen.getByText(custom.text).parentElement!)

      // An answer that was already there is not a save that just happened.
      expect(row.queryByText('נשמר ✓')).not.toBeInTheDocument()

      fireEvent.change(row.getByRole('textbox'), { target: { value: 'תשובה חדשה' } })
      fireEvent.click(row.getByRole('button', { name: 'שמירה - שאלה של המארח' }))
      expect(await row.findByText('נשמר ✓')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(SAVED_NOTICE_MS))
      expect(row.queryByText('נשמר ✓')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
