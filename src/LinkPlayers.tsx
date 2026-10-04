import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from './lib/firebase'
import {
  confirmSamePerson,
  linkPlayerToContact,
  matchName,
  resetPlayerIdentity,
  startNewContactForPlayer,
  useGroupMemory,
} from './lib/memory'
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
  /** Live from `SessionDoc.renameRequests` - who has been asked to pick
   *  another name, and under which name. */
  renameRequests?: Record<string, string>
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
  renameRequests = {},
}: LinkPlayersProps) {
  const { t } = useTranslation()
  const { members, loading } = useGroupMemory(hostUid, groupId)
  // Open by itself whenever somebody was recognised by name: the host is the
  // only check on that guess, and a collapsed panel hides that it was made.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const action = useAction()

  // A registered account is its own identity (see ensureContacts): a present
  // player whose uid already owns a contact - the host always, and any
  // registered guest who came back - is never asked about, and that contact
  // is nobody else's to be matched or linked to while they are in the room.
  // A contact claimed by somebody who is NOT here stays offered, since that
  // person may simply be using a phone without their account tonight.
  const presentAll = players.filter((player) => !player.leftAt)
  const presentIds = new Set(presentAll.map((player) => player.id))
  const ownContactOf = (playerId: string) =>
    members.find((member) => member.claimedByUid === playerId)
  const present = presentAll.filter((player) => !ownContactOf(player.id))
  const offered = members.filter(
    (member) => !(member.claimedByUid && presentIds.has(member.claimedByUid)),
  )
  // Name matching never reaches a claimed contact - ensureContacts skips them
  // too, so a recognised-by-name badge here would promise something it does not
  // do. A claimed contact can still be picked by hand.
  const memberByName = new Map(
    members.filter((member) => !member.claimedByUid).map((member) => [matchName(member.name), member]),
  )
  const unmatched = present.filter((player) => !memberByName.has(matchName(player.name)))
  const matched = present.filter((player) => memberByName.has(matchName(player.name)))

  const open = toggled ?? matched.length > 0

  // Who a present player counts as right now: an explicit link or split wins,
  // otherwise the name match. A contact can be only one person, so one that
  // somebody else already counts as is not offered to anyone else.
  const contactOf = (player: PlayerDoc & { id: string }) =>
    contactIds[player.id] ??
    ownContactOf(player.id)?.contactId ??
    memberByName.get(matchName(player.name))?.contactId
  const takenByAnother = (contactId: string, playerId: string) =>
    presentAll.some((other) => other.id !== playerId && contactOf(other) === contactId)

  // Nothing previously known, or nothing to ask about either way.
  if (loading || offered.length === 0 || (unmatched.length === 0 && matched.length === 0)) {
    return null
  }

  return (
    <div data-tour="link-players" className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
      <button
        type="button"
        onClick={() => setToggled(!open)}
        className="flex w-full cursor-pointer items-center justify-between text-start"
      >
        <span className="font-display text-sm font-semibold text-accent-2">{t('linkPlayersTitle')}</span>
        {unmatched.length + matched.length > 0 && (
          <span className="text-xs text-muted">{unmatched.length + matched.length}</span>
        )}
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
                      {offered.map((member) => {
                        const isLinked = linkedTo === member.contactId
                        const taken = !isLinked && takenByAnother(member.contactId, player.id)
                        return (
                          <button
                            key={member.contactId}
                            type="button"
                            disabled={action.busy || taken}
                            title={taken ? t('linkTakenHint') : undefined}
                            // Tapping the chosen one again takes the link back.
                            onClick={() =>
                              void action.run(() =>
                                isLinked
                                  ? resetPlayerIdentity(db, sessionId, player.id)
                                  : linkPlayerToContact(db, sessionId, player.id, member.contactId),
                              )
                            }
                            className={
                              isLinked
                                ? 'cursor-pointer rounded-full border-2 border-accent bg-accent/15 px-3 py-1 text-xs disabled:opacity-50'
                                : 'cursor-pointer rounded-full border border-line bg-surface/60 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40'
                            }
                          >
                            {member.name}
                            {isLinked ? ' ✓' : ''}
                          </button>
                        )
                      })}
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
                // An explicit link to the very contact the name pointed at: the
                // host has said "yes, this is them".
                const confirmed = contactIds[player.id] === matchedContactId
                return (
                  <div key={player.id} className="flex items-center justify-between gap-2">
                    <div className="flex flex-col text-start">
                      <p className="text-sm">
                        {player.emoji && <span className="me-1">{player.emoji}</span>}
                        {player.name}
                      </p>
                      {!alreadySplit && !confirmed && (
                        <span className="text-xs text-muted">{t('recognisedByName')}</span>
                      )}
                    </div>
                    {alreadySplit ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="text-xs text-muted">
                          {renameRequests[player.id] === player.name
                            ? t('startedAsNewContactWaiting')
                            : t('startedAsNewContact')}
                        </span>
                        <button
                          type="button"
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(() =>
                              confirmSamePerson(db, sessionId, player.id, matchedContactId),
                            )
                          }
                          className="cursor-pointer rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 text-xs font-medium text-accent-2 disabled:opacity-50"
                        >
                          {t('samePerson')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {confirmed ? (
                          <span className="text-xs text-accent-3">{t('confirmedSamePerson')}</span>
                        ) : (
                          <button
                            type="button"
                            disabled={action.busy}
                            onClick={() =>
                              void action.run(() =>
                                confirmSamePerson(db, sessionId, player.id, matchedContactId),
                              )
                            }
                            className="cursor-pointer rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 text-xs font-medium text-accent-2 disabled:opacity-50"
                          >
                            {t('samePerson')}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(() =>
                              startNewContactForPlayer(db, sessionId, player.id, player.name),
                            )
                          }
                          className="cursor-pointer rounded-full border border-line bg-surface/60 px-3 py-1 text-xs disabled:opacity-50"
                        >
                          {t('notSamePerson')}
                        </button>
                      </div>
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
