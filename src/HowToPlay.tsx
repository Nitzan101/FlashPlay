import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HARVEST_PROMPTS } from './content/prompts'
import { EMOJI_PALETTE } from './lib/model'

const DEMO_PROMPT = HARVEST_PROMPTS.find((prompt) => prompt.id === 'fridge') ?? HARVEST_PROMPTS[0]

const CARDS = ['welcome', 'join', 'answer', 'whoSaid', 'mostLikely', 'host', 'end'] as const
type CardId = (typeof CARDS)[number]

/**
 * "How to play" - the rules, one short card at a time, each with a small demo
 * of the screen it describes. The in-game screens only exist once a game is
 * running, so a demo is the one way to show them up front (Nitzan's idea,
 * 2026-09-23). Every label inside a demo is the real one from i18n, so a
 * renamed button can never leave the demo showing its old name.
 */
export default function HowToPlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const touchStart = useRef<number | null>(null)
  const card = CARDS[index]
  const isLast = index === CARDS.length - 1

  const next = () => (isLast ? onClose() : setIndex((i) => i + 1))
  const prev = () => setIndex((i) => Math.max(0, i - 1))

  useEffect(() => {
    panelRef.current?.focus()
  }, [index])

  useEffect(() => {
    // RTL: the next card lies to the left.
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') setIndex((i) => Math.min(CARDS.length - 1, i + 1))
      if (event.key === 'ArrowRight') setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/85 p-4 backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-to-play-title"
        tabIndex={-1}
        onTouchStart={(event) => (touchStart.current = event.touches[0].clientX)}
        onTouchEnd={(event) => {
          if (touchStart.current === null) return
          const dx = event.changedTouches[0].clientX - touchStart.current
          touchStart.current = null
          // RTL: dragging the card to the right brings in the next one.
          if (dx > 50) next()
          if (dx < -50) prev()
        }}
        className="flex max-h-full min-h-[min(560px,100%)] w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-3xl border border-line bg-surface p-5 text-start outline-none"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5" aria-hidden>
            {CARDS.map((id, i) => (
              <span
                key={id}
                className={i === index ? 'h-1.5 w-5 rounded-full bg-accent' : 'size-1.5 rounded-full bg-line'}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full px-2 py-1 text-sm text-muted"
          >
            {isLast ? t('howToPlayClose') : t('howToPlaySkip')}
          </button>
        </div>

        <p className="text-xs text-muted">
          {t('tourCounter', { current: index + 1, total: CARDS.length })}
        </p>
        <h2 id="how-to-play-title" className="m-0 font-display text-xl font-semibold text-accent-2">
          {t(`howToPlay.${card}.title`)}
        </h2>
        <p className="m-0 text-sm leading-relaxed">{t(`howToPlay.${card}.body`)}</p>

        <div
          aria-hidden
          className="pointer-events-none relative flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-bg/70 p-3 pt-6"
        >
          <span className="absolute top-1.5 start-2.5 text-[11px] tracking-wide text-muted">
            {t('howToPlayDemoLabel')}
          </span>
          <Demo card={card} />
        </div>

        {/* Pinned to the panel's bottom, and the panel keeps one height for
            every card - "next" jumping 70px between cards made repeated
            taps miss it. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={next}
            className="grow cursor-pointer rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-2.5 font-semibold text-white shadow-glow"
          >
            {isLast ? t('howToPlayFinish') : t('tourNext')}
          </button>
          {index > 0 && (
            <button
              type="button"
              onClick={prev}
              className="cursor-pointer rounded-full bg-ink/8 px-4 py-2.5 text-sm text-muted"
            >
              {t('tourPrev')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const tile = 'rounded-xl border border-line bg-surface/60 px-2 py-1.5 text-center text-xs'
const tileOn = 'rounded-xl border-2 border-accent bg-accent/15 px-2 py-1 text-center text-xs font-medium'

function Demo({ card }: { card: CardId }) {
  const { t } = useTranslation()
  const names = [t('howToPlay.demo.name1'), t('howToPlay.demo.name2'), t('howToPlay.demo.name3'), t('howToPlay.demo.name4')]
  const answer = t('howToPlay.demo.answer')

  if (card === 'welcome') {
    return (
      <>
        <p className="m-0 text-xs text-muted">{t('memberCount', { count: names.length })}</p>
        <div className="flex w-full flex-col gap-1 rounded-xl border border-line bg-surface/60 p-2 text-sm">
          {names.map((name, i) => (
            <span key={name}>
              <span className="me-1">{EMOJI_PALETTE[i * 2]}</span>
              <span className="font-display">{name}</span>
              {i === 1 && <span className="font-semibold text-accent-3"> {t('hostSuffix')}</span>}
            </span>
          ))}
        </div>
      </>
    )
  }
  if (card === 'join') {
    return (
      <>
        <p className="m-0 text-xs">{t('yourNamePrompt')}</p>
        <div className="w-40 rounded-xl border border-line bg-surface px-3 py-1.5 text-center text-sm">{names[2]}</div>
        <div className="flex gap-1">
          {EMOJI_PALETTE.slice(0, 6).map((emoji, i) => (
            <span
              key={emoji}
              className={
                i === 2
                  ? 'grid size-7 place-items-center rounded-lg border-2 border-accent bg-accent/15 text-sm'
                  : 'grid size-7 place-items-center rounded-lg border border-line bg-surface/60 text-sm'
              }
            >
              {emoji}
            </span>
          ))}
        </div>
        <span className="rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-1.5 text-sm font-semibold text-white">
          {t('joinButton')}
        </span>
      </>
    )
  }
  if (card === 'answer') {
    return (
      <>
        <p className="m-0 text-center text-sm">{DEMO_PROMPT.text}</p>
        <div className="flex w-full items-center gap-2">
          <div className="grow rounded-xl border border-line bg-surface px-3 py-1.5 text-sm">{answer}</div>
          <span className="rounded-full bg-linear-135 from-accent to-accent-deep px-3 py-1.5 text-xs font-semibold text-white">
            {t('submitAnswer')}
          </span>
        </div>
        <p className="m-0 text-xs text-muted">{t('harvestTimeLeft', { seconds: 42 })}</p>
      </>
    )
  }
  if (card === 'whoSaid') {
    return (
      <>
        <p className="m-0 font-display text-sm font-semibold">{t('whoWroteThis')}</p>
        <div className="w-full rounded-xl border border-line bg-surface/60 px-3 py-2 text-center text-sm">"{answer}"</div>
        <div className="grid w-full grid-cols-2 gap-1.5">
          {names.map((name, i) => (
            <span key={name} className={i === 2 ? tileOn : tile}>
              {name}
            </span>
          ))}
        </div>
        <p className="m-0 text-xs text-muted">{t('votesCastOf', { count: 3, total: names.length })}</p>
        <p className="m-0 text-center text-xs text-accent-3">{t('firstGameScoringReminder')}</p>
      </>
    )
  }
  if (card === 'mostLikely') {
    return (
      <>
        <p className="m-0 text-center text-sm font-medium">{DEMO_PROMPT.secondGameQuestion}</p>
        <div className="grid w-full grid-cols-2 gap-1.5">
          {names.map((name, i) => (
            <span key={name} className={i === 0 ? tileOn : tile}>
              {name}
            </span>
          ))}
        </div>
        <p className="m-0 text-xs text-accent-3">{t('majorityScoringReminder')}</p>
      </>
    )
  }
  if (card === 'host') {
    return (
      <>
        <p className="m-0 text-xs text-muted">{t('hostPreviewOnly')}</p>
        <div className="w-full rounded-xl border border-line bg-surface/60 px-3 py-2 text-center text-sm">"{answer}"</div>
        <span className="w-full rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-1.5 text-center text-sm font-semibold text-white">
          {t('openVoting')}
        </span>
        <div className="flex gap-2">
          <span className="rounded-full bg-accent-2/15 px-3 py-1 text-xs text-accent-2">{t('revealRound')}</span>
          <span className="rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 text-xs font-medium text-accent-2">
            {t('skipItem')}
          </span>
        </div>
      </>
    )
  }
  return (
    <>
      <p className="m-0 font-display text-sm font-semibold">
        {t('winnerIs', { names: names[0], points: 9 })}
      </p>
      <div className="flex w-full flex-col gap-0.5 rounded-xl border border-line bg-surface/60 px-3 py-2 text-xs">
        {[9, 6, 4].map((points, i) => (
          <span key={points} className={i === 0 ? 'flex justify-between font-semibold text-accent-3' : 'flex justify-between'}>
            <span className="font-display">{names[i]}</span>
            <span>{points}</span>
          </span>
        ))}
      </div>
      <p className="m-0 text-center text-xs">{t('groupSavedNamed', { name: t('howToPlay.demo.group') })}</p>
    </>
  )
}
