/**
 * The host's control strip is the only part of a screen that differs between
 * the host and everyone else (DESIGN: "one layout with a conditional strip,
 * not two separate modes"), and every one of its buttons has the same job -
 * fire one write, say it is working, and never look like a tap that did
 * nothing.
 */
export default function HostButton({
  children,
  busyLabel,
  onClick,
  busy,
  primary = false,
  tourId,
}: {
  children: React.ReactNode
  /** What the button says while the write is in flight. A tap that only greys
   *  the button out reads as a tap that did nothing. */
  busyLabel?: string
  onClick: () => void
  busy: boolean
  primary?: boolean
  /** The element a screen's tour points at - see src/lib/tutorial.ts. */
  tourId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-tour={tourId}
      className={
        primary
          ? 'cursor-pointer rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-3 font-semibold text-white shadow-glow disabled:opacity-50'
          : 'cursor-pointer rounded-full bg-accent-2/15 px-4 py-3 font-medium text-accent-2 disabled:opacity-50'
      }
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
