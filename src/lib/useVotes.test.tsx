import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

type Next = (snap: { docs: { id: string; data: () => { votedForPlayerId: string } }[] }) => void
type Fail = (error: { code: string }) => void
const subscriptions: { next: Next; fail: Fail; unsubscribe: ReturnType<typeof vi.fn> }[] = []

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore')
  return {
    ...actual,
    collection: vi.fn(() => ({})),
    onSnapshot: vi.fn((_ref: unknown, next: Next, fail: Fail) => {
      const unsubscribe = vi.fn()
      subscriptions.push({ next, fail, unsubscribe })
      return unsubscribe
    }),
  }
})

import { useVotes } from './rounds'

beforeEach(() => {
  subscriptions.length = 0
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.useRealTimers())

describe('useVotes', () => {
  // The host sees the reveal from its own pending write before the server has
  // it, so the first subscription can be refused for a moment.
  it('retries a refused subscription instead of showing the error at once', () => {
    const { result } = renderHook(() => useVotes('s1', 'r1', true))

    act(() => subscriptions[0].fail({ code: 'permission-denied' }))
    expect(result.current.error).toBeNull()

    act(() => vi.advanceTimersByTime(600))
    expect(subscriptions).toHaveLength(2)
    act(() =>
      subscriptions[1].next({ docs: [{ id: 'p1', data: () => ({ votedForPlayerId: 'p2' }) }] }),
    )
    expect(result.current.votes).toEqual({ p1: 'p2' })
    expect(result.current.error).toBeNull()
  })

  it('gives up and reports the error once the retries run out', () => {
    const { result } = renderHook(() => useVotes('s1', 'r1', true))

    for (let i = 0; i < 5; i++) {
      act(() => subscriptions[subscriptions.length - 1].fail({ code: 'permission-denied' }))
      act(() => vi.advanceTimersByTime(5000))
    }

    expect(result.current.error).toBe('permission-denied')
  })
})
