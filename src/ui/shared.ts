import type { GameState, TeamId } from '../game/types.ts'

export const TEAM_NAME: Record<TeamId, string> = {
  left: 'Левое полушарие',
  right: 'Правое полушарие',
}

// не-цветовой признак команды (для дальтоников)
export const TEAM_MARK: Record<TeamId, string> = { left: '▲', right: '●' }

export const nameOf = (state: GameState, id: string): string =>
  state.players.find((p) => p.id === id)?.name ?? '???'

export const teamCount = (state: GameState, team: TeamId): number =>
  state.players.filter((p) => p.team === team).length
