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
          ? 'cursor-pointer rounded-md bg-blue-600 px-4 py-3 text-white disabled:opacity-50'
          : 'cursor-pointer rounded-md border border-neutral-300 px-4 py-3 disabled:opacity-50'
      }
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
