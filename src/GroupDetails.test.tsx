import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GroupDetails from './GroupDetails'
import { PROFILE_QUESTIONS } from './content/profileQuestions'
import './i18n'
import { SAVED_NOTICE_MS } from './lib/useFlash'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const mockAddManualFact = vi.fn().mockResolvedValue(undefined)
const mockAddManualGroupFact = vi.fn().mockResolvedValue(undefined)
const mockUseGroupMemory = vi.fn()
const mockDeleteContact = vi.fn().mockResolvedValue(undefined)
const mockAddGroupMember = vi.fn().mockResolvedValue('new-contact')
const mockWipeGroupFacts = vi.fn().mockResolvedValue(undefined)
const mockDeleteGroup = vi.fn().mockResolvedValue(undefined)
const mockSetContactQuestionAnswer = vi.fn().mockResolvedValue(undefined)
vi.mock('./lib/memory', async () => {
  // The pure text converters are the real ones - they are what turns a
  // stored fact back into chips, so faking them would test nothing.
  const actual = await vi.importActual<typeof import('./lib/memory')>('./lib/memory')
  return {
  useGroupMemory: (...args: unknown[]) => mockUseGroupMemory(...args) as unknown,
  deleteFact: vi.fn(),
  deleteGroup: (...args: unknown[]) => mockDeleteGroup(...args) as unknown,
  deleteContact: (...args: unknown[]) => mockDeleteContact(...args) as unknown,
  addGroupMember: (...args: unknown[]) => mockAddGroupMember(...args) as unknown,
  wipeGroupFacts: (...args: unknown[]) => mockWipeGroupFacts(...args) as unknown,
  nameGroup: vi.fn(),
  addManualFact: (...args: unknown[]) => mockAddManualFact(...args) as unknown,
  addManualGroupFact: (...args: unknown[]) => mockAddManualGroupFact(...args) as unknown,
  setContactQuestionAnswer: (...args: unknown[]) =>
    mockSetContactQuestionAnswer(...args) as unknown,
  answerFromFactText: actual.answerFromFactText,
  answerFromText: actual.answerFromText,
  answerToText: actual.answerToText,
  }
})
vi.mock('./lib/profileQuestions', () => ({
  useCustomQuestions: () => ({
    questions: [{ id: 'custom1', text: 'שאלה של המארח', kind: 'text' }],
    loading: false,
    error: null,
  }),
}))

afterEach(() => {
  vi.clearAllMocks()
})

function memoryOf(members: { contactId: string; name: string; facts: unknown[] }[]) {
  mockUseGroupMemory.mockReturnValue({
    groupName: 'המשפחה',
    members,
    groupFacts: [],
    loading: false,
    error: null,
  })
}

describe("adding a fact from a person's own card", () => {
  it('is closed by default, and opens an input on tap', () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidCard = within(screen.getByTestId('member-c1'))

    expect(davidCard.queryByPlaceholderText('מה כדאי לזכור?')).not.toBeInTheDocument()
    fireEvent.click(davidCard.getByRole('button', { name: '+ הוספת פרט' }))
    expect(davidCard.getByPlaceholderText('מה כדאי לזכור?')).toBeInTheDocument()
  })

  it("saves the note against that person's own contact id", async () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidCard = within(screen.getByTestId('member-c1'))

    fireEvent.click(davidCard.getByRole('button', { name: '+ הוספת פרט' }))
    fireEvent.change(davidCard.getByPlaceholderText('מה כדאי לזכור?'), {
      target: { value: 'אוהב פיצה אננס' },
    })
    fireEvent.click(davidCard.getByRole('button', { name: 'שמירה' }))

    await waitFor(() =>
      expect(mockAddManualFact).toHaveBeenCalledWith(
        expect.anything(),
        'host-uid',
        'c1',
        'אוהב פיצה אננס',
      ),
    )
    expect(mockAddManualGroupFact).not.toHaveBeenCalled()
  })

  it('opens at most one box at a time, across two different people', () => {
    memoryOf([
      { contactId: 'c1', name: 'דוד', facts: [] },
      { contactId: 'c2', name: 'שרה', facts: [] },
    ])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    const [davidToggle, saraToggle] = screen.getAllByRole('button', { name: '+ הוספת פרט' })
    fireEvent.click(davidToggle)
    expect(screen.getAllByPlaceholderText('מה כדאי לזכור?')).toHaveLength(1)

    fireEvent.click(saraToggle)
    // Opening the second closed the first rather than allowing both at once -
    // a half-typed note left behind in another row would be easy to lose
    // track of.
    expect(screen.getAllByPlaceholderText('מה כדאי לזכור?')).toHaveLength(1)
  })
})

