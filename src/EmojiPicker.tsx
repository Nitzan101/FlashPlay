import { EMOJI_PALETTE } from './lib/model'

interface EmojiPickerProps {
  value: string | null
  onChange: (emoji: string | null) => void
  label: string
}

/** A fixed grid of EMOJI_PALETTE, radio-style: at most one selected, and
 *  tapping the selected one again clears it. Shared by the host's own
 *  profile editor, the join form, and the lobby's self-edit - one visual
 *  language for "pick your look" everywhere it appears. */
export default function EmojiPicker({ value, onChange, label }: EmojiPickerProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs text-muted">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid grid-cols-6 gap-1.5"
      >
        {EMOJI_PALETTE.map((emoji) => (
          <button
            key={emoji}
            type="button"
            role="radio"
            aria-checked={value === emoji}
            onClick={() => onChange(value === emoji ? null : emoji)}
            className={
              value === emoji
                ? 'grid size-9 cursor-pointer place-items-center rounded-xl border-2 border-accent bg-accent/15 text-lg'
                : 'grid size-9 cursor-pointer place-items-center rounded-xl border border-line bg-surface/60 text-lg'
            }
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
