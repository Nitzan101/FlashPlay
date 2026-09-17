import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import HostButton from './HostButton'
import LoadFailure from './LoadFailure'
import { db } from './lib/firebase'
import { deleteFact, deleteGroup, useGroupMemory } from './lib/memory'
import { useAction } from './lib/useAction'

interface GroupMemoryProps {
  hostUid: string
  groupId: string
  onClose: () => void
}

/**
 * "What we remember about this group" - milestone 7, and DESIGN is specific
 * about two things: it is **open to the group's owner only**, "otherwise that
 * screen is itself the hole through which a guest siphons the family's
 * memory", and every line has one-tap deletion.
 *
 * Owner-only is not enforced here but in firestore.rules: everything this
 * screen reads lives under `users/{uid}`, which nobody else can read at all.
 * This component is simply never rendered for a guest, and would show an
 * empty list with a permission error if it were.
 */
export default function GroupMemory({ hostUid, groupId, onClose }: GroupMemoryProps) {
  const { t } = useTranslation()
  const { groupName, facts, loading, error } = useGroupMemory(hostUid, groupId)
  const remove = useAction()
  const [deleted, setDeleted] = useState<string[]>([])
  // Which row is being deleted, so one slow delete does not grey out every
  // other row's button with no explanation.
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmingWipe, setConfirmingWipe] = useState(false)
  const [wiped, setWiped] = useState(false)

  if (error) return <LoadFailure message={t('memoryLoadError')} code={error} />

  const visible = facts.filter((fact) => !deleted.includes(fact.path))

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3">
      <p className="text-lg font-medium">{groupName || t('memoryTitle')}</p>

      {loading && <p className="text-muted">{t('loadingRound')}</p>}
      {!loading && (wiped || visible.length === 0) && (
        <p className="text-muted">{t('memoryEmpty')}</p>
      )}

      {!wiped &&
        visible.map((fact) => (
          <div
            key={fact.path}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface/60 p-2"
          >
            <span className="text-sm">
              {fact.who ? t('memoryLine', { who: fact.who, text: fact.text }) : fact.text}
            </span>
            <button
              type="button"
              onClick={() => {
                setDeleting(fact.path)
                void remove
                  .run(async () => {
                    await deleteFact(db, fact.path)
                    setDeleted((prev) => [...prev, fact.path])
                  })
                  .finally(() => setDeleting(null))
              }}
              disabled={deleting === fact.path}
              className="shrink-0 cursor-pointer rounded-xl border border-accent-2 px-3 py-2 text-sm text-accent-2 disabled:opacity-50"
            >
              {t('deleteFact')}
            </button>
          </div>
        ))}

      {remove.slow && <p className="text-xs text-muted">{t('stillWorking')}</p>}
      {remove.error && (
        <p role="alert" className="text-xs text-danger">
          {t('deleteFactError')}{' '}
          <span dir="ltr" className="font-mono">
            ({remove.error})
          </span>
        </p>
      )}

      {/* Deleting the group takes its facts and its contacts with it -
          Firestore does not cascade, and a half-deleted memory is worse than
          none: the screen says it is gone while the documents remain. */}
      {!wiped &&
        (confirmingWipe ? (
          <>
            <p className="text-center text-sm">{t('forgetGroupConfirm')}</p>
            <HostButton
              busy={remove.busy}
              onClick={() =>
                void remove.run(async () => {
                  await deleteGroup(db, hostUid, groupId)
                  setWiped(true)
                })
              }
              primary
            >
              {t('forgetGroupYes')}
            </HostButton>
            <HostButton busy={remove.busy} onClick={() => setConfirmingWipe(false)}>
              {t('forgetGroupNo')}
            </HostButton>
          </>
        ) : (
          <HostButton busy={remove.busy} onClick={() => setConfirmingWipe(true)}>
            {t('forgetGroup')}
          </HostButton>
        ))}

      <HostButton busy={false} onClick={onClose}>
        {t('backButton')}
      </HostButton>
    </div>
  )
}
