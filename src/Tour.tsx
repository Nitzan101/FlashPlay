import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TourId, TourStep } from './lib/tutorial'

const PAD = 8
const GAP = 12
/** Room the bubble needs above or below its target before it is placed there;
 *  otherwise it sits at the bottom of the screen, over part of a tall target. */
const BUBBLE_ROOM = 190

function findTarget(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
}

/**
 * A spotlight that walks through one screen's controls: the page dims, the
 * current control stays lit, and a bubble beside it says what it does. The
 * page underneath cannot be tapped while it is open - a tour that let a stray
 * tap open a room or delete a group would be worse than no tour.
 */
export default function Tour({
  tourId,
  steps,
  onClose,
}: {
  tourId: TourId
  steps: TourStep[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [available] = useState(() => steps.filter((step) => findTarget(step.target)))
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const step = available[index]
  const isLast = index === available.length - 1

  useEffect(() => {
    if (available.length === 0) onClose()
  }, [available.length, onClose])

  useEffect(() => {
    if (!step) return
    const el = findTarget(step.target)
    if (!el) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    el.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    const measure = () => setRect(el.getBoundingClientRect())
    // Follow the smooth scroll as it settles, then keep up with any later
    // scroll or resize.
    let frame = 0
    const until = performance.now() + 700
    const follow = () => {
      measure()
      if (performance.now() < until) frame = requestAnimationFrame(follow)
    }
    follow()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    bubbleRef.current?.focus()
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!step) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(300, vw - 32)
  const left = rect
    ? Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 16), vw - width - 16)
    : (vw - width) / 2
  const place: React.CSSProperties = !rect
    ? { top: vh / 3 }
    : vh - rect.bottom >= BUBBLE_ROOM
      ? { top: rect.bottom + PAD + GAP }
      : rect.top >= BUBBLE_ROOM
        ? { bottom: vh - rect.top + PAD + GAP }
        : { bottom: 16 }
  const titleId = `tour-${tourId}-title`

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0" onClick={(event) => event.stopPropagation()} />
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-2xl ring-2 ring-accent-2 transition-all duration-300 motion-reduce:transition-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(10, 4, 14, 0.74)',
          }}
        />
      )}
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-start shadow-glow outline-none"
        style={{ width, left, ...place }}
      >
        <p className="text-xs text-muted">
          {t('tourCounter', { current: index + 1, total: available.length })}
        </p>
        <p id={titleId} className="font-display text-lg font-semibold text-accent-2">
          {t(`tour.${tourId}.${step.key}.title`)}
        </p>
        <p className="text-sm leading-relaxed">{t(`tour.${tourId}.${step.key}.body`)}</p>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => (isLast ? onClose() : setIndex((i) => i + 1))}
            className="cursor-pointer rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-2 text-sm font-semibold text-white shadow-glow"
          >
            {isLast ? t('tourDone') : t('tourNext')}
          </button>
          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              className="cursor-pointer rounded-full bg-ink/8 px-4 py-2 text-sm text-muted"
            >
              {t('tourPrev')}
            </button>
          )}
          {!isLast && (
            <button
              type="button"
              onClick={onClose}
              className="ms-auto cursor-pointer rounded-full px-2 py-2 text-sm text-muted"
            >
              {t('tourSkip')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
