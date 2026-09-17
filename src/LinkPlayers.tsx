import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from './lib/firebase'
import { linkPlayerToContact, matchName, useGroupMemory } from './lib/memory'
import type { PlayerDoc } from './lib/model'
import { useAction } from './lib/useAction'

interface LinkPlayersProps {
  sessionId: string
  /** The evening's true owner - whose private store the contacts live in, and
   *  the only person who can read them at all (firestore.rules). This panel
   *  is only ever rendered for them. */
  hostUid: string
  /** The saved group this gathering continues. Without one there is nobody
   *  previously known to link anyone *to*, so this whole panel is pointless
   *  and never rendered. */
  groupId: string
  players: (PlayerDoc & { id: string })[]
  /** Live from `SessionDoc.contactIds`, so a link drawn on one device shows
   *  as drawn on the host's other one too. */
  contactIds: Record<string, string>
}

/**
 * "This is really דוד, he just typed something else" - the host drawing, by
 * hand, the connection `matchName()` structurally cannot.
 *
 * A returning guest signs in anonymously and gets a new uid every gathering,
 * so their typed name is the only thing tying them to what the group already
 * remembers about them (see `matchName` in memory.ts). That works until
 * someone types "Ella" where they wrote "אלה" last time - at which point the
 * app silently treats them as a brand-new person and starts their memory
 * over. Asked for directly; this is the manual override.
 *
 * Deliberately only offered for players whose name does *not* already match a
 * known contact: those will be matched automatically, and offering to
 * "correct" them would invite breaking a link that was already right.
 */
export default function LinkPlayers({
  sessionId,
  hostUid,
  groupId,
  players,
  contactIds,
}: LinkPlayersProps) {
  const { t } = useTranslation()
  const { members, loading } = useGroupMemory(hostUid, groupId)
  const [open, setOpen] = useState(false)
  const action = useAction()

  const knownNames = new Set(members.map((member) => matchName(member.name)))
  const unmatched = players.filter(
    (player) => !player.leftAt && !knownNames.has(matchName(player.name)),
  )

  // Nothing previously known, or everyone already matches by name: there is
  // no question here to answer.
  if (loading || members.length === 0 || unmatched.length === 0) return null

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between text-start"
      >
        <span className="text-sm font-medium text-accent-2">{t('linkPlayersTitle')}</span>
        <span className="text-xs text-muted">{unmatched.length}</span>
      </button>

      {open && (
        <>
          <p className="text-start text-xs text-muted">{t('linkPlayersHint')}</p>
          {unmatched.map((player) => {
            const linkedTo = contactIds[player.id]
            return (
              <div key={player.id} className="flex flex-col gap-1">
                <p className="text-start text-sm">
                  {player.emoji && <span className="me-1">{player.emoji}</span>}
                  {player.name}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((member) => (
                    <button
                      key={member.contactId}
                      type="button"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(() =>
                          linkPlayerToContact(db, sessionId, player.id, member.contactId),
                        )
                      }
                      className={
                        linkedTo === member.contactId
                          ? 'cursor-pointer rounded-full border-2 border-accent bg-accent/15 px-3 py-1 text-xs disabled:opacity-50'
                          : 'cursor-pointer rounded-full border border-line bg-surface/60 px-3 py-1 text-xs disabled:opacity-50'
                      }
                    >
                      {member.name}
                      {linkedTo === member.contactId ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          {action.error && (
            <p role="alert" className="text-start text-xs text-danger">
              {t('linkPlayerError')}{' '}
              <span dir="ltr" className="font-mono">
                ({action.error})
              </span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
