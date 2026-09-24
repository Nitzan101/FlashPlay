import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GroupDetails from './GroupDetails'
import { PROFILE_QUESTIONS } from './content/profileQuestions'
import './i18n'
import { TOURS } from './lib/tutorial'
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

/** Opens one person's own page from the group page's list, and returns it. */
function openPerson(contactId: string, name: string) {
  fireEvent.click(within(screen.getByTestId(`member-${contactId}`)).getByRole('button', { name: new RegExp(`^${name}`) }))
  return within(screen.getByTestId('person-page'))
}

describe("adding a fact from a person's own page", () => {
  it('is closed by default, and opens an input on tap', () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidPage = openPerson('c1', 'דוד')

    expect(davidPage.queryByPlaceholderText('מה כדאי לזכור?')).not.toBeInTheDocument()
    fireEvent.click(davidPage.getByRole('button', { name: '+ הוספת פרט' }))
    expect(davidPage.getByPlaceholderText('מה כדאי לזכור?')).toBeInTheDocument()
  })

  it("saves the note against that person's own contact id", async () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidPage = openPerson('c1', 'דוד')

    fireEvent.click(davidPage.getByRole('button', { name: '+ הוספת פרט' }))
    fireEvent.change(davidPage.getByPlaceholderText('מה כדאי לזכור?'), {
      target: { value: 'אוהב פיצה אננס' },
    })
    fireEvent.click(davidPage.getByRole('button', { name: 'שמירה' }))

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
})

