import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HARVEST_PROMPTS } from './content/prompts'
import LoadFailure from './LoadFailure'
import Scoreboard from './Scoreboard'
import { db } from './lib/firebase'
import { MAX_ROUNDS } from './lib/model'
import {
  castVote,
  finishGame,
  getMyVote,
  openNextRound,
  openVoting,
  revealRound,
  scoreRound,
  skipRound,
  useAuthor,
  useItems,
  useRounds,
  useVotes,
} from './lib/rounds'
import { errorCode, useRoster } from './lib/room'

interface RoundsProps {
  sessionId: string
  gameId: string
  uid: string
  isHost: boolean
  scores: Record<string, number>
}

/** How long an action may take before the screen admits it is still trying. A
 *  Firestore write on a phone that has quietly lost its connection never
 *  settles at all, so without this the button just sits disabled forever
 *  while the room waits for the host. */
const SLOW_ACTION_MS = 6000

/**
 * "Who said that" - milestone 5. Every device renders from the same live
 * documents, so what a player sees is whatever phase the host's last tap put
 * the round in; there is no per-device sequencing to get out of step.
 *
 * The one thing this screen must never do is show the author before the
 * reveal. It cannot: the author lives in a document the rules refuse to
 * everybody until the item is revealed, so there is no field here to leak by
 * accident (DESIGN, "Anonymity leaks through the client").
 */
