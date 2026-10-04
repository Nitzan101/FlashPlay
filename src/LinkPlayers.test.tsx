import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LinkPlayers from './LinkPlayers'
import './i18n'
import type { PlayerDoc } from './lib/model'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const mockUseGroupMemory = vi.fn()
const mockLinkPlayerToContact = vi.fn()
const mockStartNewContactForPlayer = vi.fn()
const mockConfirmSamePerson = vi.fn()
const mockResetPlayerIdentity = vi.fn()

vi.mock('./lib/memory', async () => {
  const actual = await vi.importActual<typeof import('./lib/memory')>('./lib/memory')
  return {
    matchName: actual.matchName,
    useGroupMemory: (...args: unknown[]) => mockUseGroupMemory(...args) as unknown,
    linkPlayerToContact: (...args: unknown[]) => mockLinkPlayerToContact(...args) as unknown,
    startNewContactForPlayer: (...args: unknown[]) => mockStartNewContactForPlayer(...args) as unknown,
    confirmSamePerson: (...args: unknown[]) => mockConfirmSamePerson(...args) as unknown,
    resetPlayerIdentity: (...args: unknown[]) => mockResetPlayerIdentity(...args) as unknown,
  }
})

function player(id: string, name: string): PlayerDoc & { id: string } {
  return { id, name, uid: id, hasDevice: true, lastSeenAt: 0, joinedAt: 0, votedRoundId: null, leftAt: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLinkPlayerToContact.mockResolvedValue(undefined)
  mockStartNewContactForPlayer.mockResolvedValue('new-contact-id')
  mockConfirmSamePerson.mockResolvedValue(undefined)
  mockResetPlayerIdentity.mockResolvedValue(undefined)
})

describe('LinkPlayers', () => {
  it('renders nothing when the group has nobody recorded yet', () => {
    mockUseGroupMemory.mockReturnValue({ members: [], loading: false })

    const { container } = render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p1', 'דוד')]} contactIds={{}} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  // The original manual override: a returning person typed a different name
  // this time, so matchName() found nothing.
  it('offers to link a player whose name matches nobody known, to who they actually are', async () => {
    mockUseGroupMemory.mockReturnValue({
      members: [{ contactId: 'c-david', name: 'דוד', facts: [] }],
      loading: false,
    })

    render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('p1', 'Ella')]}
        contactIds={{}}
      />,
    )

    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))
    fireEvent.click(screen.getByText('דוד'))

    await waitFor(() =>
      expect(mockLinkPlayerToContact).toHaveBeenCalledWith({}, 's1', 'p1', 'c-david'),
    )
  })

  // The mirror case, added 2026-09-29: matchName() found someone, but it is
  // NOT actually the same person - "a genuine duplicate name across
  // gatherings still merges two people" (BACKLOG.md).
  it('offers to split a player who matched by name into a brand-new contact', async () => {
    mockUseGroupMemory.mockReturnValue({
      members: [{ contactId: 'c-david', name: 'דוד', facts: [] }],
      loading: false,
    })

    render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('p2', 'דוד')]}
        contactIds={{}}
      />,
    )

    fireEvent.click(screen.getByText('לא אותו אדם'))

    await waitFor(() =>
      expect(mockStartNewContactForPlayer).toHaveBeenCalledWith({}, 's1', 'p2', 'דוד'),
    )
  })

  // Once split, re-showing the same button would invite spawning yet another
  // contact on a second tap.
  it('shows a split as done rather than offering the button again', () => {
    mockUseGroupMemory.mockReturnValue({
      members: [{ contactId: 'c-david', name: 'דוד', facts: [] }],
      loading: false,
    })

    render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('p2', 'דוד')]}
        // Already overridden to a different contact than the one matchName()
        // would have picked.
        contactIds={{ p2: 'already-new-contact' }}
      />,
    )


    expect(screen.queryByText('לא אותו אדם')).not.toBeInTheDocument()
    expect(screen.getByText('נפרד ✓')).toBeInTheDocument()
  })

  it('shows both sections together when both kinds of player are present', () => {
    mockUseGroupMemory.mockReturnValue({
      members: [{ contactId: 'c-david', name: 'דוד', facts: [] }],
      loading: false,
    })

    render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('p1', 'Ella'), player('p2', 'דוד')]}
        contactIds={{}}
      />,
    )


    expect(screen.getByText('Ella')).toBeInTheDocument()
    // "דוד" appears twice - once as the suggestion chip under Ella, once as
    // the matched player's own row - so this only checks it renders at all.
    expect(screen.getAllByText('דוד').length).toBeGreaterThan(0)
    expect(screen.getByText('לא אותו אדם')).toBeInTheDocument()
  })

  it('ignores a player who has already left', () => {
    mockUseGroupMemory.mockReturnValue({
      members: [{ contactId: 'c-david', name: 'דוד', facts: [] }],
      loading: false,
    })
    const left = { ...player('p2', 'דוד'), leftAt: Date.now() }

    const { container } = render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[left]} contactIds={{}} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})