describe('deleting a person from the group', () => {
  it('asks for confirmation, then deletes the contact', async () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'מחיקת איש קשר - דוד' }))
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }))

    await waitFor(() =>
      expect(mockDeleteContact).toHaveBeenCalledWith(expect.anything(), 'host-uid', 'c1', 'g1'),
    )
    // The row disappears once deleted - a deleted person should not still
    // look like a member of the group.
    expect(screen.queryByText('דוד')).not.toBeInTheDocument()
  })

  it('does nothing on cancel', () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'מחיקת איש קשר - דוד' }))
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(mockDeleteContact).not.toHaveBeenCalled()
    expect(screen.getByText('דוד')).toBeInTheDocument()
  })
})

describe('adding a person to the group', () => {
  it('adds a new member by name', async () => {
    memoryOf([])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '+ הוספת איש קשר' }))
    fireEvent.change(screen.getByPlaceholderText('שם המשתתף/ת'), { target: { value: 'סבתא' } })
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }))

    await waitFor(() =>
      expect(mockAddGroupMember).toHaveBeenCalledWith(expect.anything(), 'host-uid', 'g1', 'סבתא'),
    )
  })

  it('says plainly when the name is already in the group', async () => {
    mockAddGroupMember.mockRejectedValueOnce(new Error('member-name-taken'))
    memoryOf([{ contactId: 'c1', name: 'אלה', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '+ הוספת איש קשר' }))
    fireEvent.change(screen.getByPlaceholderText('שם המשתתף/ת'), { target: { value: 'אלה' } })
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }))

    expect(
      await screen.findByText(
        'כבר יש בקבוצה מישהו בשם הזה. אם זה אדם אחר, אפשר להוסיף שם משפחה או כינוי כדי להבדיל ביניהם.',
      ),
    ).toBeInTheDocument()
  })
})

describe('wiping the group\'s info without deleting the group', () => {
  it('is a separate button and action from deleting the whole group', async () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'מחיקת כל המידע על הקבוצה' }))
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק את המידע' }))

    await waitFor(() =>
      expect(mockWipeGroupFacts).toHaveBeenCalledWith(expect.anything(), 'host-uid', 'g1'),
    )
    expect(mockDeleteGroup).not.toHaveBeenCalled()
    // The group itself is still there - only the memory was wiped.
    expect(screen.getByText('דוד')).toBeInTheDocument()
  })
})

