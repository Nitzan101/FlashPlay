import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HARVEST_PROMPTS } from './content/prompts'
import HostButton from './HostButton'
import LoadFailure from './LoadFailure'
import Scoreboard from './Scoreboard'
import { db } from './lib/firebase'
import { MAX_ROUNDS } from './lib/model'
import { castVote, finishGame, getMyVote, openVoting, revealRound, skipRound, useAuthor, useRounds, useVotes } from './lib/rounds'
import { mostVotedPlayers, openNextSecondRound, scoreMajority, useRevealedItems } from './lib/secondGame'
import { errorCode, useRoster } from './lib/room'
import { useAction } from './lib/useAction'

interface SecondGameProps {
  sessionId: string
  gameId: string
  uid: string
  isHost: boolean
  scores: Record<string, number>
}

/**
 * "Most likely to" - milestone 6, and the second half of the loop this whole
 * project exists to prove: the material is what the room typed ten minutes
 * ago and has already heard attributed.
 *
 * Nothing is hidden here. The author is named in the question itself, which
 * is exactly what makes this a different question from the first game rather
 * than the same one again - so unlike Rounds.tsx, this screen has no secret
 * to keep, and the votes stay private only until the reveal so that the room
 * does not simply follow the first person to answer.
 */
export default function SecondGame({ sessionId, gameId, uid, isHost, scores }: SecondGameProps) {
  const { t } = useTranslation()
  const { players, error: rosterError } = useRoster(sessionId)
  const { rounds, loading: roundsLoading, error: roundsError } = useRounds(sessionId, gameId)
  const { items, loading: itemsLoading, error: itemsError } = useRevealedItems(sessionId)

  const round = rounds.length > 0 ? rounds[rounds.length - 1] : null
  const revealed = round?.phase === 'revealed'
  const { votes, error: votesError } = useVotes(sessionId, round?.id ?? null, revealed)
  // The item is revealed by definition here, so its author is readable from
  // the moment the round opens - it is part of the question, not the answer.
  const { authorPlayerId, error: authorError } = useAuthor(sessionId, round?.itemId ?? null, true)

  const [myVote, setMyVote] = useState<string | null>(null)
  const host = useAction()
  const voter = useAction()

  const nameOf = (playerId: string) =>
    players.find((p) => p.id === playerId)?.name ?? t('unknownPlayer')

  useEffect(() => {
    if (!round || round.phase !== 'voting') {
      setMyVote(null)
      return
    }
    let cancelled = false
    void getMyVote(db, sessionId, round.id, uid)
      .then((voted) => {
        if (!cancelled) setMyVote(voted)
      })
      .catch((error: unknown) => {
        console.error('[FlashPlay] reading own vote failed:', errorCode(error), error)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, round, uid])

  async function vote(votedForPlayerId: string) {
    if (!round) return
    await voter.run(async () => {
      await castVote(db, sessionId, round.id, uid, votedForPlayerId)
      setMyVote(votedForPlayerId)
    })
  }

  const playedRounds = rounds.filter((r) => r.phase !== 'skipped')
  const spent = new Set(rounds.map((r) => r.itemId))
  const unplayed = Object.keys(items).filter((id) => !spent.has(id)).length
  // "Nothing left to play" and "not loaded yet" look identical from an empty
  // map, and they call for opposite host controls - the review found this
  // screen telling a host the second game had no material, with "end the game"
  // as the only button, while its first snapshot was still in flight.
  const loading = roundsLoading || itemsLoading
  const exhausted = !loading && (playedRounds.length >= MAX_ROUNDS || unplayed === 0)
  const item = round ? items[round.itemId] : undefined
  const prompt = item ? HARVEST_PROMPTS.find((p) => p.id === item.promptId) : undefined
  const votesCast = round ? players.filter((p) => p.votedRoundId === round.id).length : 0
  const awarded = round?.awarded ?? scoreMajority(votes)
  const mostVoted = revealed ? mostVotedPlayers(votes) : []
  // Being "the one the room picked" needs the room to have actually converged.
  // In a fully split vote every single player tops the tally, and inviting all
  // eight of them to defend themselves is not the moment DESIGN is after.
  const defending =
    mostVoted.length > 0 && Object.values(votes).length > mostVoted.length ? mostVoted : []

  if (rosterError || roundsError || itemsError) {
    return (
      <LoadFailure
        message={t('roundsLoadError')}
        code={rosterError ?? roundsError ?? itemsError}
      />
    )
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <p className="text-sm text-muted">{t('secondGameTitle')}</p>
      {round && (
        <p className="text-sm text-muted">
          {t('roundCounter', {
            current: playedRounds.length,
            total: Math.min(MAX_ROUNDS, playedRounds.length + unplayed),
          })}
        </p>
      )}

      {loading && <p className="text-muted">{t('loadingRound')}</p>}
      {!loading && !round && !exhausted && !isHost && <p>{t('waitingForHostToRead')}</p>}
      {!loading && !round && exhausted && (
        <p className="text-muted">{t('noRevealedItemsLeft')}</p>
      )}

      {round && item && round.phase !== 'skipped' && (
        <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/60 p-4">
          {/* DESIGN's exact framing, and the reason each prompt carries its own
              second-game question: an answer written in the first person
              cannot be re-conjugated without a generator, so the question is
              written to fit the bare answer rather than the other way round. */}
          {/* The name IS the question here, so a placeholder would be worse
              than a pause: "the answer of somebody" is not a game. */}
          {authorPlayerId ? (
            <p className="text-center">
              {t('secondGameQuote', { name: nameOf(authorPlayerId), text: item.text })}
            </p>
          ) : authorError ? (
            <p role="alert" className="text-center text-xs text-danger">
              {t('revealLoadError')}{' '}
              <span dir="ltr" className="font-mono">
                ({authorError})
              </span>
            </p>
          ) : (
            <p className="text-center text-muted">{t('loadingRound')}</p>
          )}
          {prompt && <p className="text-center text-lg font-medium">{prompt.secondGameQuestion}</p>}
          {round.phase === 'preview' && (
            <p className="text-xs text-muted">
              {isHost ? t('hostPreviewOnly') : t('waitingForHostToRead')}
            </p>
          )}
        </div>
      )}

      {round?.phase === 'skipped' && <p className="text-muted">{t('roundSkipped')}</p>}

      {round?.phase === 'voting' && (
        <div className="flex w-full flex-col gap-2">
          {players
            // Yourself included, unlike the first game: "me" is often the
            // honest answer to "who is most likely to", and the author of the
            // item being discussed is the likeliest pick of all - barring them
            // would exclude one named person from the scoring every round.
            .map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => void vote(player.id)}
                disabled={voter.busy}
                className={
                  myVote === player.id
                    ? 'cursor-pointer rounded-xl border-2 border-accent bg-accent/15 px-4 py-3 font-medium text-ink disabled:opacity-50'
                    : 'cursor-pointer rounded-xl border border-line bg-surface/60 px-4 py-3 disabled:opacity-50'
                }
              >
                {player.name}
                {myVote === player.id ? ' ✓' : ''}
              </button>
            ))}
          <p className="text-center text-xs text-muted">
            {myVote ? t('changeVoteHint') : t('majorityScoringHint')}
          </p>
          {voter.slow && <p className="text-center text-xs text-muted">{t('stillWorking')}</p>}
          {voter.error && (
            <p role="alert" className="text-center text-xs text-danger">
              {t('voteError')}{' '}
              <span dir="ltr" className="font-mono">
                ({voter.error})
              </span>
            </p>
          )}
        </div>
      )}

      {revealed && (
        <div className="flex w-full flex-col items-center gap-1">
          {/* DESIGN: "after each vote, whoever got the most votes gets one
              sentence to defend themselves - the social moment is the point,
              not the scoring, and without it the game is a survey." */}
          {mostVoted.length > 0 && (
            <p className="font-display text-center text-lg font-semibold">
              {t('mostVotedIs', { names: mostVoted.map(nameOf).join(', ') })}
            </p>
          )}
          {defending.length > 0 && (
            <p className="text-center text-lg">
              {t('defenceInvitation', { names: defending.map(nameOf).join(', ') })}
            </p>
          )}
          {/* Repeated here on purpose: the hint shown during voting is gone by
              now, and this is the screen where the points appear. */}
          <p className="text-xs text-muted">{t('majorityScoringReminder')}</p>
          {votesError && (
            <p role="alert" className="text-xs text-danger">
              {t('revealLoadError')}{' '}
              <span dir="ltr" className="font-mono">
                ({votesError})
              </span>
            </p>
          )}
          {Object.entries(votes).map(([voterId, votedForPlayerId]) => (
            <p key={voterId} className="text-muted">
              {t('votedForSecondGameLine', {
                voter: nameOf(voterId),
                target: nameOf(votedForPlayerId),
              })}
            </p>
          ))}
          {Object.entries(awarded).map(([playerId, points]) => (
            <p key={playerId} className="text-sm font-medium">
              {t('awardedLine', { name: nameOf(playerId), points })}
            </p>
          ))}
        </div>
      )}

      {isHost && (
        <div className="flex flex-col items-center gap-2">
          {!round && !exhausted && !loading && (
            <HostButton
              busy={host.busy}
              busyLabel={t('openingRound')}
              onClick={() => void host.run(openNext)}
              primary
            >
              {t('startFirstRound')}
            </HostButton>
          )}

          {round?.phase === 'preview' && (
            <>
              <HostButton
                busy={host.busy}
                onClick={() => void host.run(() => openVoting(db, sessionId, round.id))}
                primary
              >
                {t('openVoting')}
              </HostButton>
              <HostButton
                busy={host.busy}
                onClick={() => void host.run(() => skipRound(db, sessionId, round.id))}
              >
                {t('skipItem')}
              </HostButton>
            </>
          )}

          {round?.phase === 'voting' && (
            <>
              <p className="text-sm text-muted">
                {t('votesCastOf', { count: votesCast, total: players.length })}
              </p>
              <HostButton
                busy={host.busy}
                busyLabel={t('revealingRound')}
                onClick={() =>
                  void host.run(() => revealRound(db, sessionId, round.id, scoreMajority))
                }
                primary
              >
                {t('revealRound')}
              </HostButton>
            </>
          )}

          {revealed && !round.awarded && (
            <HostButton
              busy={host.busy}
              onClick={() =>
                void host.run(() => revealRound(db, sessionId, round.id, scoreMajority))
              }
              primary
            >
              {t('completeReveal')}
            </HostButton>
          )}

          {(revealed || round?.phase === 'skipped') && !exhausted && (
            <HostButton
              busy={host.busy}
              busyLabel={t('openingRound')}
              onClick={() => void host.run(openNext)}
              primary
            >
              {t('nextRound')}
            </HostButton>
          )}

          <HostButton
            busy={host.busy}
            busyLabel={t('finishingGame')}
            onClick={() => void host.run(() => finishGame(db, sessionId, gameId))}
          >
            {t('finishGame')}
          </HostButton>

          {exhausted && round && (
            <p className="text-sm text-muted">{t('noRevealedItemsLeft')}</p>
          )}

          {host.slow && <p className="text-xs text-muted">{t('stillWorking')}</p>}
          {host.error && (
            <p role="alert" className="text-xs text-danger">
              {t('roundActionError')}{' '}
              <span dir="ltr" className="font-mono">
                ({host.error})
              </span>
            </p>
          )}
        </div>
      )}

      <Scoreboard players={players} scores={scores} title={t('scoreboardTitle')} />
    </div>
  )

  async function openNext() {
    await openNextSecondRound(db, sessionId, gameId)
  }
}
