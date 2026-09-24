import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HelpButton, TOUR_START_DELAY_MS, TutorialProvider, useScreenTour } from './Tutorial'
import './i18n'
import { HOW_TO_PLAY_KEY, hasSeen, tourSeenKey, type TourId } from './lib/tutorial'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

afterEach(() => {
  vi.useRealTimers()
})

/** A stand-in screen: announces a tour and renders the controls it names. */
function Screen({ tour, targets }: { tour: TourId | null; targets: string[] }) {
  useScreenTour(tour)
  return (
    <div>
      {targets.map((target) => (
        <button key={target} type="button" data-tour={target}>
          {target}
        </button>
      ))}
    </div>
  )
}

const PERSON_TARGETS = ['person-facts', 'person-questions', 'back-to-group']

function renderApp(screenProps: { tour: TourId | null; targets: string[] } = { tour: null, targets: [] }) {
  return render(
    <TutorialProvider>
      <HelpButton />
      <Screen {...screenProps} />
    </TutorialProvider>,
  )
}

const dialogTitle = () => screen.queryByRole('dialog')?.querySelector('h2, [id$="-title"]')?.textContent

describe('how to play', () => {
  it('opens by itself on a first visit, and not again once skipped', () => {
    localStorage.removeItem(HOW_TO_PLAY_KEY)
    const { unmount } = renderApp()

    expect(dialogTitle()).toBe('מה זה FlashPlay?')
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(dialogTitle()).toBe('איך נכנסים')

    fireEvent.click(screen.getByRole('button', { name: 'דילוג' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(hasSeen(HOW_TO_PLAY_KEY)).toBe(true)

    unmount()
    renderApp()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('goes through every card, back and forth, and finishes on the last', () => {
    localStorage.removeItem(HOW_TO_PLAY_KEY)
    renderApp()

    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(dialogTitle()).toBe('בסוף הערב')
    fireEvent.click(screen.getByRole('button', { name: 'הקודם' }))
    expect(dialogTitle()).toBe('מי שמארח/ת מנהל/ת את הקצב')
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))

    fireEvent.click(screen.getByRole('button', { name: 'יאללה, משחקים' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reopens from the "?" button whenever asked', () => {
    renderApp()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // No tour on this screen, so "?" goes straight to the rules.
    fireEvent.click(screen.getByRole('button', { name: 'עזרה' }))

    expect(dialogTitle()).toBe('מה זה FlashPlay?')
  })
})

describe('a screen tour', () => {
  it('starts by itself the first time the screen is reached, and walks its stops', () => {
    vi.useFakeTimers()
    localStorage.removeItem(tourSeenKey('person'))
    const { unmount } = renderApp({ tour: 'person', targets: PERSON_TARGETS })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(TOUR_START_DELAY_MS))

    expect(dialogTitle()).toBe('מה שנשמר')
    expect(screen.getByText('1 מתוך 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(dialogTitle()).toBe('השאלות המנחות')
    fireEvent.click(screen.getByRole('button', { name: 'הקודם' }))
    expect(dialogTitle()).toBe('מה שנשמר')
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    fireEvent.click(screen.getByRole('button', { name: 'סיום' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(hasSeen(tourSeenKey('person'))).toBe(true)

    unmount()
    renderApp({ tour: 'person', targets: PERSON_TARGETS })
    act(() => vi.advanceTimersByTime(TOUR_START_DELAY_MS * 2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves out a stop whose control is not on screen', () => {
    vi.useFakeTimers()
    localStorage.removeItem(tourSeenKey('person'))
    renderApp({ tour: 'person', targets: ['person-facts', 'back-to-group'] })
    act(() => vi.advanceTimersByTime(TOUR_START_DELAY_MS))

    expect(screen.getByText('1 מתוך 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(dialogTitle()).toBe('חזרה')
  })

  // A first-time visitor gets the rules first and the buttons after - never
  // both overlays at once.
  it('waits for "how to play" to be closed on a first visit', () => {
    vi.useFakeTimers()
    localStorage.removeItem(HOW_TO_PLAY_KEY)
    localStorage.removeItem(tourSeenKey('person'))
    renderApp({ tour: 'person', targets: PERSON_TARGETS })
    act(() => vi.advanceTimersByTime(TOUR_START_DELAY_MS * 2))
    expect(dialogTitle()).toBe('מה זה FlashPlay?')

    fireEvent.click(screen.getByRole('button', { name: 'דילוג' }))
    act(() => vi.advanceTimersByTime(TOUR_START_DELAY_MS))

    expect(dialogTitle()).toBe('מה שנשמר')
  })

  it('is offered from the "?" menu on a screen that has one', () => {
    renderApp({ tour: 'person', targets: PERSON_TARGETS })

    fireEvent.click(screen.getByRole('button', { name: 'עזרה' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'סיור בכפתורים במסך הזה' }))

    expect(dialogTitle()).toBe('מה שנשמר')
  })

  // The host starting the game unmounts the lobby under a guest's open tour.
  it('closes when its screen goes away', () => {
    const { rerender } = renderApp({ tour: 'person', targets: PERSON_TARGETS })
    fireEvent.click(screen.getByRole('button', { name: 'עזרה' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'סיור בכפתורים במסך הזה' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(
      <TutorialProvider>
        <HelpButton />
        <Screen tour={null} targets={[]} />
      </TutorialProvider>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
