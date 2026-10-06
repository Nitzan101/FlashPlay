import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import HostButton from './HostButton'
import LoadFailure from './LoadFailure'
import Scoreboard from './Scoreboard'
import { db } from './lib/firebase'
import { MAX_ROUNDS, type ProfileQuestion, type RoundParticipantDoc } from './lib/model'
import { finishGame, openVoting, skipRound, useItems, useRounds } from './lib/rounds'
import { errorCode, useRoster } from './lib/room'
import { useAction } from './lib/useAction'
import {
  candidateIds,
  castGuess,
  classificationsCorrect,
  findChoiceQuestion,
  getMyGuess,
  isActivePlayer,
  loadAnswerStats,
  openNextAnswerRound,
  readLobbyChoice,
  revealAnswerRound,
  scoreWhoAnsweredWhat,
  skipRoundAnswer,
  submitRoundAnswer,
  useParticipants,
  useRevealedAnswers,
  useRevealedGuesses,
  type QuestionAnswerStats,
} from './lib/whoAnsweredWhat'

/** The fewest players who must have answered before guessing can open: with
 *  one candidate the only guesser who can be scored is everybody but them,
 *  about one person. */
const MIN_CANDIDATES_TO_GUESS = 2

const CHIP = 'cursor-pointer rounded-full border border-line bg-surface/60 px-3 py-1.5 text-sm'
const CHIP_ON = 'cursor-pointer rounded-full border-2 border-accent bg-accent/15 px-3 py-1.5 text-sm font-medium'

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}

interface WhoAnsweredWhatProps {
  sessionId: string
  gameId: string
  /** How many rounds the lobby answers can supply (`GameDoc.plannedRounds`),
   *  known once the first round has opened. */
  plannedRounds?: number
  uid: string
  isHost: boolean
  scores: Record<string, number>
}

/**
 * "Who answered what" - see lib/whoAnsweredWhat.ts for the whole design and why
 * the truth stays unreadable until the reveal. The round's phases mean:
 *
 * - `preview`: the ANSWERING window. Everyone sees the question (never the
 *   option it will ask about). A lobby answer is copied automatically; a
 *   player with none answers now or skips.
 * - `voting`: the guessing. Everyone marks the players they think chose the
 *   option.
 * - `revealed`: who chose it, how each guess did, and the points.
 *
 * Nothing on this screen is derived from anyone's answer before the reveal -
 * not even the host's. The only per-player facts shown earlier are the public
 * markers ("answered" / "skipped") and who has guessed, never what.
 */
