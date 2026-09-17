import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Rounds from './Rounds'
import './i18n'
import { HARVEST_PROMPTS } from './content/prompts'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const HOST = 'host-uid'
const PLAYER = 'player-uid'
const THIRD = 'third-uid'

interface RosterEntry {
  id: string
  name: string
  uid: string
  hasDevice: boolean
  lastSeenAt: number
  joinedAt: number
  votedRoundId: string | null
}

let roster: RosterEntry[]
let rosterError: string | null

vi.mock('./lib/room', () => ({
  useRoster: () => ({ players: roster, error: rosterError }),
  errorCode: (error: unknown) =>
    (error as { code?: string })?.code ?? String(error),
}))

const mockRounds = vi.fn()
const mockItems = vi.fn()
const mockVotes = vi.fn()
const mockAuthor = vi.fn()
const mockGetMyVote = vi.fn()
const mockCastVote = vi.fn()
const mockOpenNextRound = vi.fn()
const mockOpenVoting = vi.fn()
const mockSkipRound = vi.fn()
const mockRevealRound = vi.fn()
const mockFinishGame = vi.fn()

vi.mock('./lib/rounds', async () => {
  // scoreRound is pure arithmetic - the real one, so the screen's per-round
  // points are checked against the same function the host writes with.
  const actual = await vi.importActual<typeof import('./lib/rounds')>('./lib/rounds')
  return {
    scoreRound: actual.scoreRound,
    useRounds: () => mockRounds(),
    useItems: () => mockItems(),
    useVotes: () => mockVotes(),
    useAuthor: (...args: unknown[]) => mockAuthor(...args),
    getMyVote: (...args: unknown[]) => mockGetMyVote(...args),
    castVote: (...args: unknown[]) => mockCastVote(...args),
    openNextRound: (...args: unknown[]) => mockOpenNextRound(...args),
    openVoting: (...args: unknown[]) => mockOpenVoting(...args),
    skipRound: (...args: unknown[]) => mockSkipRound(...args),
    revealRound: (...args: unknown[]) => mockRevealRound(...args),
    finishGame: (...args: unknown[]) => mockFinishGame(...args),
  }
})

const PROMPT = HARVEST_PROMPTS[0].id

function round(phase: string, extra: Record<string, unknown> = {}) {
  return { id: 'round1', gameId: 'game1', itemId: 'item1', phase, order: 0, startedAt: 0, ...extra }
}

function renderRounds(isHost = false, scores: Record<string, number> = {}) {
  return render(
    <Rounds sessionId="s1" gameId="game1" uid={THIRD} isHost={isHost} scores={scores} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  roster = [
    { id: HOST, name: 'Host', uid: HOST, hasDevice: true, lastSeenAt: 0, joinedAt: 1, votedRoundId: null },
    { id: PLAYER, name: 'Player', uid: PLAYER, hasDevice: true, lastSeenAt: 0, joinedAt: 2, votedRoundId: null },
    { id: THIRD, name: 'Third', uid: THIRD, hasDevice: true, lastSeenAt: 0, joinedAt: 3, votedRoundId: null },
  ]
  rosterError = null
  mockRounds.mockReturnValue({ loading: false, rounds: [], error: null })
  mockItems.mockReturnValue({
    loading: false,
    items: {
      item1: { gameId: 'game1', text: 'the answer', promptId: PROMPT, revealed: false, createdAt: 0 },
      item2: { gameId: 'game1', text: 'another', promptId: PROMPT, revealed: false, createdAt: 0 },
    },
    error: null,
  })
  mockVotes.mockReturnValue({ votes: {}, error: null })
  mockAuthor.mockReturnValue({ authorPlayerId: null, error: null })
  mockGetMyVote.mockResolvedValue(null)
  mockCastVote.mockResolvedValue(undefined)
  mockOpenNextRound.mockResolvedValue('round1')
  mockRevealRound.mockResolvedValue(undefined)
  mockFinishGame.mockResolvedValue(undefined)
})

