import { useTranslation } from 'react-i18next'

/**
 * Every dead end gets a way out and says what broke. On a phone there is no
 * console to open, so a screen that only says "something went wrong" cannot be
 * diagnosed at all - the lesson from the room-code outage (CLAUDE.md). The
 * Firebase error code is shown in small print for exactly that reason.
 */
export default function LoadFailure({ message, code }: { message: string; code?: string | null }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center gap-3">
      <p role="alert" className="text-danger">
        {message}{' '}
        {code && (
          <span dir="ltr" className="font-mono text-xs">
            ({code})
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="cursor-pointer rounded-xl border border-accent-2 px-4 py-2 text-accent-2"
      >
        {t('retryButton')}
      </button>
    </div>
  )
}
