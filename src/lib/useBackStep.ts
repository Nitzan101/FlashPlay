import { useEffect, useRef } from 'react'

/**
 * Makes the phone's Back gesture close one in-app screen instead of leaving the
 * app. The app keeps its screens in state, not in the URL, so without this a
 * Back from any screen exits to whatever page opened it (in WhatsApp's browser,
 * back to the chat).
 *
 * A screen that is `active` owns one history entry, stamped with its depth (how
 * many screens are open, itself included). After any Back, the entry now
 * current says how deep the app should be: every open screen deeper than that
 * is closed, innermost first. Closing a screen from its own button pops its
 * entry too, and that pop needs no special handling - the entry it lands on is
 * already as shallow as the screens left open. Counting "pops to ignore"
 * instead would drift the first time a pop was coalesced or dropped, and from
 * then on swallow real Back presses.
 */
interface Step {
  depth: number
  onBack: () => void
  consumed: boolean
}

const steps: Step[] = []
let listening = false

function onPopState(event: PopStateEvent) {
  const state = event.state as { flashplayStep?: number } | null
  const depth = state?.flashplayStep ?? 0
  while (steps.length > 0 && steps[steps.length - 1].depth > depth) {
    const top = steps.pop()!
    top.consumed = true
    top.onBack()
  }
}

export function useBackStep(active: boolean, onBack: () => void) {
  const latest = useRef(onBack)
  useEffect(() => {
    latest.current = onBack
  })
  useEffect(() => {
    if (!active) return
    if (!listening) {
      window.addEventListener('popstate', onPopState)
      listening = true
    }
    const step: Step = {
      depth: steps.length + 1,
      onBack: () => latest.current(),
      consumed: false,
    }
    steps.push(step)
    window.history.pushState({ flashplayStep: step.depth }, '')
    return () => {
      const index = steps.indexOf(step)
      if (index !== -1) steps.splice(index, 1)
      if (!step.consumed) window.history.back()
    }
  }, [active])
}
