import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { ALL_TUTORIAL_KEYS } from '../lib/tutorial'

// jsdom has no layout, and its scrollTo only prints "not implemented".
window.scrollTo = () => {}

// The in-app help opens itself on a first visit. Every suite starts as a
// returning visitor so it never covers a screen under test; the tutorial's
// own tests clear these keys to exercise the first visit.
beforeEach(() => {
  for (const key of ALL_TUTORIAL_KEYS) localStorage.setItem(key, 'seen')
})
