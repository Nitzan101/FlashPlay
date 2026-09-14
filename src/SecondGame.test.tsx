import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SecondGame from './SecondGame'
import './i18n'
import { HARVEST_PROMPTS } from './content/prompts'

vi.mock('./lib/firebase', () => ({ db: {}, auth: {}, firebaseApp: {} }))

const HOST = 'host-uid'
const PLAYER = 'player-uid'
const THIRD = 'third-uid'

let roster: { id: string; name: string; votedRoundId: string | null }[]

vi.mock('./lib/room', () => ({
  useRoster: () => ({ players: roster, error: null }),
  errorCode: (error: unknown) => (error as { code?: string })?.code ?? String(error),
}))

const mockRounds = vi.fn()
const mockVotes = vi.fn()
const mockAuthor = vi.fn()
const mockGetMyVote = vi.fn()
const mockCastVote = vi.fn()
const mockRevealRound = vi.fn()
const mockOpenVoting = vi.fn()
const mockSkipRound = vi.fn()
const mockFinishGame = vi.fn()

vi.mock('./lib/rounds', () => ({
  useRounds: () => mockRounds(),
  useVotes: () => mockVotes(),
  useAuthor: () => mockAuthor(),
  getMyVote: (...args: unknown[]) => mockGetMyVote(...args),
  castVote: (...args: unknown[]) => mockCastVote(...args),
  revealRound: (...args: unknown[]) => mockRevealRound(...args),
  openVoting: (...args: unknown[]) => mockOpenVoting(...args),
  skipRound: (...args: unknown[]) => mockSkipRound(...args),
  finishGame: (...args: unknown[]) => mockFinishGame(...args),
}))

const mockItems = vi.fn()
const mockOpenNext = vi.fn()

vi.mock('./lib/secondGame', async () => {
  const actual = await vi.importActual<typeof import('./lib/secondGame')>('./lib/secondGame')
  return {
    // Real arithmetic: the screen must agree with what the host writes.
    scoreMajority: actual.scoreMajority,
    mostVotedPlayers: actual.mostVotedPlayers,
    useRevealedItems: () => mockItems(),
    openNextSecondRound: (...args: unknown[]) => mockOpenNext(...args),
  }
})

const prompt = HARVEST_PROMPTS[0]

function round(phase: string, extra: Record<string, unknown> = {}) {
  return { id: 'g2r0', gameId: 'game2', itemId: 'item1', phase, order: 0, startedAt: 0, ...extra }
}

function renderSecondGame(isHost = false, scores: Record<string, number> = {}) {
  return render(
    <SecondGame sessionId="s1" gameId="game2" uid={THIRD} isHost={isHost} scores={scores} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  roster = [
    { id: HOST, name: 'Host', votedRoundId: null },
    { id: PLAYER, name: 'Player', votedRoundId: null },
    { id: THIRD, name: 'Third', votedRoundId: null },
  ]
  mockRounds.mockReturnValue({ rounds: [round('voting')], loading: false, error: null })
  mockItems.mockReturnValue({
    items: {
      item1: { gameId: 'game1', text: 'the keys', promptId: prompt.id, revealed: true, createdAt: 0 },
    },
    loading: false,
    error: null,
  })
  mockVotes.mockReturnValue({ votes: {}, error: null })
  mockAuthor.mockReturnValue({ authorPlayerId: PLAYER, error: null })
  mockGetMyVote.mockResolvedValue(null)
  mockCastVote.mockResolvedValue(undefined)
  mockOpenNext.mockResolvedValue('g2r1')
})

