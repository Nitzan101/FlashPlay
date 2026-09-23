import { useEffect, useRef, useState } from 'react'

/** How long a "saved ✓" confirmation stays on screen after a save. */
export const SAVED_NOTICE_MS = 3000

/**
 * A flag that turns itself off: `flash()` sets it for `ms`, then it clears.
 * Calling `flash()` again restarts the countdown rather than stacking timers.
 * For a confirmation that should acknowledge an action and then get out of
 * the way - asked for directly about "נשמר ✓", 2026-09-23, which used to stay
 * on screen indefinitely.
 */
export function useFlash(ms: number = SAVED_NOTICE_MS): { on: boolean; flash: () => void } {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  function flash() {
    clearTimeout(timer.current ?? undefined)
    setOn(true)
    timer.current = setTimeout(() => setOn(false), ms)
  }

  return { on, flash }
}