export default function WhoAnsweredWhat({
  sessionId,
  gameId,
  plannedRounds,
  uid,
  isHost,
  scores,
}: WhoAnsweredWhatProps) {
  const { t } = useTranslation()
  const { players, error: rosterError } = useRoster(sessionId)
  const { rounds, loading: roundsLoading, error: roundsError } = useRounds(sessionId, gameId)
  const { items, loading: itemsLoading, error: itemsError } = useItems(sessionId, gameId)

  const round = rounds.length > 0 ? rounds[rounds.length - 1] : null
  const revealed = round?.phase === 'revealed'
  const item = round ? items[round.itemId] : undefined
  const question = item ? findChoiceQuestion(item.promptId) : undefined
  const option = item?.option ?? item?.text ?? ''

  const { participants } = useParticipants(sessionId, round?.id ?? null)
  // Gated on the ROUND's own phase, which is exactly what the rules check for
  // these two collections - the same document, so no two-writes race.
  const { chose: revealedChose, error: answersError } = useRevealedAnswers(
    sessionId,
    round?.id ?? null,
    revealed,
  )
  const { guesses, error: guessesError } = useRevealedGuesses(sessionId, round?.id ?? null, revealed)

  const host = useAction()
  const [exhausted, setExhausted] = useState(false)
  const statsRef = useRef<QuestionAnswerStats[] | null>(null)

  const nameOf = (playerId: string) =>
    players.find((p) => p.id === playerId)?.name ?? t('unknownPlayer')

  const me = players.find((p) => p.id === uid)
  const iAmActive = me !== undefined && isActivePlayer(me)
  const candidates = candidateIds(participants, players)
  const activePlayers = players.filter(isActivePlayer)
  const skippedCount = activePlayers.filter((p) => participants[p.id]?.answered === false).length
  const waitingCount = activePlayers.length - candidates.length - skippedCount

  // --- the reveal ---
  const revealedCandidates = candidateIds(participants, players).filter((id) => id in revealedChose)
  const choseOf: Record<string, boolean> = {}
  for (const id of revealedCandidates) choseOf[id] = revealedChose[id]
  const choosers = revealedCandidates.filter((id) => choseOf[id])
  const nonChoosers = revealedCandidates.filter((id) => !choseOf[id])
  const awarded = round?.awarded ?? scoreWhoAnsweredWhat(guesses, choseOf)
  const guessLines = Object.entries(guesses)
    .map(([guesserId, marked]) => ({
      guesserId,
      ...classificationsCorrect(guesserId, marked, choseOf),
    }))
    .sort((a, b) => b.correct - a.correct)

  // --- the round counter, and the end ---
  const playedRounds = rounds.filter((r) => r.phase !== 'skipped')
  const loading = roundsLoading || itemsLoading
  const totalRounds = plannedRounds ?? MAX_ROUNDS
  const isExhausted = !loading && (playedRounds.length >= totalRounds || exhausted)
  const guessedCount = round ? players.filter((p) => p.votedRoundId === round.id).length : 0
  const canGuessCount = activePlayers.length

  if (rosterError || roundsError || itemsError) {
    return (
      <LoadFailure
        message={t('roundsLoadError')}
        code={rosterError ?? roundsError ?? itemsError}
      />
    )
  }

  async function openNext() {
    // Read the lobby answers once per game: nothing can change them now.
    statsRef.current ??= await loadAnswerStats(db, sessionId, players)
    const roundId = await openNextAnswerRound(
      db,
      sessionId,
      gameId,
      players,
      undefined,
      undefined,
      undefined,
      statsRef.current,
    )
    if (roundId === null) setExhausted(true)
  }

  const otherCandidates = candidates.filter((id) => id !== uid)

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <p className="text-sm text-muted">{t('answerGameTitle')}</p>
      {round && (
        <p className="text-sm text-muted">
          {t('roundCounter', { current: playedRounds.length, total: totalRounds })}
        </p>
      )}

      {loading && <p className="text-muted">{t('loadingRound')}</p>}
      {!loading && !round && !isExhausted && !isHost && <p>{t('waitingForHostToRead')}</p>}
      {!loading && !round && isExhausted && <p className="text-muted">{t('noAnswerQuestionsLeft')}</p>}

      {round && question && round.phase !== 'skipped' && (
        <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface/60 p-4">
          <p className="text-xs text-muted">{t('answerGameQuestionLabel', { text: question.text })}</p>
          {round.phase !== 'preview' && (
            <p className="text-center font-display text-lg font-semibold text-accent-3">
              {t('answerGameWhoChose', { option })}
            </p>
          )}
        </div>
      )}
      {round?.phase === 'skipped' && <p className="text-muted">{t('answerRoundSkipped')}</p>}

      {round?.phase === 'preview' && question && (
        <AnsweringPanel
          key={round.id}
          sessionId={sessionId}
          roundId={round.id}
          uid={uid}
          question={question}
          option={option}
          marker={participants[uid]}
          active={iAmActive}
        />
      )}

      {round?.phase === 'voting' && (
        <div className="flex w-full flex-col items-center gap-2">
          {!iAmActive ? (
            <p className="text-sm text-muted">{t('answerGameWatching')}</p>
          ) : otherCandidates.length === 0 ? (
            <p className="text-sm text-muted">{t('answerGameNobodyToGuess')}</p>
          ) : (
            <GuessPanel
              key={round.id}
              sessionId={sessionId}
              roundId={round.id}
              uid={uid}
              candidateIds={otherCandidates}
              nameOf={nameOf}
            />
          )}
        </div>
      )}

      {revealed && (
        <div className="flex w-full flex-col items-center gap-1">
          {(answersError || guessesError) && (
            <p role="alert" className="text-xs text-danger">
              {t('revealLoadError')}{' '}
              <span dir="ltr" className="font-mono">
                ({answersError ?? guessesError})
              </span>
            </p>
          )}
          {revealedCandidates.length > 0 && (
            <>
              <p className="text-center font-display text-lg font-semibold">
                {choosers.length === 0
                  ? t('answerGameNobodyChose')
                  : t('answerGameChoseList', { names: choosers.map(nameOf).join(', ') })}
              </p>
              {choosers.length > 0 && nonChoosers.length > 0 && (
                <p className="text-center text-muted">
                  {t('answerGameDidNotChoseList', { names: nonChoosers.map(nameOf).join(', ') })}
                </p>
              )}
              {choosers.length > 0 && nonChoosers.length === 0 && (
                <p className="text-center text-muted">{t('answerGameEveryoneChose')}</p>
              )}
            </>
          )}
          {guessLines.map(({ guesserId, correct, total }) => (
            <p key={guesserId} className="text-muted">
              {t('answerGameGuessLine', { name: nameOf(guesserId), correct, total })}
            </p>
          ))}
          <p className="text-xs text-muted">{t('answerGameScoringReminder')}</p>
          {Object.entries(awarded).map(([playerId, points]) => (
            <p key={playerId} className="text-sm font-medium">
              {t('awardedLine', { name: nameOf(playerId), points })}
            </p>
          ))}
        </div>
      )}

      {isHost && (
        <div className="flex flex-col items-center gap-2">
          {!round && !isExhausted && !loading && (
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
              <p className="text-center text-sm text-muted">
                {t('answerGameProgress', {
                  answered: candidates.length,
                  skipped: skippedCount,
                  waiting: Math.max(0, waitingCount),
                })}
              </p>
              {candidates.length < MIN_CANDIDATES_TO_GUESS && (
                <p className="text-center text-xs text-muted">
                  {t('answerGameTooFewCandidates', { min: MIN_CANDIDATES_TO_GUESS })}
                </p>
              )}
              <HostButton
                busy={host.busy || candidates.length < MIN_CANDIDATES_TO_GUESS}
                onClick={() => void host.run(() => openVoting(db, sessionId, round.id))}
                primary
              >
                {t('answerGameOpenGuessing')}
              </HostButton>
              <HostButton
                busy={host.busy}
                onClick={() => void host.run(() => skipRound(db, sessionId, round.id))}
              >
                {t('answerGameSkipRound')}
              </HostButton>
            </>
          )}

          {round?.phase === 'voting' && (
            <>
              <p className="text-sm text-muted">
                {t('guessesCastOf', { count: guessedCount, total: canGuessCount })}
              </p>
              <HostButton
                busy={host.busy}
                busyLabel={t('revealingRound')}
                onClick={() => void host.run(() => revealAnswerRound(db, sessionId, round.id, players))}
                primary
              >
                {t('revealRound')}
              </HostButton>
            </>
          )}

          {/* A reveal that died partway leaves the round revealed but unscored;
              re-running it finishes the job (revealWith skips every step that
              already happened). */}
          {revealed && !round.awarded && (
            <HostButton
              busy={host.busy}
              onClick={() => void host.run(() => revealAnswerRound(db, sessionId, round.id, players))}
              primary
            >
              {t('completeReveal')}
            </HostButton>
          )}

          {(revealed || round?.phase === 'skipped') && !isExhausted && (
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
            primary={isExhausted}
          >
            {t('finishGame')}
          </HostButton>

          {isExhausted && round && <p className="text-sm text-muted">{t('noAnswerQuestionsLeft')}</p>}

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
}

/**
 * The answering window, from one player's side. Three ways through:
 *
 * - **A lobby answer exists** - copied automatically, no tap, no second
 *   question. This is the normal case and the reason the game is quick.
 * - **No lobby answer** - the question's options, a confirm and a skip.
 * - **Skipped** - not a candidate this round; they can still guess, and can
 *   change their mind until guessing opens.
 *
 * What is written is `chose` (one bit) in a document only this player can
 * read until the reveal; a live answer is never also saved as a lobby answer,
 * because the host can read those at any time.
 */
function AnsweringPanel({
  sessionId,
  roundId,
  uid,
  question,
  option,
  marker,
  active,
}: {
  sessionId: string
  roundId: string
  uid: string
  question: ProfileQuestion
  option: string
  marker: RoundParticipantDoc | undefined
  active: boolean
}) {
  const { t } = useTranslation()
  const action = useAction()
  // undefined: still looking; null: no lobby answer; boolean: copied from it.
  const [lobbyChose, setLobbyChose] = useState<boolean | null | undefined>(undefined)
  const [picked, setPicked] = useState<string[]>([])
  const [reopened, setReopened] = useState(false)
  const copyStarted = useRef(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void readLobbyChoice(db, sessionId, uid, question.id, option)
      .then((chose) => {
        if (!cancelled) setLobbyChose(chose)
      })
      .catch((error: unknown) => {
        // Not fatal: the player is simply asked live.
        console.error('[FlashPlay] reading the lobby answer failed:', errorCode(error), error)
        if (!cancelled) setLobbyChose(null)
      })
    return () => {
      cancelled = true
    }
  }, [active, sessionId, uid, question.id, option])

  const answered = marker?.answered === true
  const skipped = marker?.answered === false

  // The automatic copy. Once per round, and only for a player whose marker is
  // not already there (a reload after copying must not write again).
  useEffect(() => {
    if (!active || marker || typeof lobbyChose !== 'boolean' || copyStarted.current) return
    copyStarted.current = true
    void action.run(() => submitRoundAnswer(db, sessionId, roundId, uid, lobbyChose))
    // `action` is a fresh object each render; the ref guards the single run.
  }, [active, marker, lobbyChose, sessionId, roundId, uid, action])

  function pick(value: string) {
    setPicked((current) => {
      if (question.kind === 'single-choice') return current[0] === value ? [] : [value]
      return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    })
  }

  if (!active) {
    return <p className="text-sm text-muted">{t('answerGameWatching')}</p>
  }

  const retry = action.error !== null && typeof lobbyChose === 'boolean' && !marker
  // Asked live only when there is nothing to copy; a player who skipped is
  // asked again only if they tap "answer anyway".
  const showLive =
    !answered && !retry && !action.busy && (skipped ? reopened : lobbyChose === null)

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {answered && (
        <p className="text-center text-sm">
          {typeof lobbyChose === 'boolean' ? t('answerGameCopied') : t('answerGameAnswered')}
        </p>
      )}
      {answered && <p className="text-xs text-muted">{t('answerGameWaitingForOthers')}</p>}

      {skipped && !reopened && (
        <>
          <p className="text-center text-sm text-muted">{t('answerGameSkipped')}</p>
          <button
            type="button"
            onClick={() => setReopened(true)}
            className="cursor-pointer rounded-full border border-accent-2/30 bg-accent-2/12 px-3 py-1 text-sm font-medium text-accent-2"
          >
            {t('answerGameAnswerAnyway')}
          </button>
        </>
      )}

      {!marker && lobbyChose === undefined && <p className="text-sm text-muted">{t('answerGameChecking')}</p>}
      {!marker && typeof lobbyChose === 'boolean' && !retry && (
        <p className="text-sm text-muted">{t('answerGameCopying')}</p>
      )}

      {retry && (
        <button
          type="button"
          onClick={() =>
            void action.run(() => submitRoundAnswer(db, sessionId, roundId, uid, lobbyChose as boolean))
          }
          className="cursor-pointer rounded-full bg-accent-2/15 px-4 py-2 text-sm font-medium text-accent-2"
        >
          {t('answerGameRetry')}
        </button>
      )}

      {showLive && (
        <>
          <p className="text-center font-medium">{t('answerGameAnswerNow')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {(question.options ?? []).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => pick(value)}
                className={picked.includes(value) ? CHIP_ON : CHIP}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <HostButton
              busy={picked.length === 0}
              onClick={() =>
                void action.run(() =>
                  submitRoundAnswer(db, sessionId, roundId, uid, picked.includes(option)),
                )
              }
              primary
            >
              {t('answerGameConfirm')}
            </HostButton>
            {!skipped && (
              <HostButton
                busy={false}
                onClick={() => void action.run(() => skipRoundAnswer(db, sessionId, roundId, uid))}
              >
                {t('answerGameSkip')}
              </HostButton>
            )}
          </div>
        </>
      )}

      {action.slow && <p className="text-xs text-muted">{t('stillWorking')}</p>}
      {action.error && (
        <p role="alert" className="text-xs text-danger">
          {t('answerGameAnswerError')}{' '}
          <span dir="ltr" className="font-mono">
            ({action.error})
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * The guessing screen, from one player's side: tap the players you think chose
 * the option, then send. Keyed by round, so nothing carries over from the
 * previous round's marks.
 *
 * A guess is only ever sent on an explicit tap - including an empty one,
 * because "nobody chose it" is a real answer. It can be changed until the
 * reveal, and a phone that reloads mid-round reads its own guess back rather
 * than forgetting it.
 */
function GuessPanel({
  sessionId,
  roundId,
  uid,
  candidateIds: candidates,
  nameOf,
}: {
  sessionId: string
  roundId: string
  uid: string
  candidateIds: string[]
  nameOf: (playerId: string) => string
}) {
  const { t } = useTranslation()
  const guesser = useAction()
  const [selected, setSelected] = useState<string[]>([])
  const [submitted, setSubmitted] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void getMyGuess(db, sessionId, roundId, uid)
      .then((stored) => {
        if (cancelled || stored === null) return
        setSelected(stored)
        setSubmitted(stored)
      })
      .catch((error: unknown) => {
        console.error('[FlashPlay] reading own guess failed:', errorCode(error), error)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, roundId, uid])

  function toggle(playerId: string) {
    setSelected((current) =>
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId],
    )
  }

  async function submit() {
    const marked = selected
    await guesser.run(async () => {
      await castGuess(db, sessionId, roundId, uid, marked)
      setSubmitted(marked)
    })
  }

  return (
    <>
      <p className="font-medium">{t('answerGameMarkHint')}</p>
      <div className="flex w-full flex-col gap-2">
        {candidates.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            disabled={guesser.busy}
            className={
              selected.includes(id)
                ? 'cursor-pointer rounded-xl border-2 border-accent bg-accent/15 px-4 py-3 font-medium text-ink disabled:opacity-50'
                : 'cursor-pointer rounded-xl border border-line bg-surface/60 px-4 py-3 disabled:opacity-50'
            }
          >
            {nameOf(id)}
            {selected.includes(id) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <HostButton
        busy={guesser.busy || (submitted !== null && sameSet(selected, submitted))}
        busyLabel={guesser.busy ? t('answerGameSendingGuess') : t('answerGameGuessSent')}
        onClick={() => void submit()}
        primary
      >
        {t('answerGameSendGuess')}
      </HostButton>
      <p className="text-center text-xs text-muted">
        {submitted ? t('changeVoteHint') : t('answerGameNothingMarkedHint')}
      </p>
      <p className="text-center text-xs text-muted">{t('answerGameScoringHint')}</p>
      {guesser.slow && <p className="text-xs text-muted">{t('stillWorking')}</p>}
      {guesser.error && (
        <p role="alert" className="text-xs text-danger">
          {t('answerGameGuessError')}{' '}
          <span dir="ltr" className="font-mono">
            ({guesser.error})
          </span>
        </p>
      )}
    </>
  )
}
