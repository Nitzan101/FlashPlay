import { useEffect, useRef, useState } from 'react'
import { errorCode } from './room'

/**
 * One host tap, one write, and the three things every one of them needs:
 * a busy state, the failure shown with its code, and an admission that it is
 * taking too long.
 *
 * The last one is not decoration. A Firestore write from a phone that has
 * quietly lost its connection never settles - it neither resolves nor
 * rejects - so without a timer the button simply stays disabled forever while
 * the room waits for the host to do something they already did.
 *
 * This exists as a shared hook because the first copy of it lived in
 * Rounds.tsx alone, and the next screen built from that one silently arrived
 * without it (found in the milestone-6 review).
 */
const SLOW_ACTION_MS = 6000

export interface ActionState {
  busy: boolean
  /** True once the action has been in flight longer than a phone on a working
   *  connection would ever take. */
  slow: boolean
  /** The Firebase error code of the last failure, or null. Shown to the user:
   *  on a phone there is no console to open. */
  error: string | null
  run: (action: () => Promise<unknown>) => Promise<void>
}

export function useAction(): ActionState {
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    setSlow(false)
    timer.current = setTimeout(() => setSlow(true), SLOW_ACTION_MS)
    try {
      await action()
    } catch (caught) {
      console.error('[FlashPlay] action failed:', errorCode(caught), caught)
      setError(errorCode(caught))
    } finally {
      clearTimeout(timer.current ?? undefined)
      setSlow(false)
      setBusy(false)
    }
  }

  return { busy, slow, error, run }
}
