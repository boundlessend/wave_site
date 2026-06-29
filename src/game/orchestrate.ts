// вспомогательные функции с случайностью для запуска раундов (вне редьюсера)
import type { Card, Player, TeamId } from './types.ts'
import { CARDS } from '../cards.ts'

export const pickCard = (): Card => CARDS[Math.floor(Math.random() * CARDS.length)]

export const teamPlayers = (
  players: readonly Player[],
  team: TeamId,
): readonly Player[] => players.filter((p) => p.team === team)

// телепат из команды: по возможности не тот же, что в прошлый раз
export const pickPsychic = (
  players: readonly Player[],
  team: TeamId,
  avoidId: string,
): string => {
  const pool = teamPlayers(players, team)
  const fresh = pool.filter((p) => p.id !== avoidId)
  const arr = fresh.length > 0 ? fresh : pool
  if (arr.length === 0) return ''
  return arr[Math.floor(Math.random() * arr.length)].id
}
