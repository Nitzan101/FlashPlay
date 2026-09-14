import { useTranslation } from 'react-i18next'

interface ScoreboardProps {
  /** Everyone in the room, so that a player on zero still appears. Scoring
   *  from `sessions.scores` alone would leave anyone who has not scored off
   *  the board entirely, which at a family table is the person least in need
   *  of being made invisible. */
  players: { id: string; name: string }[]
  scores: Record<string, number>
  title: string
}

/** The running total, cumulative across the gathering (DESIGN: "an evening
 *  with an arc"). Shown during the round loop and again when the game ends. */
export default function Scoreboard({ players, scores, title }: ScoreboardProps) {
  const { t } = useTranslation()
  if (players.length === 0) return null

  const ranked = players
    .map((player) => ({ ...player, points: scores[player.id] ?? 0 }))
    .sort((a, b) => b.points - a.points)

  return (
    <div className="w-full max-w-sm rounded-md border border-neutral-200 p-3">
      <p className="mb-1 text-sm font-medium">{title}</p>
      {ranked.map((player) => (
        <p key={player.id} className="flex justify-between text-sm">
          <span>{player.name}</span>
          <span>{t('pointsValue', { points: player.points })}</span>
        </p>
      ))}
    </div>
  )
}
