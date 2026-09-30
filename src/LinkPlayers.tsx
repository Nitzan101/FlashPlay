import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from './lib/firebase'
import { linkPlayerToContact, matchName, startNewContactForPlayer, useGroupMemory } from './lib/memory'
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
 * hand, the connection `matchName()` structurally cannot. And the mirror
 * problem, added 2026-09-29: "this is NOT the David from last time" - two
 * unrelated people who happen to share a name, which `matchName()` also
 * cannot tell apart (BACKLOG.md, "a genuine duplicate name across gatherings
 * still merges two people").
 *
 * A returning guest signs in anonymously and gets a new uid every gathering,
 * so their typed name is the only thing tying them to what the group already
 * remembers about them (see `matchName` in memory.ts). That works until
 * someone types "Ella" where they wrote "אלה" last time - at which point the
 * app silently treats them as a brand-new person and starts their memory
 * over - or until a second, different Ella joins a later gathering and gets
 * silently folded into the first one's record. Both are manual overrides,
 * asked for directly.
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

  const memberByName = new Map(members.map((member) => [matchName(member.name), member]))
  const present = players.filter((player) => !player.leftAt)
  const unmatched = present.filter((player) => !memberByName.has(matchName(player.name)))
  const matched = present.filter((player) => memberByName.has(matchName(player.name)))

  // Nothing previously known, or nothing to ask about either way.
  if (loading || members.length === 0 || (unmatched.length === 0 && matched.length === 0)) {
    return null
  }

  return (
    <div data-tour="link-players" className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between text-start"
      >
        <span className="font-display text-sm font-semibold text-accent-2">{t('linkPlayersTitle')}</span>
        {unmatched.length > 0 && <span className="text-xs text-muted">{unmatched.length}</span>}
      </button>

      {open && (
        <>
          {unmatched.length > 0 && (
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
            </>
          )}

          {matched.length > 0 && (
            <>
              <p className="text-start text-xs text-muted">{t('notSamePersonHint')}</p>
              {matched.map((player) => {
                const matchedContactId = memberByName.get(matchName(player.name))!.contactId
                const alreadySplit = Boolean(
                  contactIds[player.id] && contactIds[player.id] !== matchedContactId,
                )
                return (
                  <div key={player.id} className="flex items-center justify-between gap-2">
                    <p className="text-start text-sm">
                      {player.emoji && <span className="me-1">{player.emoji}</span>}
                      {player.name}
                    </p>
                    {alreadySplit ? (
                      <span className="text-xs text-muted">{t('startedAsNewContact')}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(() => startNewContactForPlayer(db, sessionId, player.id))
                        }
                        className="cursor-pointer rounded-full border border-line bg-surface/60 px-3 py-1 text-xs disabled:opacity-50"
                      >
                        {t('notSamePerson')}
                      </button>
                    )}
                  </div>
                )
              })}
            </>
          )}

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
