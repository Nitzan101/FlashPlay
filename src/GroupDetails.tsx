import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import HostButton from './HostButton'
import LoadFailure from './LoadFailure'
import QuestionRow from './QuestionRow'
import { PROFILE_QUESTIONS } from './content/profileQuestions'
import { db } from './lib/firebase'
import {
  addGroupMember,
  addManualFact,
  addManualGroupFact,
  answerFromFactText,
  answerFromText,
  answerToText,
  deleteContact,
  deleteFact,
  deleteGroup,
  nameGroup,
  setContactQuestionAnswer,
  shareGroup,
  useGroupMemory,
  wipeGroupFacts,
  type RememberedFact,
} from './lib/memory'
import type { ProfileQuestion } from './lib/model'
import { useCustomQuestions } from './lib/profileQuestions'
import { useAction } from './lib/useAction'
import { useScreenTour } from './Tutorial'

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
  const removeMember = useAction()
  const addMember = useAction()
  const wipeInfo = useAction()
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
  // Two different confirms for two different, easily confused actions - see
  // the module comment: "מחיקת הכל על הקבוצה" used to mean "delete the whole
  // group" while reading like "just wipe what we remember".
  const [confirmingDeleteGroup, setConfirmingDeleteGroup] = useState(false)
  const [confirmingWipeInfo, setConfirmingWipeInfo] = useState(false)
  const [wiped, setWiped] = useState(false)
  const [infoWiped, setInfoWiped] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [renamed, setRenamed] = useState(false)
  // Which member is being asked to confirm their own deletion, and whether
  // the "add a person" box is open - same one-at-a-time reasoning as
  // addingTo above.
  const [confirmingMemberDelete, setConfirmingMemberDelete] = useState<string | null>(null)
  const [removedMembers, setRemovedMembers] = useState<string[]>([])
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  // Whose guided-question list is open - at most one person at a time, since
  // each list is the whole question bank and two open at once is a wall.
  const [questionsFor, setQuestionsFor] = useState<string | null>(null)
  // The person whose own page is open, if any. The group page lists names
  // only; everything about one person lives on their page - asked for
  // directly, 2026-09-23, since every person's facts and questions stacked on
  // one page becomes a wall once a group has any real history.
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const listScroll = useRef(0)
  const scrolledOnce = useRef(false)
  const { questions: customQuestions } = useCustomQuestions(hostUid)
  const allQuestions: ProfileQuestion[] = [...PROFILE_QUESTIONS, ...customQuestions]

  // The name arrives with the group, one round trip after this mounts, so the
  // field cannot simply be initialised from it. Only seeded while untouched:
  // re-seeding on every load would fight the host mid-edit.
  useEffect(() => {
    if (!loading) setNameInput((current) => current || groupName)
  }, [loading, groupName])

  // `deleted` only has to hide a fact until the next load lands - from then on
  // the store itself is the truth. Kept forever, it went on hiding a guided-
  // question fact the host saved again afterwards, because that fact always
  // lives at the same path (`profile_{questionId}`). Found live, 2026-09-23.
  // Safe to clear on any load: useGroupMemory discards a load that a newer
  // refresh has superseded, so the one that lands started after the delete.
  // Returns the same array when already empty, so a caller handing in fresh
  // arrays every render cannot turn this into an endless re-render loop.
  useEffect(() => {
    setDeleted((prev) => (prev.length === 0 ? prev : []))
  }, [members, groupFacts])

  // A person's page opens at its top; going back returns to where the list
  // was, not to the top of the group page. Skipped on mount.
  useEffect(() => {
    if (!scrolledOnce.current) {
      scrolledOnce.current = true
      return
    }
    window.scrollTo(0, openPerson ? 0 : listScroll.current)
  }, [openPerson])

  const personPageOpen =
    openPerson !== null &&
    !removedMembers.includes(openPerson) &&
    members.some((member) => member.contactId === openPerson)
  useScreenTour(loading || wiped || error ? null : personPageOpen ? 'person' : 'group')

  if (error) return <LoadFailure message={t('memoryLoadError')} code={error} />

  const isVisible = (fact: RememberedFact) => !deleted.includes(fact.path)

  function removeFact(path: string) {
    setDeleting(path)
    setConfirmingFact(null)
    void remove
      .run(async () => {
        await deleteFact(db, path)
        setDeleted((prev) => [...prev, path])
        setRefreshToken((token) => token + 1)
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
              className="cursor-pointer rounded-full bg-danger/15 px-2 py-1 text-danger"
            >
              {t('deleteFactYes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingFact(null)}
              className="cursor-pointer rounded-full px-2 py-1 text-muted"
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
            className="shrink-0 cursor-pointer rounded-full bg-ink/8 px-2 py-1 text-xs text-muted disabled:opacity-50"
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

  function openPersonPage(contactId: string) {
    listScroll.current = window.scrollY
    setAddingTo(null)
    setQuestionsFor(null)
    setOpenPerson(contactId)
  }

  function closePersonPage() {
    setAddingTo(null)
    setQuestionsFor(null)
    setOpenPerson(null)
  }

  const factErrors = (
    <>
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
    </>
  )

  // Falls back to the group page on its own if this person disappears (deleted,
  // or the whole group's memory wiped) while their page is open.
  const person =
    openPerson && !removedMembers.includes(openPerson)
      ? members.find((member) => member.contactId === openPerson)
      : undefined

  if (person && !loading && !wiped) {
    const facts = person.facts.filter(isVisible)
    const backButton = (
      <button
        type="button"
        onClick={closePersonPage}
        data-tour="back-to-group"
        className="cursor-pointer self-start text-sm text-accent-2 rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 font-medium"
      >
        › {t('backToGroup')}
      </button>
    )
    return (
      <div data-testid="person-page" className="flex w-full max-w-sm flex-col items-center gap-3">
        {backButton}
        <div className="flex w-full flex-col items-center gap-0.5">
          <p className="text-xs text-muted">{groupName}</p>
          <p className="font-display text-lg font-semibold text-accent-2">{person.name}</p>
        </div>

        <div data-tour="person-facts" className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
          {facts.length === 0 ? (
            <p className="text-start text-xs text-muted">{t('memberNoFacts')}</p>
          ) : (
            facts.map((fact) => <FactRow key={fact.path} fact={fact} />)
          )}
          <AddFactRow
            isOpen={addingTo === person.contactId}
            value={factInput}
            busy={addFact.busy}
            onOpen={() => openAddFact(person.contactId)}
            onChange={setFactInput}
            onSave={() => saveFact(person.contactId)}
            onCancel={() => setAddingTo(null)}
          />
        </div>

        {/* The guided questions, per person - asked for directly: "רשימת
            השאלות עבור אדם בלחיצה על עריכתו". Every question in the bank
            (built-in and the host's own), each with this person's current
            answer ready to edit. Still collapsed at first: the whole bank is
            long, and the facts above are what the page is usually opened for. */}
        <div data-tour="person-questions" className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
          <button
            type="button"
            onClick={() =>
              setQuestionsFor((current) =>
                current === person.contactId ? null : person.contactId,
              )
            }
            aria-expanded={questionsFor === person.contactId}
            className="cursor-pointer self-start text-xs text-accent-2 rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 font-medium"
          >
            {questionsFor === person.contactId ? t('hideMemberQuestions') : t('editMemberQuestions')}
          </button>
          {questionsFor === person.contactId && (
            <div className="flex flex-col gap-3 border-t border-line pt-2">
              {allQuestions.map((question) => {
                const existing = person.facts.find(
                  (f) => f.promptId === question.id && isVisible(f),
                )
                return (
                  <QuestionRow
                    key={question.id}
                    question={question}
                    initialAnswer={
                      existing
                        ? answerFromText(question, answerFromFactText(existing.text, question.text))
                        : undefined
                    }
                    onSave={async (answer) => {
                      await setContactQuestionAnswer(
                        db,
                        hostUid,
                        person.contactId,
                        question,
                        answerToText(answer),
                      )
                      setRefreshToken((token) => token + 1)
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>

        {factErrors}

        <HostButton busy={false} onClick={closePersonPage}>
          {t('backToGroup')}
        </HostButton>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3">
      <p className="font-display text-lg font-semibold">{groupName || t('memoryTitle')}</p>

      {loading && <p className="text-muted">{t('loadingRound')}</p>}

      {!loading && !wiped && (
        <>
          {/* Renaming lives here rather than on the list: the list is a
              chooser, and an editable field in every row of a chooser invites
              exactly the mis-tap the confirmations below exist to prevent. */}
          <div data-tour="rename-group" className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
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
                className="shrink-0 cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
              >
                {t('renameGroupSave')}
              </button>
            </div>
            {renamed && <p className="text-start text-xs text-accent-3">{t('renameGroupSaved')}</p>}
            {rename.error === 'group-name-taken' ? (
              <p role="alert" className="text-start text-xs text-danger">
                {t('groupNameTaken')}
              </p>
            ) : (
              rename.error && (
                <p role="alert" className="text-start text-xs text-danger">
                  {t('renameGroupError')}{' '}
                  <span dir="ltr" className="font-mono">
                    ({rename.error})
                  </span>
                </p>
              )
            )}
          </div>

          {onOpenRoom && (
            <HostButton busy={false} onClick={onOpenRoom} primary tourId="group-open-room">
              {t('openRoomForGroup')}
            </HostButton>
          )}

          <p className="w-full text-start text-xs tracking-wide text-muted">{t('membersTitle')}</p>
          {members.length === 0 && <p className="text-sm text-muted">{t('noMembersYet')}</p>}
          {members
            .filter((member) => !removedMembers.includes(member.contactId))
            .map((member, memberIndex) => {
              const factCount = member.facts.filter(isVisible).length
              return (
                <div
                  key={member.contactId}
                  data-testid={`member-${member.contactId}`}
                  data-tour={memberIndex === 0 ? 'member-row' : undefined}
                  className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/40 p-3"
                >
                  <button
                    type="button"
                    onClick={() => openPersonPage(member.contactId)}
                    className="flex min-w-0 grow cursor-pointer items-center justify-between gap-2 text-start"
                  >
                    <span className="min-w-0 break-words font-display font-semibold text-accent-2">{member.name}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {factCount === 0
                        ? t('memberNoFacts')
                        : factCount === 1
                          ? t('memberFactCountOne')
                          : t('memberFactCount', { count: factCount })}
                      <span aria-hidden="true"> ‹</span>
                    </span>
                  </button>
                  {confirmingMemberDelete === member.contactId ? (
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      <button
                        type="button"
                        disabled={removeMember.busy}
                        onClick={() =>
                          void removeMember
                            .run(async () => {
                              await deleteContact(db, hostUid, member.contactId, groupId)
                              setRemovedMembers((prev) => [...prev, member.contactId])
                            })
                            .finally(() => setConfirmingMemberDelete(null))
                        }
                        className="cursor-pointer rounded-full bg-danger/15 px-2 py-1 text-danger"
                      >
                        {t('deleteMemberYes')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingMemberDelete(null)}
                        className="cursor-pointer rounded-full px-2 py-1 text-muted"
                      >
                        {t('deleteFactNo')}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingMemberDelete(member.contactId)}
                      aria-label={`${t('deleteMember')} - ${member.name}`}
                      className="shrink-0 cursor-pointer rounded-full bg-danger/15 px-2 py-1 text-xs text-danger"
                    >
                      {t('deleteMember')}
                    </button>
                  )}
                </div>
              )
            })}
          {removeMember.error && (
            <p role="alert" className="text-xs text-danger">
              {t('deleteMemberError')}{' '}
              <span dir="ltr" className="font-mono">
                ({removeMember.error})
              </span>
            </p>
          )}

          {/* Adding someone the group already includes but who has no contact
              yet - someone who has missed every gathering so far, or a person
              without a phone the host wants to keep notes on. */}
          {addingMember ? (
            <div className="flex w-full items-center gap-2">
              <input
                value={newMemberName}
                onChange={(event) => setNewMemberName(event.target.value)}
                placeholder={t('addMemberPlaceholder')}
                maxLength={40}
                autoFocus
                className="w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted"
              />
              <button
                type="button"
                disabled={addMember.busy || !newMemberName.trim()}
                onClick={() =>
                  void addMember.run(async () => {
                    await addGroupMember(db, hostUid, groupId, newMemberName.trim())
                    setNewMemberName('')
                    setAddingMember(false)
                    setRefreshToken((token) => token + 1)
                  })
                }
                className="shrink-0 cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
              >
                {t('addGroupSave')}
              </button>
              <button
                type="button"
                onClick={() => setAddingMember(false)}
                className="shrink-0 cursor-pointer rounded-full px-2 py-2 text-sm text-muted"
              >
                {t('addGroupCancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingMember(true)}
              data-tour="add-member"
              className="cursor-pointer self-start text-xs text-accent-2 rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 font-medium"
            >
              + {t('addMember')}
            </button>
          )}
          {addMember.error === 'member-name-taken' ? (
            <p role="alert" className="text-xs text-danger">
              {t('memberNameTaken')}
            </p>
          ) : (
            addMember.error && (
              <p role="alert" className="text-xs text-danger">
                {t('addMemberError')}{' '}
                <span dir="ltr" className="font-mono">
                  ({addMember.error})
                </span>
              </p>
            )
          )}

          <div data-tour="group-facts" className="flex w-full flex-col gap-2 rounded-xl border border-line bg-surface/40 p-3">
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

      {factErrors}

      {/* Handing the whole group to another host - a one-time copy, never a
          live link, so both sides carry on independently afterwards. See
          GroupShareDoc in model.ts for why it works this way. */}
      {!wiped && !loading && (
        <div data-tour="share-group" className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/40 p-3">
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
                className="cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2"
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
              className="cursor-pointer rounded-full bg-accent-2/15 px-4 py-2 text-sm text-accent-2 disabled:opacity-40"
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

      {/* Two separate, easily confused actions - kept as two separate
          buttons rather than one, per Nitzan's own correction: "'למחוק הכל
          על הקבוצה' נשמע כמו מחיקת המידע בלבד. צריך שיהיה כפתור 'מחיקת
          הקבוצה' וכפתור 'מחיקת כל המידע על הקבוצה'." */}
      {!wiped && !loading && (
        <>
          {infoWiped ? (
            <p className="text-sm text-accent-3">{t('wipeInfoDone')}</p>
          ) : confirmingWipeInfo ? (
            <>
              <p className="text-center text-sm">{t('wipeInfoConfirm')}</p>
              <HostButton
                busy={wipeInfo.busy}
                onClick={() =>
                  void wipeInfo.run(async () => {
                    await wipeGroupFacts(db, hostUid, groupId)
                    setConfirmingWipeInfo(false)
                    setInfoWiped(true)
                    setRefreshToken((token) => token + 1)
                  })
                }
                primary
              >
                {t('wipeInfoYes')}
              </HostButton>
              <HostButton busy={wipeInfo.busy} onClick={() => setConfirmingWipeInfo(false)}>
                {t('wipeInfoNo')}
              </HostButton>
            </>
          ) : (
            <button
              type="button"
              disabled={wipeInfo.busy}
              onClick={() => setConfirmingWipeInfo(true)}
              data-tour="wipe-info"
              className="cursor-pointer rounded-full bg-danger/15 px-4 py-2 text-sm text-danger disabled:opacity-50"
            >
              {t('wipeInfoButton')}
            </button>
          )}
          {wipeInfo.error && (
            <p role="alert" className="text-xs text-danger">
              {t('wipeInfoError')}{' '}
              <span dir="ltr" className="font-mono">
                ({wipeInfo.error})
              </span>
            </p>
          )}
        </>
      )}

      {/* Deleting the group takes its facts and its contacts with it -
          Firestore does not cascade, and a half-deleted memory is worse than
          none: the screen says it is gone while the documents remain. */}
      {!wiped &&
        !loading &&
        (confirmingDeleteGroup ? (
          <>
            <p className="text-center text-sm">{t('deleteGroupConfirm')}</p>
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
              {t('deleteGroupYes')}
            </HostButton>
            <HostButton busy={remove.busy} onClick={() => setConfirmingDeleteGroup(false)}>
              {t('deleteGroupNo')}
            </HostButton>
          </>
        ) : (
          <button
            type="button"
            disabled={remove.busy}
            onClick={() => setConfirmingDeleteGroup(true)}
            className="cursor-pointer rounded-full bg-danger/15 px-4 py-2 text-sm font-medium text-danger disabled:opacity-50"
          >
            {t('deleteGroupButton')}
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
        className="cursor-pointer self-start text-xs text-accent-2 rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 font-medium"
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
        className="shrink-0 cursor-pointer rounded-full bg-accent-2/15 px-3 py-2 text-sm text-accent-2 disabled:opacity-40"
      >
        {t('addFactSave')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 cursor-pointer rounded-full px-2 py-2 text-sm text-muted"
      >
        {t('addGroupCancel')}
      </button>
    </div>
  )
}
