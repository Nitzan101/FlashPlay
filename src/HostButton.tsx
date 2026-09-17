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
}: {
  children: React.ReactNode
  /** What the button says while the write is in flight. A tap that only greys
   *  the button out reads as a tap that did nothing. */
  busyLabel?: string
  onClick: () => void
  busy: boolean
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        primary
          ? 'cursor-pointer rounded-xl bg-accent px-4 py-3 font-semibold text-white shadow-[0_0_18px_rgba(255,46,154,0.5)] disabled:opacity-50'
          : 'cursor-pointer rounded-xl border border-accent-2 px-4 py-3 font-medium text-accent-2 shadow-[0_0_12px_rgba(34,240,211,0.25)] disabled:opacity-50'
      }
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
