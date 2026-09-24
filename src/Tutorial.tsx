import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import HowToPlay from './HowToPlay'
import Tour from './Tour'
import { HOW_TO_PLAY_KEY, TOURS, hasSeen, markSeen, tourSeenKey, type TourId } from './lib/tutorial'

/** How long after a screen announces its tour before it starts on its own -
 *  long enough for the screen to settle, short enough to read as intended. */
export const TOUR_START_DELAY_MS = 700

interface Registry {
  register: (owner: symbol, id: TourId) => void
  unregister: (owner: symbol) => void
}

interface TutorialState {
  screenTour: TourId | null
  openHowToPlay: () => void
  startScreenTour: () => void
}

// Two contexts on purpose: screens only need the registry, whose functions
// never change, so announcing a tour cannot re-render the screen that did it.
const RegistryContext = createContext<Registry | null>(null)
const StateContext = createContext<TutorialState | null>(null)

/**
 * Owns both halves of the help: "how to play" opens on a device's very first
 * visit, and each screen's tour opens the first time that screen is reached -
 * but never on top of "how to play", so a first-time visitor gets the rules
 * first and the buttons after.
 */
export function TutorialProvider({ children }: { children: React.ReactNode }) {
  // A stack, not a single slot: while one screen hands over to another, the
  // new one's announcement can arrive before the old one's withdrawal.
  const [stack, setStack] = useState<{ owner: symbol; id: TourId }[]>([])
  const [howToPlayOpen, setHowToPlayOpen] = useState(() => !hasSeen(HOW_TO_PLAY_KEY))
  const [activeTour, setActiveTour] = useState<TourId | null>(null)
  const screenTour = stack.length > 0 ? stack[stack.length - 1].id : null

  const registry = useMemo<Registry>(
    () => ({
      register: (owner, id) =>
        setStack((prev) => [...prev.filter((entry) => entry.owner !== owner), { owner, id }]),
      unregister: (owner) =>
        setStack((prev) => {
          const next = prev.filter((entry) => entry.owner !== owner)
          return next.length === prev.length ? prev : next
        }),
    }),
    [],
  )

  useEffect(() => {
    if (!screenTour || howToPlayOpen || activeTour) return
    if (!hasSeen(HOW_TO_PLAY_KEY) || hasSeen(tourSeenKey(screenTour))) return
    const timer = setTimeout(() => setActiveTour(screenTour), TOUR_START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [screenTour, howToPlayOpen, activeTour])

  // The screen went away under an open tour (the host started the game while
  // a guest was reading the lobby tour): close it rather than point at nothing.
  useEffect(() => {
    if (activeTour && screenTour !== activeTour) setActiveTour(null)
  }, [activeTour, screenTour])

  const closeHowToPlay = useCallback(() => {
    markSeen(HOW_TO_PLAY_KEY)
    setHowToPlayOpen(false)
  }, [])

  const closeTour = useCallback(() => {
    if (activeTour) markSeen(tourSeenKey(activeTour))
    setActiveTour(null)
  }, [activeTour])

  const state = useMemo<TutorialState>(
    () => ({
      screenTour,
      openHowToPlay: () => setHowToPlayOpen(true),
      startScreenTour: () => setActiveTour(screenTour),
    }),
    [screenTour],
  )

  return (
    <RegistryContext.Provider value={registry}>
      <StateContext.Provider value={state}>
        {children}
        {howToPlayOpen && <HowToPlay onClose={closeHowToPlay} />}
        {activeTour && !howToPlayOpen && (
          <Tour key={activeTour} tourId={activeTour} steps={TOURS[activeTour]} onClose={closeTour} />
        )}
      </StateContext.Provider>
    </RegistryContext.Provider>
  )
}

/** Announces this screen's tour while it is mounted, or nothing for `null` -
 *  pass `null` until the screen's content has loaded, so a tour never starts
 *  over a spinner and skips every control that had not arrived yet. A no-op
 *  outside a provider, which is how the component tests render screens. */
export function useScreenTour(id: TourId | null) {
  const registry = useContext(RegistryContext)
  const [owner] = useState(() => Symbol('screen-tour'))
  useEffect(() => {
    if (!registry || !id) return
    registry.register(owner, id)
    return () => registry.unregister(owner)
  }, [registry, id, owner])
}

/** The "?" in the corner: the rules, and - on a screen that has one - that
 *  screen's tour. Scrolls with the page rather than floating over it, so it
 *  can never sit on top of a control further down. */
export function HelpButton() {
  const { t } = useTranslation()
  const state = useContext(StateContext)
  const [open, setOpen] = useState(false)
  if (!state) return null

  return (
    <div className="absolute top-3 end-3 z-40">
      <button
        type="button"
        aria-label={t('helpButtonLabel')}
        aria-expanded={state.screenTour ? open : undefined}
        onClick={() => (state.screenTour ? setOpen((o) => !o) : state.openHowToPlay())}
        className="grid size-9 cursor-pointer place-items-center rounded-full border border-line bg-surface/80 font-display text-lg font-semibold text-accent-2"
      >
        ?
      </button>
      {open && (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute top-11 end-0 flex w-max flex-col gap-1.5 rounded-2xl border border-line bg-surface p-2 shadow-glow"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                state.openHowToPlay()
              }}
              className="cursor-pointer rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1.5 text-start text-sm font-medium text-accent-2"
            >
              {t('helpMenuHowToPlay')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                state.startScreenTour()
              }}
              className="cursor-pointer rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1.5 text-start text-sm font-medium text-accent-2"
            >
              {t('helpMenuTour')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
