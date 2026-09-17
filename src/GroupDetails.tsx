import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import HostButton from './HostButton'
import LoadFailure from './LoadFailure'
import { db } from './lib/firebase'
import {
  addManualFact,
  addManualGroupFact,
  deleteFact,
  deleteGroup,
  nameGroup,
  shareGroup,
  useGroupMemory,
  type RememberedFact,
} from './lib/memory'
import { useAction } from './lib/useAction'

interface GroupDetailsProps {
  hostUid: string
  groupId: string
  onClose: () => void
  /** Offered on the landing screen, where opening a room for this group is the
   *  natural next step. Absent mid-gathering, where a room is already open. */
  onOpenRoom?: () => void
  /** Told when the whole group has been deleted, so the caller can drop it
   *  from its own list and leave this screen - otherwise the host sits on the
   *  details of something that no longer exists. */
  onDeleted?: () => void
}

/**
 * A saved group's details - what we remember about each person in it, its
 * name, and the way out of both.
 *
 * DESIGN is specific about two things, and both still hold: this screen is
 * **open to the group's owner only**, "otherwise that screen is itself the
 * hole through which a guest siphons the family's memory", and every line has
 * one-tap deletion. Owner-only is not enforced here but in firestore.rules -
 * everything read here lives under `users/{uid}`, which nobody else can read
 * at all; this component is simply never rendered for a guest.
 *
 * **Facts are grouped by person, not listed flat.** The first version was one
 * "who: text" line per fact, which is legible at three facts and a wall at
 * ten - and the question the screen exists to answer is per person. A member
 * with nothing recorded keeps their row, saying so: an empty row is an answer,
 * a missing row looks like they were never in the group.
 */