describe('Rounds', () => {
  it('lets the host open the first round, and shows everyone else a wait', () => {
    renderRounds(false)
    expect(screen.getByText('המנחה מקריא/ה עוד רגע')).toBeInTheDocument()
    expect(screen.queryByText('התחלת הסבב הראשון')).not.toBeInTheDocument()

    renderRounds(true)
    fireEvent.click(screen.getByText('התחלת הסבב הראשון'))
    expect(mockOpenNextRound).toHaveBeenCalledTimes(1)
  })

  // The preview exists so the host can decide whether the room hears this at
  // all - which only works if the room is not already reading it.
  it('shows a previewed item to the host alone', () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('preview')], error: null })

    const player = renderRounds(false)
    expect(screen.queryByText('the answer')).not.toBeInTheDocument()
    player.unmount()

    renderRounds(true)
    expect(screen.getByText('the answer')).toBeInTheDocument()
    expect(screen.getByText('דילוג על התשובה')).toBeInTheDocument()
  })

  // The regression guard for what a review found: the skipped phase is not
  // `preview`, so the first version of this screen published the item to
  // every phone the instant the host suppressed it.
  it('never shows a skipped item to anyone', () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('skipped')], error: null })

    const player = renderRounds(false)
    expect(screen.queryByText('the answer')).not.toBeInTheDocument()
    expect(screen.getByText('דילגנו על התשובה הזאת')).toBeInTheDocument()
    player.unmount()

    renderRounds(true)
    expect(screen.queryByText('the answer')).not.toBeInTheDocument()
  })

  it('offers every player but yourself to vote for, and lets the vote change', async () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('voting')], error: null })
    renderRounds(false)

    expect(await screen.findByText('מי כתב/ה את זה?')).toBeInTheDocument()
    // THIRD is the viewer: the author votes too, for someone else, so a
    // missing self-option is what keeps abstention from marking them out.
    // (Their name is still on the scoreboard, hence the button-only query.)
    expect(screen.queryByRole('button', { name: 'Third' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Host' }))
    await waitFor(() => expect(mockCastVote).toHaveBeenCalledTimes(1))
    expect(mockCastVote.mock.calls[0].slice(1)).toEqual(['s1', 'round1', THIRD, HOST])

    // A mis-tap on a phone is ordinary, and the rules allow replacing a vote
    // until the reveal - so the options stay live.
    expect(await screen.findByText('אפשר לשנות עד לחשיפה')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Player' }))
    await waitFor(() => expect(mockCastVote).toHaveBeenCalledTimes(2))
    expect(mockCastVote.mock.calls[1][4]).toBe(PLAYER)
  })

  // Asked for directly, 2026-09-16: game 2 already explained its scoring
  // during voting and again at the reveal; game 1 had a rule and never said
  // it anywhere on screen.
  it('explains the scoring rule during voting', async () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('voting')], error: null })
    renderRounds(false)

    expect(
      await screen.findByText('ניחוש נכון שווה 2 נקודות - ומי שכתב/ה מרוויח/ה נקודה על כל מי שהוטעה'),
    ).toBeInTheDocument()
  })

  it('repeats the scoring rule at the reveal, next to the points it just paid', () => {
    mockRounds.mockReturnValue({
      loading: false,
      rounds: [round('revealed', { awarded: { [HOST]: 2 } })],
      error: null,
    })
    mockAuthor.mockReturnValue({ authorPlayerId: PLAYER, error: null })

    renderRounds(true, { [HOST]: 2 })

    expect(
      screen.getByText('2 נקודות לכל ניחוש נכון, נקודה לכותב/ת על כל מי שהוטעה'),
    ).toBeInTheDocument()
  })

  it('resumes a vote already cast, so a reload shows what was chosen', async () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('voting')], error: null })
    mockGetMyVote.mockResolvedValue(HOST)
    renderRounds(false)

    expect(await screen.findByRole('button', { name: 'Host ✓' })).toBeInTheDocument()
  })

  it('reports a failed vote with its error code, not just "it failed"', async () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('voting')], error: null })
    mockCastVote.mockRejectedValue({ code: 'permission-denied' })
    renderRounds(false)

    fireEvent.click(await screen.findByRole('button', { name: 'Host' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('permission-denied')
  })

  it('counts votes for the host from the roster, not from the votes themselves', () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('voting')], error: null })
    roster[0].votedRoundId = 'round1'
    roster[1].votedRoundId = 'round1'

    renderRounds(true)
    expect(screen.getByText('הצביעו 2 מתוך 3')).toBeInTheDocument()
  })

  it('names the author, marks correct guesses and shows what the round paid', () => {
    mockRounds.mockReturnValue({
      rounds: [round('revealed', { awarded: { [HOST]: 2, [PLAYER]: 1 } })],
      error: null,
    })
    mockAuthor.mockReturnValue({ authorPlayerId: PLAYER, error: null })
    mockVotes.mockReturnValue({ votes: { [HOST]: PLAYER, [THIRD]: HOST }, error: null })

    renderRounds(true, { [HOST]: 2, [PLAYER]: 1 })

    expect(screen.getByText('זה נכתב על ידי Player')).toBeInTheDocument()
    expect(screen.getByText('Host חשב/ה שזה Player')).toHaveClass('text-green-700')
    expect(screen.getByText('Third חשב/ה שזה Host')).not.toHaveClass('text-green-700')
    expect(screen.getByText('Host +2')).toBeInTheDocument()
    expect(screen.getByText('Player +1')).toBeInTheDocument()
  })

  // revealRound() writes the round's phase and the item's `revealed` flag as
  // two sequential writes, but itemAuthors' rule (itemRevealed()) checks the
  // ITEM's flag specifically. Gating this screen's author read on the round's
  // phase - which flips first - opened a window, invisible on the emulator
  // but real over an actual network, where the read fires before the item
  // write lands and gets refused. Found in Nitzan's own play session,
  // 2026-09-16: every reveal showed a permission-denied error and no author.
  it('does not read the author until the item itself is marked revealed, not merely the round', () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('revealed')], error: null })
    mockItems.mockReturnValue({
      loading: false,
      items: { item1: { gameId: 'game1', text: 'the answer', promptId: PROMPT, revealed: false, createdAt: 0 } },
      error: null,
    })

    renderRounds(true)

    expect(mockAuthor).toHaveBeenCalledWith('s1', 'item1', false)
  })

  it('reads the author once the item itself is marked revealed', () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('revealed')], error: null })
    mockItems.mockReturnValue({
      loading: false,
      items: { item1: { gameId: 'game1', text: 'the answer', promptId: PROMPT, revealed: true, createdAt: 0 } },
      error: null,
    })

    renderRounds(true)

    expect(mockAuthor).toHaveBeenCalledWith('s1', 'item1', true)
  })

  // A reveal whose scoring write was lost leaves the round revealed but
  // unpaid. The host needs the way back in; re-running is safe by design.
  it('offers the host a way to finish a reveal that never scored', () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('revealed')], error: null })
    mockAuthor.mockReturnValue({ authorPlayerId: PLAYER, error: null })

    const unscored = renderRounds(true)
    fireEvent.click(screen.getByText('השלמת החשיפה'))
    expect(mockRevealRound).toHaveBeenCalledTimes(1)
    unscored.unmount()

    // With the awards recorded, that button is gone.
    mockRounds.mockReturnValue({ loading: false, rounds: [round('revealed', { awarded: {} })], error: null })
    renderRounds(true)
    expect(screen.queryByText('השלמת החשיפה')).not.toBeInTheDocument()
  })

  // DESIGN: "every phase needs a timeout or a host override." A room bored at
  // round five must be able to stop without skipping each item one at a time.
  it('lets the host end the game at any point, not only when the items run out', async () => {
    mockRounds.mockReturnValue({ loading: false, rounds: [round('voting')], error: null })
    renderRounds(true)

    fireEvent.click(screen.getByText('סיום המשחק'))
    await waitFor(() => expect(mockFinishGame).toHaveBeenCalledTimes(1))
  })

  it('tells everyone when the material has run out, not just the host', () => {
    mockItems.mockReturnValue({ items: {}, loading: false, error: null })

    renderRounds(false)
    expect(screen.getByText('אין עוד תשובות לסבבים')).toBeInTheDocument()
    expect(screen.queryByText('המנחה מקריא/ה עוד רגע')).not.toBeInTheDocument()
  })

  it('shows every player on the scoreboard, including one who has scored nothing', () => {
    renderRounds(false, { [HOST]: 5 })

    const board = screen.getByText('ניקוד').parentElement
    expect(board?.textContent).toMatch(/Host5.*Player0.*Third0/)
  })

  it('gives a failed listener a visible error and a way out', () => {
    rosterError = 'permission-denied'
    renderRounds(false)

    expect(screen.getByRole('alert')).toHaveTextContent('permission-denied')
    expect(screen.getByText('ניסיון נוסף')).toBeInTheDocument()
  })
})