// Asked for directly, 2026-09-22: "רשימת השאלות עבור אדם בלחיצה על עריכתו".
describe("a person's guided questions", () => {
  it('lists every question - built-in and the host\'s own - once opened', () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidCard = within(screen.getByTestId('member-c1'))

    expect(davidCard.queryByText('התחביב שלך')).not.toBeInTheDocument()
    fireEvent.click(davidCard.getByRole('button', { name: 'עריכת השאלות המנחות' }))

    expect(davidCard.getByText('התחביב שלך')).toBeInTheDocument()
    expect(davidCard.getByText('שאלה של המארח')).toBeInTheDocument()
  })

  it("pre-fills an existing answer with just the answer, not the question prefix", () => {
    memoryOf([
      {
        contactId: 'c1',
        name: 'דוד',
        facts: [{ path: 'p1', text: 'התחביב שלך: ציור', who: 'דוד', promptId: 'hobby' }],
      },
    ])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidCard = within(screen.getByTestId('member-c1'))

    fireEvent.click(davidCard.getByRole('button', { name: 'עריכת השאלות המנחות' }))

    expect(davidCard.getByRole('textbox', { name: 'התחביב שלך' })).toHaveValue('ציור')
  })

  it("saves an answer against that person and that question", async () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidCard = within(screen.getByTestId('member-c1'))

    fireEvent.click(davidCard.getByRole('button', { name: 'עריכת השאלות המנחות' }))
    fireEvent.change(davidCard.getByRole('textbox', { name: 'התחביב שלך' }), {
      target: { value: 'ריצה' },
    })
    fireEvent.click(davidCard.getByRole('button', { name: 'שמירה - התחביב שלך' }))

    await waitFor(() =>
      expect(mockSetContactQuestionAnswer).toHaveBeenCalledWith(
        expect.anything(),
        'host-uid',
        'c1',
        expect.objectContaining({ id: 'hobby' }),
        'ריצה',
      ),
    )
  })

  // Asked 2026-09-23 why these were not "אמריקאי" like the lobby: a plain
  // field with the options crammed into its placeholder cut most of them off.
  it('shows a stored multi-choice answer as chips, and saves it back as text', async () => {
    const multi = PROFILE_QUESTIONS.find((q) => q.kind === 'multi-choice')!
    const [first, second, third] = multi.options!
    memoryOf([
      {
        contactId: 'c1',
        name: 'דוד',
        facts: [
          { path: 'p1', text: `${multi.text}: ${first}, משהו משלי`, who: 'דוד', promptId: multi.id },
        ],
      },
    ])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidCard = within(screen.getByTestId('member-c1'))
    fireEvent.click(davidCard.getByRole('button', { name: 'עריכת השאלות המנחות' }))
    const row = within(davidCard.getByRole('group', { name: multi.text }))

    expect(row.getByRole('button', { name: first })).toHaveAttribute('aria-pressed', 'true')
    expect(row.getByRole('button', { name: second })).toHaveAttribute('aria-pressed', 'false')
    expect(row.getByRole('button', { name: 'אחר' })).toHaveAttribute('aria-pressed', 'true')
    expect(davidCard.getByRole('textbox', { name: `אחר - ${multi.text}` })).toHaveValue(
      'משהו משלי',
    )

    fireEvent.click(row.getByRole('button', { name: third }))
    fireEvent.click(davidCard.getByRole('button', { name: `שמירה - ${multi.text}` }))

    await waitFor(() =>
      expect(mockSetContactQuestionAnswer).toHaveBeenCalledWith(
        expect.anything(),
        'host-uid',
        'c1',
        expect.objectContaining({ id: multi.id }),
        `${first}, ${third}, משהו משלי`,
      ),
    )
  })

  // Asked for directly, 2026-09-23: "נשמר" should acknowledge a save and then
  // go away, not sit there indefinitely.
  it('shows "saved" only after a save, and clears it a few seconds later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      memoryOf([
        {
          contactId: 'c1',
          name: 'דוד',
          facts: [{ path: 'p1', text: 'התחביב שלך: ציור', who: 'דוד', promptId: 'hobby' }],
        },
      ])
      render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
      const davidCard = within(screen.getByTestId('member-c1'))
      fireEvent.click(davidCard.getByRole('button', { name: 'עריכת השאלות המנחות' }))

      // An answer that was already there is not a save that just happened.
      expect(davidCard.queryByText('נשמר ✓')).not.toBeInTheDocument()

      fireEvent.change(davidCard.getByRole('textbox', { name: 'התחביב שלך' }), {
        target: { value: 'ריצה' },
      })
      fireEvent.click(davidCard.getByRole('button', { name: 'שמירה - התחביב שלך' }))
      expect(await davidCard.findByText('נשמר ✓')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(SAVED_NOTICE_MS))
      expect(davidCard.queryByText('נשמר ✓')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('adding a fact to the group itself', () => {
  it("saves against the group, distinctly from any one person's contact", async () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    const groupSection = screen.getByText('על הקבוצה').closest('div')!
    fireEvent.click(within(groupSection).getByRole('button', { name: '+ הוספת פרט' }))
    fireEvent.change(within(groupSection).getByPlaceholderText('מה כדאי לזכור?'), {
      target: { value: 'תמיד מגיעים באיחור' },
    })
    fireEvent.click(within(groupSection).getByRole('button', { name: 'שמירה' }))

    await waitFor(() =>
      expect(mockAddManualGroupFact).toHaveBeenCalledWith(
        expect.anything(),
        'host-uid',
        'g1',
        'תמיד מגיעים באיחור',
      ),
    )
    expect(mockAddManualFact).not.toHaveBeenCalled()
  })
})
