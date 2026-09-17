import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GuidedQuestions from './GuidedQuestions'
import { PROFILE_QUESTIONS } from './content/profileQuestions'
import './i18n'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))
vi.mock('./lib/profileQuestions', () => ({
  useMyProfileAnswers: () => ({ answers: {}, loading: false }),
  saveProfileAnswer: vi.fn(),
}))

// Milestone 8, expanded from six to twenty: "everyone answers whatever comes
// to mind or flows for them" only works as real choice if the bank has real
// variety - but twenty questions stacked in the lobby by default would be a
// wall of text competing with the roster and the start-game button.
describe('GuidedQuestions - showing more without overwhelming the lobby', () => {
  it('shows only a handful of built-ins at first, with the rest behind a button', () => {
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)

    expect(screen.getByText(PROFILE_QUESTIONS[0].text)).toBeInTheDocument()
    expect(screen.queryByText(PROFILE_QUESTIONS[PROFILE_QUESTIONS.length - 1].text)).not
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: /עוד \d+ שאלות/ })).toBeInTheDocument()
  })

  it('reveals every remaining built-in question once "more" is tapped', () => {
    render(<GuidedQuestions sessionId="s1" uid="u1" customQuestions={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /עוד \d+ שאלות/ }))

    expect(
      screen.getByText(PROFILE_QUESTIONS[PROFILE_QUESTIONS.length - 1].text),
    ).toBeInTheDocument()
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
