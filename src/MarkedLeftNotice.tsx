import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from './lib/firebase'
import { rejoinRoom } from './lib/room'
import { useAction } from './lib/useAction'

/**
 * What a player sees after the host started the game without them, because
 * they had been asked to pick another name and had not (Lobby's "start
 * without them" marks them as having left). They are not thrown out: a new
 * name, different from the one they were asked to change, brings them back.
 */
export default function MarkedLeftNotice({
  sessionId,
  uid,
  emoji,
  requestedName,
}: {
  sessionId: string
  uid: string
  emoji: string | null
  /** The name the host asked them to change. */
  requestedName: string
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const rejoin = useAction()
  const sameName = name.trim() === requestedName.trim()

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
      <p className="font-display text-lg font-semibold">{t('markedLeftTitle')}</p>
      <p className="text-sm text-muted">{t('markedLeftHint')}</p>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={40}
        aria-label={t('markedLeftNameLabel')}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-center text-ink placeholder:text-muted"
      />
      {name.trim() !== '' && sameName && (
        <p role="alert" className="text-xs text-danger">
          {t('rejoinSameName')}
        </p>
      )}
      <button
        type="button"
        disabled={rejoin.busy || !name.trim() || sameName}
        onClick={() => void rejoin.run(() => rejoinRoom(db, sessionId, uid, name.trim(), emoji))}
        className="cursor-pointer rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-2 font-semibold text-white shadow-glow disabled:opacity-50"
      >
        {rejoin.busy ? t('savingProfile') : t('rejoinButton')}
      </button>
      {rejoin.error && (
        <p role="alert" className="text-xs text-danger">
          {rejoin.error === 'name-taken' ? t('nameTaken') : t('nameEmojiSaveError')}{' '}
          {rejoin.error !== 'name-taken' && (
            <span dir="ltr" className="font-mono">
              ({rejoin.error})
            </span>
          )}
        </p>
      )}
    </div>
  )
}
