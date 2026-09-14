import { useTranslation } from 'react-i18next'
import Scoreboard from './Scoreboard'

interface FinaleProps {
  players: { id: string; name: string }[]
  scores: Record<string, number>
}

/**
 * The end of the evening - milestone 6. DESIGN wants the gathering to have an
 * arc, and an arc needs a last frame: the cumulative scores, and whoever came
 * top, named.
 *
 * A tie names everyone tied. Picking one arbitrarily would be a worse ending
 * than admitting the room drew.
 */
export default function Finale({ players, scores }: FinaleProps) {
  const { t } = useTranslation()

  const best = Math.max(0, ...players.map((player) => scores[player.id] ?? 0))
  const winners = players.filter((player) => (scores[player.id] ?? 0) === best && best > 0)

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <p className="text-xl font-medium">{t('gatheringOver')}</p>
      {winners.length > 0 && (
        <p className="text-center text-lg">
          {t(
            // Hebrew has no "1 points": the singular gets its own string, the
            // same way memberCountOne does.
            winners.length === 1
              ? best === 1
                ? 'winnerIsOnePoint'
                : 'winnerIs'
              : best === 1
                ? 'winnersAreOnePoint'
                : 'winnersAre',
            { names: winners.map((w) => w.name).join(', '), points: best },
          )}
        </p>
      )}
      <Scoreboard players={players} scores={scores} title={t('finalScoresTitle')} />
      <p className="text-center text-sm text-neutral-500">{t('thanksForPlaying')}</p>
    </div>
  )
}
