import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Harvest from './Harvest'
import './i18n'
import { HARVEST_PROMPTS } from './content/prompts'

// Harvest.tsx reaches Firestore only through ./lib/harvest, so mocking that
// module is enough to drive every screen state from the test. `db` is mocked
// because the real firebase.ts throws at import time without env vars.
vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const mockGetSubmissionState = vi.fn()
const mockSubmitHarvestItem = vi.fn()
const mockAdvanceGamePhase = vi.fn()
const mockExtendGamePhase = vi.fn()

vi.mock('./lib/harvest', () => ({
  getSubmissionState: (...args: unknown[]) => mockGetSubmissionState(...args),
  submitHarvestItem: (...args: unknown[]) => mockSubmitHarvestItem(...args),
  advanceGamePhase: (...args: unknown[]) => mockAdvanceGamePhase(...args),
  extendGamePhase: (...args: unknown[]) => mockExtendGamePhase(...args),
  useHarvestProgress: () => ({ submittedCount: 3, error: null }),
}))

const PROMPT = HARVEST_PROMPTS[0].id
const OTHER_PROMPT = HARVEST_PROMPTS[1].id

function renderHarvest(isHost = false) {
  return render(
    <Harvest
      sessionId="session1"
      gameId="game1"
      promptIds={[PROMPT, OTHER_PROMPT]}
      phaseEndsAt={Date.now() + 90_000}
      uid="player-uid"
      isHost={isHost}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSubmissionState.mockResolvedValue('none')
  mockSubmitHarvestItem.mockResolvedValue(undefined)
})

describe('Harvest', () => {
  it('offers an answer field for each prompt', async () => {
    renderHarvest()

    expect(screen.getByText(HARVEST_PROMPTS[0].text)).toBeInTheDocument()
    expect(screen.getByText(HARVEST_PROMPTS[1].text)).toBeInTheDocument()
    expect(await screen.findAllByPlaceholderText('התשובה שלך')).toHaveLength(2)
  })

  it('sends an answer and then shows it as sent', async () => {
    renderHarvest()
    const [input] = await screen.findAllByPlaceholderText('התשובה שלך')

    fireEvent.change(input, { target: { value: 'my answer' } })
    fireEvent.click(screen.getAllByText('שליחה')[0])

    await waitFor(() => expect(mockSubmitHarvestItem).toHaveBeenCalledTimes(1))
    expect(mockSubmitHarvestItem.mock.calls[0].slice(1, 6)).toEqual([
      'session1',
      'game1',
      PROMPT,
      'player-uid',
      'my answer',
    ])
    expect(await screen.findByText('נשלח ✓')).toBeInTheDocument()
  })

  it('resumes an already-answered prompt after a refresh', async () => {
    mockGetSubmissionState.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[3] === PROMPT ? 'complete' : 'none'),
    )
    renderHarvest()

    expect(await screen.findByText('נשלח ✓')).toBeInTheDocument()
    // The other prompt is still open, so exactly one input remains.
    expect(screen.getAllByPlaceholderText('התשובה שלך')).toHaveLength(1)
  })

  // The regression guard for the defect the milestone-4 review found: a slot
  // reserved by a device that died before writing its item is NOT an answer,
  // and showing it as one told a player their answer was in when nothing of it
  // existed. An incomplete slot must offer the input again - submitting into
  // it resumes that slot (see submitHarvestItem).
  it('treats a reserved-but-unwritten submission as unanswered', async () => {
    mockGetSubmissionState.mockResolvedValue('incomplete')
    renderHarvest()

    await waitFor(() => expect(mockGetSubmissionState).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('נשלח ✓')).not.toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('התשובה שלך')).toHaveLength(2)
  })

  it('shows the host the override controls, and other players none', async () => {
    renderHarvest(false)
    expect(screen.queryByText('עוד דקה')).not.toBeInTheDocument()
    expect(screen.queryByText('מעבר הלאה')).not.toBeInTheDocument()

    renderHarvest(true)
    fireEvent.click(screen.getByText('עוד דקה'))
    await waitFor(() => expect(mockExtendGamePhase).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('מעבר הלאה'))
    await waitFor(() => expect(mockAdvanceGamePhase).toHaveBeenCalledTimes(1))
    expect(mockAdvanceGamePhase.mock.calls[0][3]).toBe('rounds')
  })

  it('surfaces a failed submission with its error code, and keeps the field', async () => {
    mockSubmitHarvestItem.mockRejectedValue({ code: 'permission-denied' })
    renderHarvest()
    const [input] = await screen.findAllByPlaceholderText('התשובה שלך')

    fireEvent.change(input, { target: { value: 'my answer' } })
    fireEvent.click(screen.getAllByText('שליחה')[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('permission-denied')
    expect(screen.getAllByPlaceholderText('התשובה שלך')).toHaveLength(2)
  })
})