describe('LinkPlayers, recognised by name', () => {
  // Added 2026-10-02: the panel used to start collapsed, so a host never saw
  // that somebody had been matched to a returning contact by name alone.
  it('is open by itself when somebody was recognised, and says it was a guess from the name', () => {
    mockUseGroupMemory.mockReturnValue({
      members: [{ contactId: 'c-david', name: 'דוד', facts: [] }],
      loading: false,
    })

    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p2', 'דוד')]} contactIds={{}} />,
    )

    expect(screen.getByText('זוהה/ה לפי השם כמי שכבר מוכר לקבוצה')).toBeInTheDocument()
    expect(screen.getByText('לא אותו אדם')).toBeInTheDocument()
  })

  it('stays collapsed when nobody was recognised', () => {
    mockUseGroupMemory.mockReturnValue({
      members: [{ contactId: 'c-david', name: 'דוד', facts: [] }],
      loading: false,
    })

    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p1', 'Ella')]} contactIds={{}} />,
    )

    expect(screen.queryByText('לא אותו אדם')).not.toBeInTheDocument()
  })
})

describe('LinkPlayers, confirming a recognised player', () => {
  const known = { members: [{ contactId: 'c-david', name: 'דוד', facts: [] }], loading: false }

  it('lets the host confirm the match explicitly, linking the player to that very contact', async () => {
    mockUseGroupMemory.mockReturnValue(known)
    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p2', 'דוד')]} contactIds={{}} />,
    )

    fireEvent.click(screen.getByText('כן, אותו אדם'))

    await waitFor(() =>
      expect(mockConfirmSamePerson).toHaveBeenCalledWith({}, 's1', 'p2', 'c-david'),
    )
  })

  it('shows a confirmed match as confirmed, and still lets the host change their mind', () => {
    mockUseGroupMemory.mockReturnValue(known)
    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p2', 'דוד')]} contactIds={{ p2: 'c-david' }} />,
    )

    expect(screen.getByText('אושר ✓')).toBeInTheDocument()
    expect(screen.queryByText('כן, אותו אדם')).not.toBeInTheDocument()
    expect(screen.getByText('לא אותו אדם')).toBeInTheDocument()
    expect(screen.queryByText('זוהה/ה לפי השם כמי שכבר מוכר לקבוצה')).not.toBeInTheDocument()
  })
})

describe('LinkPlayers, changing a choice and never sharing a contact', () => {
  const david = { contactId: 'c-david', name: 'דוד', facts: [] }
  const dana = { contactId: 'c-dana', name: 'דנה', facts: [] }

  it('lets the host switch a split back to the same person', async () => {
    mockUseGroupMemory.mockReturnValue({ members: [david], loading: false })
    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p2', 'דוד')]} contactIds={{ p2: 'other' }} />,
    )

    fireEvent.click(screen.getByText('כן, אותו אדם'))

    await waitFor(() =>
      expect(mockConfirmSamePerson).toHaveBeenCalledWith({}, 's1', 'p2', 'c-david'),
    )
  })

  it('says a split player has been asked for another name, until they change it', () => {
    mockUseGroupMemory.mockReturnValue({ members: [david], loading: false })
    const { rerender } = render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('p2', 'דוד')]}
        contactIds={{ p2: 'other' }}
        renameRequests={{ p2: 'דוד' }}
      />,
    )
    expect(screen.getByText('נפרד ✓ · ממתין לשם חדש')).toBeInTheDocument()

    rerender(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('p2', 'דוד ב')]}
        contactIds={{ p2: 'other' }}
        renameRequests={{ p2: 'דוד' }}
      />,
    )
    expect(screen.queryByText('נפרד ✓ · ממתין לשם חדש')).not.toBeInTheDocument()
  })

  it('does not offer a contact somebody else already counts as', () => {
    mockUseGroupMemory.mockReturnValue({ members: [david, dana], loading: false })
    render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        // p1 typed something unknown; p2 was recognised as David by name.
        players={[player('p1', 'Ella'), player('p2', 'דוד')]}
        contactIds={{}}
      />,
    )

    const davidChip = screen.getAllByText('דוד').find((el) => el.tagName === 'BUTTON')!
    expect(davidChip).toBeDisabled()
    expect(screen.getByText('דנה')).toBeEnabled()
  })

  it('frees a contact again once the player holding it is switched away', () => {
    mockUseGroupMemory.mockReturnValue({ members: [david, dana], loading: false })
    render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('p1', 'Ella'), player('p2', 'דוד')]}
        contactIds={{ p2: 'split-off' }}
      />,
    )

    const davidChip = screen.getAllByText('דוד').find((el) => el.tagName === 'BUTTON')!
    expect(davidChip).toBeEnabled()
  })

  it('takes a link back when the chosen contact is tapped again', async () => {
    mockUseGroupMemory.mockReturnValue({ members: [david], loading: false })
    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p1', 'Ella')]} contactIds={{ p1: 'c-david' }} />,
    )
    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))

    fireEvent.click(screen.getByText('דוד ✓'))

    await waitFor(() => expect(mockResetPlayerIdentity).toHaveBeenCalledWith({}, 's1', 'p1'))
  })
})