describe('SecondGame', () => {
  // The whole point of the second game: the item is attributed out loud, and
  // the question is a new one about the person, not about the text.
  it('quotes the item with its author named, and asks the prompt’s own question', () => {
    renderSecondGame(false)

    expect(screen.getByText(/התשובה של Player/)).toBeInTheDocument()
    expect(screen.getByText(/the keys/)).toBeInTheDocument()
    expect(screen.getByText(prompt.secondGameQuestion)).toBeInTheDocument()
  })

  // Unlike the first game, yourself included: "me" is an honest answer to
  // "who is most likely to", and the author of the item under discussion is
  // the likeliest majority pick - barring them would exclude one named person
  // from the scoring every round.
  it('offers every player including yourself, and says how scoring works', async () => {
    renderSecondGame(false)

    expect(screen.getByRole('button', { name: 'Third' })).toBeInTheDocument()
    expect(screen.getByText('אין תשובה נכונה - נקודה למי שהצביע/ה עם הרוב')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Player' }))
    await waitFor(() => expect(mockCastVote).toHaveBeenCalledTimes(1))
    expect(mockCastVote.mock.calls[0].slice(1)).toEqual(['s1', 'g2r0', THIRD, PLAYER])
  })

  // DESIGN: "after each vote, whoever got the most votes gets one sentence to
  // defend themselves - the social moment is the point, not the scoring."
  it('invites the most-voted player to defend themselves, and pays the majority', () => {
    mockRounds.mockReturnValue({ rounds: [round('revealed')], loading: false, error: null })
    mockVotes.mockReturnValue({
      votes: { [HOST]: PLAYER, [THIRD]: PLAYER, [PLAYER]: HOST },
      error: null,
    })

    renderSecondGame(false)

    expect(screen.getByText('Player - משפט אחד להגנה')).toBeInTheDocument()
    expect(screen.getByText('Host +1')).toBeInTheDocument()
    expect(screen.getByText('Third +1')).toBeInTheDocument()
    expect(screen.queryByText('Player +1')).not.toBeInTheDocument()
  })

  // A vote where every name ties is a room that did not converge on anyone.
  // Putting all of them on trial at once is not the social moment DESIGN is
  // after, so the tally is still shown and the defence line is not.
  it('asks nobody to defend themselves when the vote splits completely', () => {
    mockRounds.mockReturnValue({ rounds: [round('revealed')], loading: false, error: null })
    mockVotes.mockReturnValue({ votes: { [HOST]: PLAYER, [PLAYER]: HOST }, error: null })

    renderSecondGame(false)

    expect(screen.queryByText(/משפט אחד להגנה/)).not.toBeInTheDocument()
    expect(screen.getByText(/הכי הרבה קולות/)).toBeInTheDocument()
  })

  it('uses this game’s own wording, not the first game’s', () => {
    mockRounds.mockReturnValue({ rounds: [round('revealed')], loading: false, error: null })
    mockVotes.mockReturnValue({ votes: { [HOST]: PLAYER, [THIRD]: PLAYER }, error: null })

    renderSecondGame(false)

    // "Ruti thought it was David" would tell the room there was a right
    // answer, in the one game that has none.
    expect(screen.getByText('Host בחר/ה בPlayer')).toBeInTheDocument()
    expect(screen.queryByText(/חשב\/ה שזה/)).not.toBeInTheDocument()
    // And the scoring rule is repeated on the screen where the points appear.
    expect(screen.getByText('נקודה לכל מי שהצביע/ה עם הרוב')).toBeInTheDocument()
  })

  it('waits rather than claiming the material has run out', () => {
    mockRounds.mockReturnValue({ rounds: [], loading: true, error: null })
    mockItems.mockReturnValue({ items: {}, loading: true, error: null })

    renderSecondGame(true)

    // The dangerous version of this screen told the host there was nothing to
    // play and offered "finish the game" as the only button, while its first
    // snapshot was still in flight.
    expect(screen.queryByText('אין עוד תשובות שנחשפו')).not.toBeInTheDocument()
    expect(screen.getByText('רגע...')).toBeInTheDocument()
  })

  it('never renders a placeholder where the author’s name belongs', () => {
    mockAuthor.mockReturnValue({ authorPlayerId: null, error: null })

    renderSecondGame(false)

    expect(screen.queryByText(/מישהו/)).not.toBeInTheDocument()
  })

  it('scores the round with majority scoring, not the first game’s', async () => {
    mockRounds.mockReturnValue({ rounds: [round('voting')], loading: false, error: null })
    renderSecondGame(true)

    fireEvent.click(screen.getByText('חשיפה'))

    await waitFor(() => expect(mockRevealRound).toHaveBeenCalledTimes(1))
    // The fourth argument is the scorer - without it the reveal would pay for
    // "correct guesses" in a game that has no correct answer.
    expect(mockRevealRound.mock.calls[0][3]).toBeTypeOf('function')
  })

  it('tells the room when the revealed items run out', () => {
    mockRounds.mockReturnValue({ rounds: [], loading: false, error: null })
    mockItems.mockReturnValue({ items: {}, loading: false, error: null })

    renderSecondGame(false)
    expect(screen.getByText('אין עוד תשובות שנחשפו')).toBeInTheDocument()
  })
})