export default function GroupDetails({
  hostUid,
  groupId,
  onClose,
  onOpenRoom,
  onDeleted,
}: GroupDetailsProps) {
  const { t } = useTranslation()
  const [refreshToken, setRefreshToken] = useState(0)
  const { groupName, members, groupFacts, loading, error } = useGroupMemory(
    hostUid,
    groupId,
    refreshToken,
  )
  const remove = useAction()
  const rename = useAction()
  const addFact = useAction()
  const share = useAction()
  // Which person's (or the group's, keyed '') add-a-fact box is open - at
  // most one at a time, so opening a new one does not leave a half-typed note
  // behind in another.
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [factInput, setFactInput] = useState('')
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [deleted, setDeleted] = useState<string[]>([])
  // Which row is being deleted, so one slow delete does not grey out every
  // other row's button with no explanation.
  const [deleting, setDeleting] = useState<string | null>(null)
  // Deleting a fact cannot be undone, and its button sits inches from a scroll
  // gesture on a phone - so it asks, per row, the same way the whole-group
  // wipe already did.
  const [confirmingFact, setConfirmingFact] = useState<string | null>(null)
  const [confirmingWipe, setConfirmingWipe] = useState(false)
  const [wiped, setWiped] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [renamed, setRenamed] = useState(false)

  // The name arrives with the group, one round trip after this mounts, so the
  // field cannot simply be initialised from it. Only seeded while untouched:
  // re-seeding on every load would fight the host mid-edit.
  useEffect(() => {
    if (!loading) setNameInput((current) => current || groupName)
  }, [loading, groupName])

  if (error) return <LoadFailure message={t('memoryLoadError')} code={error} />

  const isVisible = (fact: RememberedFact) => !deleted.includes(fact.path)

  function removeFact(path: string) {
    setDeleting(path)
    setConfirmingFact(null)
    void remove
      .run(async () => {
        await deleteFact(db, path)
        setDeleted((prev) => [...prev, path])
      })
      .finally(() => setDeleting(null))
  }

  function FactRow({ fact, showWho = false }: { fact: RememberedFact; showWho?: boolean }) {
    return (
      <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2">
        <span className="text-start text-sm">
          {showWho && fact.who ? t('memoryLine', { who: fact.who, text: fact.text }) : fact.text}
        </span>
        {confirmingFact === fact.path ? (
          <span className="flex shrink-0 items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => removeFact(fact.path)}
              className="cursor-pointer rounded-lg bg-danger/15 px-2 py-1 text-danger"
            >
              {t('deleteFactYes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingFact(null)}
              className="cursor-pointer rounded-lg px-2 py-1 text-muted"
            >
              {t('deleteFactNo')}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingFact(fact.path)}
            disabled={deleting === fact.path}
            aria-label={`${t('deleteFact')} - ${fact.text}`}
            className="shrink-0 cursor-pointer rounded-lg border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
          >
            {t('deleteFact')}
          </button>
        )}
      </div>
    )
  }

  /** `null` (the group itself) is keyed as `''` in `addingTo`, since state
   *  keys can't be null. */
  function openAddFact(contactId: string | null) {
    setAddingTo(contactId ?? '')
    setFactInput('')
  }

  function saveFact(contactId: string | null) {
    void addFact.run(async () => {
      if (contactId) {
        await addManualFact(db, hostUid, contactId, factInput.trim())
      } else {
        await addManualGroupFact(db, hostUid, groupId, factInput.trim())
      }
      setAddingTo(null)
      setFactInput('')
      setRefreshToken((token) => token + 1)
    })
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3">
      <p className="text-lg font-medium">{groupName || t('memoryTitle')}</p>

      {loading && <p className="text-muted">{t('loadingRound')}</p>}

      {!loading && !wiped && (
        <>
          {/* Renaming lives here rather than on the list: the list is a
              chooser, and an editable field in every row of a chooser invites
              exactly the mis-tap the confirmations below exist to prevent. */}
          <div className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
            <label htmlFor="group-name" className="text-start text-xs text-muted">
              {t('renameGroupLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="group-name"
                value={nameInput}
                onChange={(event) => {
                  setNameInput(event.target.value)
                  setRenamed(false)
                }}
                maxLength={40}
                className="w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted"
              />
              <button
                type="button"
                disabled={rename.busy || !nameInput.trim() || nameInput.trim() === groupName}
                onClick={() =>
                  void rename.run(async () => {
                    await nameGroup(db, hostUid, groupId, nameInput.trim())
                    setRenamed(true)
                  })
                }
                className="shrink-0 cursor-pointer rounded-xl border border-accent-2 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
              >
                {t('renameGroupSave')}
              </button>
            </div>
            {renamed && <p className="text-start text-xs text-accent-3">{t('renameGroupSaved')}</p>}
            {rename.error && (
              <p role="alert" className="text-start text-xs text-danger">
                {t('renameGroupError')}{' '}
                <span dir="ltr" className="font-mono">
                  ({rename.error})
                </span>
              </p>
            )}
          </div>

          {onOpenRoom && (
            <HostButton busy={false} onClick={onOpenRoom} primary>
              {t('openRoomForGroup')}
            </HostButton>
          )}

          <p className="w-full text-start text-xs tracking-wide text-muted">{t('membersTitle')}</p>
          {members.length === 0 && <p className="text-sm text-muted">{t('noMembersYet')}</p>}
          {members.map((member) => {
            const facts = member.facts.filter(isVisible)
            return (
              <div
                key={member.contactId}
                className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3"
              >
                <p className="text-start font-medium text-accent-2">{member.name}</p>
                {facts.length === 0 ? (
                  <p className="text-start text-xs text-muted">{t('memberNoFacts')}</p>
                ) : (
                  facts.map((fact) => <FactRow key={fact.path} fact={fact} />)
                )}
                <AddFactRow
                  isOpen={addingTo === member.contactId}
                  value={factInput}
                  busy={addFact.busy}
                  onOpen={() => openAddFact(member.contactId)}
                  onChange={setFactInput}
                  onSave={() => saveFact(member.contactId)}
                  onCancel={() => setAddingTo(null)}
                />
              </div>
            )
          })}

          <div className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
            <p className="text-start text-xs tracking-wide text-muted">{t('groupFactsTitle')}</p>
            {groupFacts.filter(isVisible).map((fact) => (
              <FactRow key={fact.path} fact={fact} showWho />
            ))}
            <AddFactRow
              isOpen={addingTo === ''}
              value={factInput}
              busy={addFact.busy}
              onOpen={() => openAddFact(null)}
              onChange={setFactInput}
              onSave={() => saveFact(null)}
              onCancel={() => setAddingTo(null)}
            />
          </div>
        </>
      )}

      {wiped && <p className="text-muted">{t('memoryEmpty')}</p>}

      {remove.slow && <p className="text-xs text-muted">{t('stillWorking')}</p>}
      {remove.error && (
        <p role="alert" className="text-xs text-danger">
          {t('deleteFactError')}{' '}
          <span dir="ltr" className="font-mono">
            ({remove.error})
          </span>
        </p>
      )}
      {addFact.error && (
        <p role="alert" className="text-xs text-danger">
          {t('addFactError')}{' '}
          <span dir="ltr" className="font-mono">
            ({addFact.error})
          </span>
        </p>
      )}

      {/* Handing the whole group to another host - a one-time copy, never a
          live link, so both sides carry on independently afterwards. See
          GroupShareDoc in model.ts for why it works this way. */}
      {!wiped && !loading && (
        <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/40 p-3">
          {shareUrl ? (
            <>
              <p className="text-start text-xs text-muted">{t('shareGroupReady')}</p>
              <code
                dir="ltr"
                className="w-full break-all rounded-xl border border-line bg-surface px-3 py-2 text-center text-xs text-ink select-all"
              >
                {shareUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(shareUrl)
                    .then(() => setShareCopied(true))
                    .catch(() => setShareCopied(false))
                }}
                className="cursor-pointer rounded-xl border border-accent-2 px-3 py-2 text-sm text-accent-2"
              >
                {shareCopied ? t('linkCopied') : t('copyLink')}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={share.busy}
              onClick={() =>
                void share.run(async () => {
                  const shareId = await shareGroup(db, hostUid, groupId)
                  setShareUrl(`${window.location.origin}/share/${shareId}`)
                })
              }
              className="cursor-pointer rounded-xl border border-accent-2 px-4 py-2 text-sm text-accent-2 disabled:opacity-40"
            >
              {share.busy ? t('sharingGroup') : t('shareGroupButton')}
            </button>
          )}
          {share.error && (
            <p role="alert" className="text-xs text-danger">
              {t('shareGroupError')}{' '}
              <span dir="ltr" className="font-mono">
                ({share.error})
              </span>
            </p>
          )}
        </div>
      )}

      {/* Deleting the group takes its facts and its contacts with it -
          Firestore does not cascade, and a half-deleted memory is worse than
          none: the screen says it is gone while the documents remain. */}
      {!wiped &&
        !loading &&
        (confirmingWipe ? (
          <>
            <p className="text-center text-sm">{t('forgetGroupConfirm')}</p>
            <HostButton
              busy={remove.busy}
              onClick={() =>
                void remove.run(async () => {
                  await deleteGroup(db, hostUid, groupId)
                  setWiped(true)
                  onDeleted?.()
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
          <button
            type="button"
            disabled={remove.busy}
            onClick={() => setConfirmingWipe(true)}
            className="cursor-pointer rounded-xl border border-danger/50 px-4 py-2 text-sm text-danger disabled:opacity-50"
          >
            {t('forgetGroup')}
          </button>
        ))}

      <HostButton busy={false} onClick={onClose}>
        {t('backButton')}
      </HostButton>
    </div>
  )
}

/**
 * The host's own free-form note, added directly rather than collected from a
 * game or a guided question - "add info as they wish" from the room
 * picker/details conversation. Shared between a person's card and the
 * group-wide section, driven entirely by props rather than closing over
 * `GroupDetails`'s state - a component declared inside another component's
 * render body is recreated every render, which resets any state of its own
 * and defeats reconciliation (oxlint: react/static-components).
 */
function AddFactRow({
  isOpen,
  value,
  busy,
  onOpen,
  onChange,
  onSave,
  onCancel,
}: {
  isOpen: boolean
  value: string
  busy: boolean
  onOpen: () => void
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer self-start text-xs text-accent-2 underline decoration-dotted underline-offset-4"
      >
        + {t('addFact')}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('addFactPlaceholder')}
        maxLength={300}
        autoFocus
        className="w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
      />
      <button
        type="button"
        disabled={busy || !value.trim()}
        onClick={onSave}
        className="shrink-0 cursor-pointer rounded-xl border border-accent-2 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
      >
        {t('addFactSave')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 cursor-pointer rounded-xl px-2 py-2 text-sm text-muted"
      >
        {t('addGroupCancel')}
      </button>
    </div>
  )
}
