/**
 * Structural guards for the harvest prompt pool.
 *
 * The three prompt rules from DESIGN.md - behaviour not opinion, answerable
 * in thirty seconds by a nine-year-old, no common answer - are judgements and
 * cannot be asserted here; milestone 0's gate reviews those by reading. What
 * a test CAN hold is everything mechanical, so that the pool cannot rot
 * quietly: the right size, no duplicate ids, nothing empty, nothing that is
 * not actually Hebrew, and nothing so long it will not fit a phone.
 */
import { describe, expect, it } from 'vitest'
import {
  HARVEST_PROMPTS,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  PROMPTS_PER_GATHERING,
} from './prompts'

/** Long enough to be a real prompt, short enough to read on a narrow phone
 *  screen without wrapping into a paragraph. */
const MAX_PROMPT_CHARS = 60

describe('the harvest prompt pool', () => {
  it('holds the 15-20 prompts DESIGN requires', () => {
    expect(HARVEST_PROMPTS.length).toBeGreaterThanOrEqual(MIN_POOL_SIZE)
    expect(HARVEST_PROMPTS.length).toBeLessThanOrEqual(MAX_POOL_SIZE)
  })

  it('has a unique id for every prompt', () => {
    // Ids end up in FactDoc.promptId, which is what says where a stored fact
    // came from - a duplicate would silently merge two prompts' history.
    const ids = HARVEST_PROMPTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses kebab-case ids, so they read the same everywhere they appear', () => {
    for (const prompt of HARVEST_PROMPTS) {
      expect(prompt.id).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it('is written in Hebrew, with no stray placeholder left in', () => {
    // This file is the one place Hebrew is correct rather than a policy
    // violation, so an English prompt here is a mistake, not a translation.
    for (const prompt of HARVEST_PROMPTS) {
      expect(prompt.text.trim()).not.toBe('')
      expect(prompt.text).toMatch(/\p{Script=Hebrew}/u)
      expect(prompt.text).not.toMatch(/[A-Za-z]/)
    }
  })

  it('keeps every prompt short enough to read on a phone', () => {
    for (const prompt of HARVEST_PROMPTS) {
      expect(prompt.text.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS)
    }
  })

  it('has no leading or trailing whitespace and no trailing punctuation', () => {
    // These are read aloud by the host and shown as a heading, so a stray
    // full stop or question mark reads as a typo on eleven screens at once.
    for (const prompt of HARVEST_PROMPTS) {
      expect(prompt.text).toBe(prompt.text.trim())
      expect(prompt.text).not.toMatch(/[.?!,;:]$/)
    }
  })

  it('collects only personal facts, for now', () => {
    // Both first-slice games need an item attributable to one named person.
    // A group fact cannot be re-asked as "who is most likely to do that", so
    // adding a group-drawer prompt is a design decision that should fail here
    // and be made deliberately rather than slipped in.
    for (const prompt of HARVEST_PROMPTS) {
      expect(prompt.drawer).toBe('personal')
    }
  })

  it('has enough prompts to run a gathering without repeating one', () => {
    expect(HARVEST_PROMPTS.length).toBeGreaterThan(PROMPTS_PER_GATHERING)
  })
})
