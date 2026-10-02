import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import HostButton from './HostButton'
import LoadFailure from './LoadFailure'
import Scoreboard from './Scoreboard'
import { db } from './lib/firebase'
import { MAX_ROUNDS } from './lib/model'
import { castVote, finishGame, getMyVote, openVoting, revealRound, skipRound, useItems, useRounds, useVotes } from './lib/rounds'
import {
  MIN_SECOND_GAME_FACTS,
  describeSecondGamePool,
  mostVotedPlayers,
  openNextSecondRound,
  scoreMajority,
  type SecondGamePool,
} from './lib/secondGame'
import { errorCode, useRoster } from './lib/room'
import { useAction } from './lib/useAction'

/** The composed question marks the quoted fact with « » (secondGame.ts). On
 *  screen those read as stray bars, so the marks are dropped and the fact is
 *  set apart by colour and weight instead. Text without marks - an older
 *  item, say - renders unchanged. */
function emphasiseFact(text: string) {
  const match = /^(.*?)«(.+?)»(.*)$/s.exec(text)
  if (!match) return text
  return (
    <>
      {match[1]}
      <strong className="font-display font-semibold text-accent-3">{match[2]}</strong>
      {match[3]}
    </>
  )
}

interface SecondGameProps {
  sessionId: string
  gameId: string
  /** Whoever's private store this gathering's memory lives in - see
   *  `SessionDoc.originalHostUid`. Needed here because every round is built
   *  fresh from that store (see `openNextSecondRound`), unlike the first
   *  game, which never touches it mid-play. */
  hostUid: string
  /** How many rounds the memory can supply, once the first has opened
   *  (`GameDoc.plannedRounds`) - the real total to show, rather than the cap. */
  plannedRounds?: number
  uid: string
  isHost: boolean
  scores: Record<string, number>
}

/**
 * "Most likely to" - milestone 6, redesigned 2026-09-28. Each round is a real
 * fact from the group's stored memory (any past gathering, any source), quoted
 * without ever naming whose it was - see secondGame.ts's module comment for
 * why: naming the author (the original design) made this the same question
 * as "who wrote this" the moment the room already knew the answer.
 *
 * Nothing is hidden about the VOTE mid-round, only about the fact's origin,
 * which is never tracked on this screen at all - so unlike Rounds.tsx, this
 * screen never asks who wrote anything. Votes stay private only until the
 * reveal so the room does not simply follow the first person to answer.
 */
export default function SecondGame({
  sessionId,
  gameId,
  hostUid,
  plannedRounds,
  uid,
  isHost,
  scores,
}: SecondGameProps) {
  const { t } = useTranslation()
  const { players, error: rosterError } = useRoster(sessionId)
  const { rounds, loading: roundsLoading, error: roundsError } = useRounds(sessionId, gameId)
  const { items, loading: itemsLoading, error: itemsError } = useItems(sessionId, gameId)

  const round = rounds.length > 0 ? rounds[rounds.length - 1] : null
  const revealed = round?.phase === 'revealed'
  const { votes, error: votesError } = useVotes(sessionId, round?.id ?? null, revealed)

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
  // Unlike the first game, an item here is created on demand from the group's
  // ever-shrinking fact store rather than existing upfront - so there is
  // nothing to count in advance the way `unplayed` does in Rounds.tsx. Instead
  // `storeExhausted` is set from openNext()'s own return value the one time it
  // comes back empty.
  const [storeExhausted, setStoreExhausted] = useState(false)
  const loading = roundsLoading || itemsLoading
  const totalRounds = plannedRounds ?? MAX_ROUNDS
  const exhausted = !loading && (playedRounds.length >= totalRounds || storeExhausted)

  // Host only, before the first round: what the memory can supply, and who has
  // given it nothing. Nothing else can read the host's private store.
  const [pool, setPool] = useState<SecondGamePool | null>(null)
  const waitingForFirstRound = isHost && !loading && !round && !exhausted
  useEffect(() => {
    if (!waitingForFirstRound) return
    let cancelled = false
    void describeSecondGamePool(db, hostUid, sessionId, gameId)
      .then((described) => {
        if (!cancelled) setPool(described)
      })
      .catch((error: unknown) => {
        console.error('[FlashPlay] reading the second game pool failed:', errorCode(error), error)
      })
    return () => {
      cancelled = true
    }
  }, [waitingForFirstRound, hostUid, sessionId, gameId])
  const tooFewFacts = pool !== null && pool.available < MIN_SECOND_GAME_FACTS
  const item = round ? items[round.itemId] : undefined
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
          {/* No forward-looking total to show here (see storeExhausted above)
              - the cap is the only number known in advance. */}
          {t('roundCounter', { current: playedRounds.length, total: totalRounds })}
        </p>
      )}

      {loading && <p className="text-muted">{t('loadingRound')}</p>}
      {!loading && !round && !exhausted && !isHost && <p>{t('waitingForHostToRead')}</p>}
      {!loading && !round && exhausted && (
        <p className="text-muted">{t('noMemoryLeft')}</p>
      )}

      {round && item && round.phase !== 'skipped' && (
        <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/60 p-4">
          {/* item.text is already the whole, self-contained question - baked
              in at creation time by composeSecondGameItemText, which is also
              why nobody is named here: the fact's real author is never
              tracked on this screen at all, see secondGame.ts. */}
          <p className="text-center text-lg font-medium">{emphasiseFact(item.text)}</p>
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
            <>
              {pool && (
                <div className="flex flex-col items-center gap-1 text-center text-sm">
                  <p className={tooFewFacts ? 'text-danger' : 'text-muted'}>
                    {tooFewFacts
                      ? t('poolTooFew', { min: MIN_SECOND_GAME_FACTS, count: pool.available })
                      : t('poolAvailable', { count: pool.available })}
                  </p>
                  {pool.playersWithoutFacts.length > 0 && (
                    <p className="text-muted">
                      {t('poolMissing', { names: pool.playersWithoutFacts.map(nameOf).join(', ') })}
                    </p>
                  )}
                </div>
              )}
              <HostButton
                busy={host.busy || pool === null || tooFewFacts}
                busyLabel={host.busy ? t('openingRound') : t('startFirstRound')}
                onClick={() => void host.run(openNext)}
                primary
              >
                {t('startFirstRound')}
              </HostButton>
            </>
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
            primary={exhausted}
          >
            {t('finishGame')}
          </HostButton>

          {exhausted && round && <p className="text-sm text-muted">{t('noMemoryLeft')}</p>}

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
    const roundId = await openNextSecondRound(db, hostUid, sessionId, gameId)
    if (roundId === null) setStoreExhausted(true)
  }
}
