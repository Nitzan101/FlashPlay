import { describe, expect, it } from 'vitest'
import { canonicalUrlFor } from './canonicalHost'

const authDomain = 'flashplay-50bde.firebaseapp.com'

describe('canonicalUrlFor', () => {
  it('sends the .web.app twin to the auth domain, where sign-in actually works', () => {
    expect(canonicalUrlFor('https://flashplay-50bde.web.app/', authDomain)).toBe(
      'https://flashplay-50bde.firebaseapp.com/',
    )
  })

  it('preserves path and query when redirecting, so a join link survives', () => {
    // The product's entry point is a link shared into a WhatsApp group; if
    // this dropped the room code the redirect would be worse than the bug.
    expect(
      canonicalUrlFor('https://flashplay-50bde.web.app/room/ABC?x=1', authDomain),
    ).toBe('https://flashplay-50bde.firebaseapp.com/room/ABC?x=1')
  })

  it('leaves the canonical host alone, so there is no redirect loop', () => {
    expect(canonicalUrlFor('https://flashplay-50bde.firebaseapp.com/', authDomain)).toBeNull()
  })

  it('leaves localhost alone, so dev still works', () => {
    expect(canonicalUrlFor('http://localhost:5173/', authDomain)).toBeNull()
  })
})
