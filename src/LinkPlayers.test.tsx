import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LinkPlayers from './LinkPlayers'
import './i18n'
import type { PlayerDoc } from './lib/model'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const mockUseGroupMemory = vi.fn()
const mockLinkPlayerToContact = vi.fn()
const mockStartNewContactForPlayer = vi.fn()

vi.mock('./lib/memory', async () => {
  const actual = await vi.importActual<typeof import('./lib/memory')>('./lib/memory')
  return {
    matchName: actual.matchName,
    useGroupMemory: (...args: unknown[]) => mockUseGroupMemory(...args) as unknown,
    linkPlayerToContact: (...args: unknown[]) => mockLinkPlayerToContact(...args) as unknown,
    startNewContactForPlayer: (...args: unknown[]) => mockStartNewContactForPlayer(...args) as unknown,
  }
})

function player(id: string, name: string): PlayerDoc & { id: string } {
  return { id, name, uid: id, hasDevice: true, lastSeenAt: 0, joinedAt: 0, votedRoundId: null, leftAt: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLinkPlayerToContact.mockResolvedValue(undefined)
  mockStartNewContactForPlayer.mockResolvedValue('new-contact-id')
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

    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))
    fireEvent.click(screen.getByText('לא אותו אדם'))

    await waitFor(() =>
      expect(mockStartNewContactForPlayer).toHaveBeenCalledWith({}, 's1', 'p2'),
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

    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))

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

    fireEvent.click(screen.getByText('מישהו כאן שכבר מוכר לקבוצה?'))

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
