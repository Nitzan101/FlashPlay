import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from './lib/firebase'
import { createGroup, useSavedGroups } from './lib/memory'
import { useAction } from './lib/useAction'

interface RoomPickerProps {
  hostUid: string
  busy: boolean
  /** null means a brand-new gathering belonging to no saved group. */
  onOpenRoom: (groupId: string | null) => void
  onShowDetails: (groupId: string) => void
}

/**
 * Which room the host is about to open - a new one, or one of their saved
 * groups.
 *
 * **It is a chooser, not a row of shortcuts.** The first version made every
 * saved group its own "open a room" button sitting above a separate "open a
 * room" button, so the same tap meant two different things depending on which
 * one you hit, and nothing on screen said which gathering you were about to
 * start. Here the selection is visible and separate from the action: pick a
 * row, see it marked, then open it. "A new room" is selected by default, which
 * is what a host who is not thinking about groups wants.
 *
 * A group can also be created here, before ever playing with those people -
 * every other group in the store is born as a side effect of an evening (see
 * ensureContacts), which meant there was no way to set one up in advance.
 */
export default function RoomPicker({
  hostUid,
  busy,
  onOpenRoom,
  onShowDetails,
}: RoomPickerProps) {
  const { t } = useTranslation()
  const { groups, error } = useSavedGroups(hostUid)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const add = useAction()

  // A group deleted from its details screen must not stay selected, or "open a
  // room" would create a gathering pointing at a document that is gone.
  const selectedExists = selected === null || groups.some((group) => group.id === selected)
  const effectiveSelection = selectedExists ? selected : null

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-start text-sm text-muted">{t('chooseRoomTitle')}</p>

      <div
        className="flex w-full flex-col gap-2"
        role="radiogroup"
        aria-label={t('chooseRoomTitle')}
        data-tour="room-picker"
      >
        <Option
          label={t('newRoomOption')}
          hint={t('newRoomHint')}
          selected={effectiveSelection === null}
          onSelect={() => setSelected(null)}
        />
        {groups.map((group, i) => (
          <Option
            key={group.id}
            detailsTourId={i === 0 ? 'group-details' : undefined}
            label={group.name}
            selected={effectiveSelection === group.id}
            onSelect={() => setSelected(group.id)}
            onDetails={() => onShowDetails(group.id)}
            detailsLabel={t('groupDetailsButton')}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {t('savedGroupsLoadError')}{' '}
          <span dir="ltr" className="font-mono">
            ({error})
          </span>
        </p>
      )}

      {adding ? (
        <form
          className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            const name = newName.trim()
            if (!name) return
            void add.run(async () => {
              // Selected straight away: the host just named these people, so
              // the next tap is almost always opening their room.
              setSelected(await createGroup(db, hostUid, name))
              setNewName('')
              setAdding(false)
            })
          }}
        >
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('addGroupPlaceholder')}
            maxLength={40}
            autoFocus
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={add.busy || !newName.trim()}
              className="grow cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
            >
              {t('addGroupSave')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setNewName('')
              }}
              className="cursor-pointer rounded-full px-3 py-2 text-sm text-muted"
            >
              {t('addGroupCancel')}
            </button>
          </div>
          {add.error === 'group-name-taken' ? (
            <p role="alert" className="text-start text-xs text-danger">
              {t('groupNameTaken')}
            </p>
          ) : (
            add.error && (
              <p role="alert" className="text-start text-xs text-danger">
                {t('addGroupError')}{' '}
                <span dir="ltr" className="font-mono">
                  ({add.error})
                </span>
              </p>
            )
          )}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          data-tour="add-group"
          className="cursor-pointer self-start text-sm text-accent-2 rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 font-medium"
        >
          + {t('addGroup')}
        </button>
      )}

      <button
        type="button"
        onClick={() => onOpenRoom(effectiveSelection)}
        data-tour="open-room"
        disabled={busy}
        className="cursor-pointer rounded-full bg-linear-135 from-accent to-accent-deep px-4 py-3 font-semibold text-white shadow-glow disabled:opacity-50"
      >
        {busy ? t('creatingRoom') : t('createRoom')}
      </button>
      {groups.length > 0 && (
        <p className="text-xs text-muted">{t('savedGroupsHint')}</p>
      )}
    </div>
  )
}

/** One row of the chooser. A radio rather than a button so the selection is
 *  announced as a selection, and so arrow keys move between the rooms. */
function Option({
  label,
  hint,
  selected,
  onSelect,
  onDetails,
  detailsLabel,
  detailsTourId,
}: {
  label: string
  hint?: string
  selected: boolean
  onSelect: () => void
  onDetails?: () => void
  detailsLabel?: string
  detailsTourId?: string
}) {
  return (
    <div className="flex w-full items-stretch gap-2">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className={
          selected
            ? 'flex grow cursor-pointer items-center gap-3 rounded-xl border-2 border-accent bg-accent/15 px-3 py-3 text-start'
            : 'flex grow cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface/60 px-3 py-3 text-start'
        }
      >
        <span
          aria-hidden
          className={
            selected
              ? 'grid size-4 shrink-0 place-items-center rounded-full border-2 border-accent'
              : 'size-4 shrink-0 rounded-full border-2 border-line'
          }
        >
          {selected && <span className="size-2 rounded-full bg-accent" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{label}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      </button>
      {onDetails && (
        <button
          type="button"
          onClick={onDetails}
          data-tour={detailsTourId}
          className="shrink-0 cursor-pointer rounded-full bg-ink/8 px-3 text-sm text-muted"
        >
          {detailsLabel}
        </button>
      )}
    </div>
  )
}