// Asked for directly, 2026-09-23: with any real history, every person's
// facts and questions stacked on one page became a wall.
describe('the group page lists people; each person has their own page', () => {
  const fact = (path: string, text: string, who: string) => ({ path, text, who, promptId: null })

  it('shows each name with how much is saved, not the facts themselves', () => {
    memoryOf([
      {
        contactId: 'c1',
        name: 'דוד',
        facts: [fact('p1', 'אוהב פיצה', 'דוד'), fact('p2', 'גר בחיפה', 'דוד')],
      },
      { contactId: 'c2', name: 'שרה', facts: [fact('p3', 'מנגנת', 'שרה')] },
      { contactId: 'c3', name: 'אלה', facts: [] },
    ])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    expect(within(screen.getByTestId('member-c1')).getByText('2 פרטים')).toBeInTheDocument()
    expect(within(screen.getByTestId('member-c2')).getByText('פרט אחד')).toBeInTheDocument()
    expect(within(screen.getByTestId('member-c3')).getByText('טרם נשמר מידע')).toBeInTheDocument()
    expect(screen.queryByText('אוהב פיצה')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'עריכת השאלות המנחות' })).not.toBeInTheDocument()
  })

  it("opens one person's page with only their facts, and goes back to the list", () => {
    memoryOf([
      { contactId: 'c1', name: 'דוד', facts: [fact('p1', 'אוהב פיצה', 'דוד')] },
      { contactId: 'c2', name: 'שרה', facts: [fact('p3', 'מנגנת', 'שרה')] },
    ])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)

    const page = openPerson('c1', 'דוד')

    expect(page.getByText('אוהב פיצה')).toBeInTheDocument()
    expect(screen.queryByText('מנגנת')).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-c2')).not.toBeInTheDocument()

    fireEvent.click(page.getAllByRole('button', { name: /חזרה לקבוצה/ })[0])

    expect(screen.queryByTestId('person-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('member-c2')).toBeInTheDocument()
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
    const davidPage = openPerson('c1', 'דוד')

    expect(davidPage.queryByText('התחביב שלך')).not.toBeInTheDocument()
    fireEvent.click(davidPage.getByRole('button', { name: 'עריכת השאלות המנחות' }))

    expect(davidPage.getByText('התחביב שלך')).toBeInTheDocument()
    expect(davidPage.getByText('שאלה של המארח')).toBeInTheDocument()
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
    const davidPage = openPerson('c1', 'דוד')

    fireEvent.click(davidPage.getByRole('button', { name: 'עריכת השאלות המנחות' }))

    expect(davidPage.getByRole('textbox', { name: 'התחביב שלך' })).toHaveValue('ציור')
  })

  it("saves an answer against that person and that question", async () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidPage = openPerson('c1', 'דוד')

    fireEvent.click(davidPage.getByRole('button', { name: 'עריכת השאלות המנחות' }))
    fireEvent.change(davidPage.getByRole('textbox', { name: 'התחביב שלך' }), {
      target: { value: 'ריצה' },
    })
    fireEvent.click(davidPage.getByRole('button', { name: 'שמירה - התחביב שלך' }))

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

  // Found live 2026-09-23, step by step: an answer saved from here appeared
  // as a row in the person's list; deleting that row left the field still
  // showing the answer, as already saved (so it could not be saved again),
  // and saving a changed answer never brought the row back.
  it('clears the field when its row is deleted, and shows the row again once re-saved', async () => {
    const fact = {
      path: 'users/host-uid/contacts/c1/facts/profile_hobby',
      text: 'התחביב שלך: להכין שניצלים',
      who: 'אלה',
      promptId: 'hobby',
    }
    memoryOf([{ contactId: 'c1', name: 'אלה', facts: [fact] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const card = openPerson('c1', 'אלה')
    fireEvent.click(card.getByRole('button', { name: 'עריכת השאלות המנחות' }))
    expect(card.getByRole('textbox', { name: 'התחביב שלך' })).toHaveValue('להכין שניצלים')

    fireEvent.click(card.getByRole('button', { name: `מחיקה - ${fact.text}` }))
    fireEvent.click(card.getByRole('button', { name: 'כן, למחוק' }))

    await waitFor(() =>
      expect(card.getByRole('textbox', { name: 'התחביב שלך' })).toHaveValue(''),
    )
    expect(card.queryByText(fact.text)).not.toBeInTheDocument()

    // The next load finds the fact written again, at the same fixed path.
    memoryOf([{ contactId: 'c1', name: 'אלה', facts: [{ ...fact }] }])
    fireEvent.change(card.getByRole('textbox', { name: 'התחביב שלך' }), {
      target: { value: 'להכין שניצלים' },
    })
    fireEvent.click(card.getByRole('button', { name: 'שמירה - התחביב שלך' }))

    await waitFor(() => expect(mockSetContactQuestionAnswer).toHaveBeenCalled())
    expect(await card.findByText(fact.text)).toBeInTheDocument()
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
    const davidPage = openPerson('c1', 'דוד')
    fireEvent.click(davidPage.getByRole('button', { name: 'עריכת השאלות המנחות' }))
    const row = within(davidPage.getByRole('group', { name: multi.text }))

    expect(row.getByRole('button', { name: first })).toHaveAttribute('aria-pressed', 'true')
    expect(row.getByRole('button', { name: second })).toHaveAttribute('aria-pressed', 'false')
    expect(row.getByRole('button', { name: 'אחר' })).toHaveAttribute('aria-pressed', 'true')
    expect(davidPage.getByRole('textbox', { name: `אחר - ${multi.text}` })).toHaveValue(
      'משהו משלי',
    )

    fireEvent.click(row.getByRole('button', { name: third }))
    fireEvent.click(davidPage.getByRole('button', { name: `שמירה - ${multi.text}` }))

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
      const davidPage = openPerson('c1', 'דוד')
      fireEvent.click(davidPage.getByRole('button', { name: 'עריכת השאלות המנחות' }))

      // An answer that was already there is not a save that just happened.
      expect(davidPage.queryByText('נשמר ✓')).not.toBeInTheDocument()

      fireEvent.change(davidPage.getByRole('textbox', { name: 'התחביב שלך' }), {
        target: { value: 'ריצה' },
      })
      fireEvent.click(davidPage.getByRole('button', { name: 'שמירה - התחביב שלך' }))
      expect(await davidPage.findByText('נשמר ✓')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(SAVED_NOTICE_MS))
      expect(davidPage.queryByText('נשמר ✓')).not.toBeInTheDocument()
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

// See App.test.tsx, "in-app help": a missing anchor silently drops a stop.
describe('in-app help anchors', () => {
  const missingStops = (tour: 'group' | 'person') =>
    TOURS[tour].map((step) => step.target).filter((target) => !document.querySelector(`[data-tour="${target}"]`))

  it("has every control of the group page's tour on screen", () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} onOpenRoom={() => {}} />)
    expect(missingStops('group')).toEqual([])
  })

  it("has every control of a person page's tour on screen", () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    openPerson('c1', 'דוד')
    expect(missingStops('person')).toEqual([])
  })
})