export default function Rounds({ sessionId, gameId, uid, isHost, scores }: RoundsProps) {
  const { t } = useTranslation()
  const { players, error: rosterError } = useRoster(sessionId)
  const { rounds, error: roundsError } = useRounds(sessionId, gameId)
  const { items, error: itemsError } = useItems(sessionId, gameId)

  const round = rounds.length > 0 ? rounds[rounds.length - 1] : null
  const revealed = round?.phase === 'revealed'
  const { votes, error: votesError } = useVotes(sessionId, round?.id ?? null, revealed)
  const { authorPlayerId, error: authorError } = useAuthor(
    sessionId,
    round?.itemId ?? null,
    revealed,
  )

  const [myVote, setMyVote] = useState<string | null>(null)
  const [voteError, setVoteError] = useState<string | null>(null)
  const [voting, setVoting] = useState(false)
  const [hostError, setHostError] = useState<string | null>(null)
  const [hostBusy, setHostBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nameOf = (playerId: string) =>
    players.find((p) => p.id === playerId)?.name ?? t('unknownPlayer')

  // A phone that reloads mid-round must not be offered a fresh vote, so the
  // answer comes from Firestore rather than from state this component lost.
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
        // Not fatal: the vote can simply be cast again, and the rules allow
        // replacing it while the round is open.
        console.error('[FlashPlay] reading own vote failed:', errorCode(error), error)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, round, uid])

  useEffect(() => () => clearTimeout(slowTimer.current ?? undefined), [])

  async function run(action: () => Promise<unknown>, onError: (code: string) => void) {
    setSlow(false)
    slowTimer.current = setTimeout(() => setSlow(true), SLOW_ACTION_MS)
    try {
      await action()
    } catch (error) {
      console.error('[FlashPlay] round action failed:', errorCode(error), error)
      onError(errorCode(error))
    } finally {
      clearTimeout(slowTimer.current ?? undefined)
      setSlow(false)
    }
  }

  async function hostAction(action: () => Promise<unknown>) {
    setHostBusy(true)
    setHostError(null)
    await run(action, setHostError)
    setHostBusy(false)
  }

  async function vote(votedForPlayerId: string) {
    if (!round) return
    setVoting(true)
    setVoteError(null)
    await run(async () => {
      await castVote(db, sessionId, round.id, uid, votedForPlayerId)
      setMyVote(votedForPlayerId)
    }, setVoteError)
    setVoting(false)
  }

  // Everything below is derived from the live documents rather than kept in
  // component state, so a reload mid-game rebuilds the same screen.
  const playedRounds = rounds.filter((r) => r.phase !== 'skipped')
  const spent = new Set(rounds.map((r) => r.itemId))
  const unplayed = Object.keys(items).filter((id) => !spent.has(id)).length
  const roundsLeft = Math.max(0, MAX_ROUNDS - playedRounds.length)
  const exhausted = roundsLeft === 0 || unplayed === 0
  const item = round ? items[round.itemId] : undefined
  const prompt = item ? HARVEST_PROMPTS.find((p) => p.id === item.promptId) : undefined
  const votesCast = round ? players.filter((p) => p.votedRoundId === round.id).length : 0
  // Shown to everyone from the round document once the host has scored it, and
  // computed locally in the moment before that write lands.
  const awarded =
    round?.awarded ?? (authorPlayerId ? scoreRound(votes, authorPlayerId) : {})
  // A skipped item is one the host decided the room should not hear. Showing
  // it under "we skipped this" would defeat the entire preview.
  const itemVisible = item && (isHost ? round?.phase !== 'skipped' : round?.phase === 'voting' || revealed)

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
      {round && (
        <p className="text-sm text-neutral-500">
          {t('roundCounter', {
            current: playedRounds.length,
            total: Math.min(MAX_ROUNDS, playedRounds.length + unplayed),
          })}
        </p>
      )}

      {!round && !exhausted && !isHost && <p>{t('waitingForHostToRead')}</p>}
      {!round && exhausted && <p className="text-neutral-500">{t('noItemsLeft')}</p>}

      {round && (
        <div className="flex w-full flex-col items-center gap-2 rounded-md border border-neutral-200 p-4">
          {prompt && (
            <p className="text-xs text-neutral-500">{t('roundPromptLabel', { text: prompt.text })}</p>
          )}
          {itemVisible && <p className="text-center text-lg">{item.text}</p>}
          {round.phase === 'preview' && (
            <p className="text-xs text-neutral-500">
              {isHost ? t('hostPreviewOnly') : t('waitingForHostToRead')}
            </p>
          )}
          {round.phase === 'skipped' && <p className="text-neutral-500">{t('roundSkipped')}</p>}
        </div>
      )}

      {round?.phase === 'voting' && (
        <div className="flex w-full flex-col items-center gap-2">
          <p className="font-medium">{t('whoWroteThis')}</p>
          <div className="flex w-full flex-col gap-2">
            {players
              // Never yourself: the author votes too, for someone else, so
              // that abstaining or self-voting cannot mark them out. The rules
              // refuse a self-vote as well - this only hides it.
              .filter((player) => player.id !== uid)
              .map((player) => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => void vote(player.id)}
                  disabled={voting}
                  className={
                    myVote === player.id
                      ? 'cursor-pointer rounded-md border-2 border-blue-600 bg-blue-50 px-4 py-3 font-medium disabled:opacity-50'
                      : 'cursor-pointer rounded-md border border-neutral-300 px-4 py-3 disabled:opacity-50'
                  }
                >
                  {player.name}
                  {myVote === player.id ? ' ✓' : ''}
                </button>
              ))}
          </div>
          {/* The options stay tappable after voting: a mis-tap on a phone is
              ordinary, and the rules already allow replacing a vote until the
              reveal. Hiding them made a wrong tap final. */}
          <p className="text-xs text-neutral-500">
            {myVote ? t('changeVoteHint') : t('everyoneVotesHint')}
          </p>
          {voteError && (
            <p role="alert" className="text-xs text-red-600">
              {t('voteError')}{' '}
              <span dir="ltr" className="font-mono">
                ({voteError})
              </span>
            </p>
          )}
        </div>
      )}

      {revealed && (
        <div className="flex w-full flex-col items-center gap-1">
          {authorPlayerId && (
            <p className="text-lg font-medium">{t('authorWas', { name: nameOf(authorPlayerId) })}</p>
          )}
          {(authorError || votesError) && (
            <p role="alert" className="text-xs text-red-600">
              {t('revealLoadError')}{' '}
              <span dir="ltr" className="font-mono">
                ({authorError ?? votesError})
              </span>
            </p>
          )}
          {Object.entries(votes).map(([voterId, votedForPlayerId]) => (
            <p
              key={voterId}
              className={
                votedForPlayerId === authorPlayerId ? 'text-green-700' : 'text-neutral-600'
              }
            >
              {t('votedForLine', { voter: nameOf(voterId), target: nameOf(votedForPlayerId) })}
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
          {!round && !exhausted && (
            <HostButton
              busy={hostBusy}
              busyLabel={t('openingRound')}
              onClick={() => void hostAction(openNext)}
              primary
            >
              {t('startFirstRound')}
            </HostButton>
          )}

          {round?.phase === 'preview' && (
            <>
              <HostButton
                busy={hostBusy}
                onClick={() => void hostAction(() => openVoting(db, sessionId, round.id))}
                primary
              >
                {t('openVoting')}
              </HostButton>
              <HostButton
                busy={hostBusy}
                onClick={() => void hostAction(() => skipRound(db, sessionId, round.id))}
              >
                {t('skipItem')}
              </HostButton>
            </>
          )}

          {round?.phase === 'voting' && (
            <>
              <p className="text-sm text-neutral-500">
                {t('votesCastOf', { count: votesCast, total: players.length })}
              </p>
              <HostButton
                busy={hostBusy}
                busyLabel={t('revealingRound')}
                onClick={() => void hostAction(() => revealRound(db, sessionId, round.id))}
                primary
              >
                {t('revealRound')}
              </HostButton>
            </>
          )}

          {/* A reveal that died partway leaves the round revealed but unscored.
              Re-running it finishes the job - every step of it checks whether
              it already happened - so the host gets the button back rather
              than a round nobody was paid for. */}
          {revealed && !round.awarded && (
            <HostButton
              busy={hostBusy}
              onClick={() => void hostAction(() => revealRound(db, sessionId, round.id))}
              primary
            >
              {t('completeReveal')}
            </HostButton>
          )}

          {(revealed || round?.phase === 'skipped') && !exhausted && (
            <HostButton
              busy={hostBusy}
              busyLabel={t('openingRound')}
              onClick={() => void hostAction(openNext)}
              primary
            >
              {t('nextRound')}
            </HostButton>
          )}

          {exhausted && round && <p className="text-sm text-neutral-500">{t('noItemsLeft')}</p>}

          {/* DESIGN: "every phase needs a timeout or a host override." A room
              that has had enough at round five can stop there. */}
          <HostButton
            busy={hostBusy}
            busyLabel={t('finishingGame')}
            onClick={() => void hostAction(() => finishGame(db, sessionId, gameId))}
          >
            {t('finishGame')}
          </HostButton>

          {slow && <p className="text-xs text-neutral-500">{t('stillWorking')}</p>}
          {hostError && (
            <p role="alert" className="text-xs text-red-600">
              {t('roundActionError')}{' '}
              <span dir="ltr" className="font-mono">
                ({hostError})
              </span>
            </p>
          )}
        </div>
      )}

      <Scoreboard players={players} scores={scores} title={t('scoreboardTitle')} />
    </div>
  )

  async function openNext() {
    await openNextRound(db, sessionId, gameId)
  }
}

function HostButton({
  children,
  busyLabel,
  onClick,
  busy,
  primary = false,
}: {
  children: React.ReactNode
  /** What the button says while the write is in flight. A tap that only greys
   *  the button out reads as a tap that did nothing. */
  busyLabel?: string
  onClick: () => void
  busy: boolean
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        primary
          ? 'cursor-pointer rounded-md bg-blue-600 px-4 py-3 text-white disabled:opacity-50'
          : 'cursor-pointer rounded-md border border-neutral-300 px-4 py-3 disabled:opacity-50'
      }
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
