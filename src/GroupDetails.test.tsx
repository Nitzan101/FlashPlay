import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GroupDetails from './GroupDetails'
import './i18n'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const mockAddManualFact = vi.fn().mockResolvedValue(undefined)
const mockAddManualGroupFact = vi.fn().mockResolvedValue(undefined)
const mockUseGroupMemory = vi.fn()
vi.mock('./lib/memory', () => ({
  useGroupMemory: (...args: unknown[]) => mockUseGroupMemory(...args) as unknown,
  deleteFact: vi.fn(),
  deleteGroup: vi.fn(),
  nameGroup: vi.fn(),
  addManualFact: (...args: unknown[]) => mockAddManualFact(...args) as unknown,
  addManualGroupFact: (...args: unknown[]) => mockAddManualGroupFact(...args) as unknown,
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
    const davidCard = within(screen.getByText('דוד').closest('div')!)

    expect(davidCard.queryByPlaceholderText('מה כדאי לזכור?')).not.toBeInTheDocument()
    fireEvent.click(davidCard.getByRole('button', { name: '+ הוספת פרט' }))
    expect(davidCard.getByPlaceholderText('מה כדאי לזכור?')).toBeInTheDocument()
  })

  it("saves the note against that person's own contact id", async () => {
    memoryOf([{ contactId: 'c1', name: 'דוד', facts: [] }])
    render(<GroupDetails hostUid="host-uid" groupId="g1" onClose={() => {}} />)
    const davidCard = within(screen.getByText('דוד').closest('div')!)

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
