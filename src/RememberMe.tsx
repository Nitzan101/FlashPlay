import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { linkGuestWithGoogle, signInWithGoogle } from './lib/auth'
import { isEmbeddedWebView } from './lib/embeddedBrowser'

/**
 * The optional "sign in to be remembered" offer for a guest.
 *
 * It only changes what the HOST sees: whether this player is a registered
 * account (`PlayerDoc.registered`), which the host's contact store uses to
 * recognise them next time. It never shows the guest anything the host has
 * recorded - an owner decision of 2026-10-05, see DECISIONS.md. Ignoring it
 * changes nothing about playing.
 *
 * Two modes, because the two moments need different calls:
 *  - `link`: already in the room as an anonymous guest. The anonymous account
 *    is upgraded in place, so the uid and the player document survive.
 *  - `signin`: still on the name screen, no player document yet. A plain
 *    sign-in is enough, and it is the only path that works for someone whose
 *    Google account already belongs to an earlier guest uid (linking would
 *    refuse it - see DECISIONS.md).
 *
 * An embedded browser gets a note instead of a button: Google refuses OAuth
 * there, so a button would lead to an error page.
 */
export default function RememberMe({ mode }: { mode: 'link' | 'signin' }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (isEmbeddedWebView(navigator.userAgent)) {
    return (
      <p data-testid="remember-me" className="max-w-sm text-sm text-muted">
        {t('rememberOpenInBrowser')}
      </p>
    )
  }

  async function start() {
    setBusy(true)
    setFailed(false)
    try {
      // Navigates away on success; nothing after this runs in that case.
      await (mode === 'link' ? linkGuestWithGoogle() : signInWithGoogle())
    } catch (error) {
      console.error('[FlashPlay] sign-in to be remembered failed:', error)
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <div data-testid="remember-me" className="flex max-w-sm flex-col items-center gap-2">
      <p className="text-sm text-muted">{t('rememberHint')}</p>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="cursor-pointer rounded-full bg-accent-2/15 px-4 py-2 text-accent-2 disabled:opacity-50"
      >
        {t('rememberButton')}
      </button>
      {failed && (
        <p role="alert" className="text-xs text-danger">
          {t('rememberFailed')}
        </p>
      )}
    </div>
  )
}