describe('LinkPlayers, the host is always themselves', () => {
  const hostMember = { contactId: 'c-host', name: 'מארח', claimedByUid: 'host', facts: [] }
  const david = { contactId: 'c-david', name: 'דוד', facts: [] }

  it('never asks about the host, even under a name the group does not know', () => {
    mockUseGroupMemory.mockReturnValue({ members: [hostMember, david], loading: false })

    const { container } = render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('host', 'שם חדש')]} contactIds={{}} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('does not offer the host’s contact to anybody else', () => {
    mockUseGroupMemory.mockReturnValue({ members: [hostMember, david], loading: false })
    render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('host', 'שם חדש'), player('p1', 'Ella')]}
        contactIds={{}}
      />,
    )
    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))

    expect(screen.queryByText('מארח')).not.toBeInTheDocument()
    expect(screen.getByText('דוד')).toBeInTheDocument()
  })

  it('treats a guest who types the host’s old name as unknown, not as the host', () => {
    mockUseGroupMemory.mockReturnValue({ members: [hostMember, david], loading: false })
    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p1', 'מארח')]} contactIds={{}} />,
    )
    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))

    expect(screen.queryByText('זוהה/ה לפי השם כמי שכבר מוכר לקבוצה')).not.toBeInTheDocument()
    expect(screen.getByText('דוד')).toBeInTheDocument()
  })
})

describe('LinkPlayers, registered accounts beyond the host', () => {
  const noa = { contactId: 'c-noa', name: 'נועה', claimedByUid: 'noa-uid', facts: [] }
  const david = { contactId: 'c-david', name: 'דוד', claimedByUid: null, facts: [] }

  it('never asks about a registered guest whose account already owns a contact', () => {
    mockUseGroupMemory.mockReturnValue({ members: [noa, david], loading: false })

    const { container } = render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('noa-uid', 'שם אחר')]} contactIds={{}} />,
    )

    // Nothing to ask: the only member left is David, and nobody present needs a match.
    expect(container).toBeEmptyDOMElement()
  })

  it('offers a claimed contact to an anonymous player when its owner is not in the room', () => {
    mockUseGroupMemory.mockReturnValue({ members: [noa, david], loading: false })
    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('p1', 'Ella')]} contactIds={{}} />,
    )
    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))

    expect(screen.getByText('נועה')).toBeEnabled()
  })

  it('keeps that contact away from everybody else while its owner is in the room', () => {
    mockUseGroupMemory.mockReturnValue({ members: [noa, david], loading: false })
    render(
      <LinkPlayers
        sessionId="s1"
        hostUid="host"
        groupId="g1"
        players={[player('noa-uid', 'נועה'), player('p1', 'Ella')]}
        contactIds={{}}
      />,
    )
    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))

    expect(screen.queryByText('נועה')).not.toBeInTheDocument()
    expect(screen.getByText('דוד')).toBeInTheDocument()
  })

  it('still asks about a registered guest with no claimed contact yet, when their name matches an old one', () => {
    mockUseGroupMemory.mockReturnValue({ members: [noa, david], loading: false })
    render(
      <LinkPlayers sessionId="s1" hostUid="host" groupId="g1" players={[player('new-uid', 'דוד')]} contactIds={{}} />,
    )

    expect(screen.getByText('זוהה/ה לפי השם כמי שכבר מוכר לקבוצה')).toBeInTheDocument()
  })
})
