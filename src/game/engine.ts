// движок игры: чистый редьюсер (state, action) => state.
// вся случайность (мишень, карта, выбор телепата) приходит в payload,
// чтобы host генерировал её снаружи, а редьюсер оставался чистым и тестируемым

import type {
  Card,
  GameMode,
  GameState,
  Player,
  Round,
  Side,
  TeamId,
} from './types.ts'
import {
  addScores,
  bandPoints,
  checkWinner,
  coopPoints,
  keepsTurn,
  otherTeam,
  scoreVersusRound,
} from './rules.ts'

export const COOP_DECK = 7

// зерно нового раунда. БЕЗ мишени: её знает только телепат до раскрытия
export type RoundSeed = {
  readonly activeTeam: TeamId
  readonly psychicId: string
  readonly card: Card
}

export type Action =
  | { type: 'join'; player: Player }
  | { type: 'leave'; playerId: string }
  | { type: 'setTeam'; playerId: string; team: TeamId }
  | { type: 'setMode'; mode: GameMode }
  | { type: 'startGame'; seed: RoundSeed }
  | { type: 'submitClue'; clue: string }
  | { type: 'moveNeedle'; pos: number }
  | { type: 'lockNeedle' }
  | { type: 'submitSide'; side: Side }
  | { type: 'reveal'; target: number } // телепат "открывает экран"
  | { type: 'nextRound'; seed: RoundSeed }
  | { type: 'reset' }

export const initialState: GameState = {
  mode: 'versus',
  phase: 'lobby',
  players: [],
  scores: { left: 0, right: 0 },
  round: null,
  roundNo: 0,
  cardsRemaining: 0,
  winner: null,
}

const startRound = (seed: RoundSeed): Round => ({
  activeTeam: seed.activeTeam,
  psychicId: seed.psychicId,
  card: seed.card,
  clue: '',
  target: null, // станет известна только при reveal
  needlePos: 50,
  leftRightGuess: null,
})

// применить итоги раунда (общая часть versus и coop). target уже раскрыта
const applyReveal = (
  state: GameState,
  round: Round & { target: number },
): Pick<GameState, 'scores' | 'cardsRemaining' | 'winner'> => {
  if (state.mode === 'coop') {
    // официальное правило коопа: центр даёт 3 очка (не 4), но добавляет
    // бонусную карту в колоду — игра длится на раунд дольше
    const hitCenter = bandPoints(round.target, round.needlePos) === 4
    const cards = state.cardsRemaining - 1 + (hitCenter ? 1 : 0)
    return {
      scores: addScores(state.scores, { left: coopPoints(round.target, round.needlePos), right: 0 }),
      cardsRemaining: cards,
      winner: null,
    }
  }
  const delta = scoreVersusRound({
    target: round.target,
    needle: round.needlePos,
    activeTeam: round.activeTeam,
    leftRightGuess: round.leftRightGuess,
  })
  const scores = addScores(state.scores, delta)
  return {
    scores,
    cardsRemaining: state.cardsRemaining,
    winner: checkWinner(scores),
  }
}

export const reduce = (state: GameState, action: Action): GameState => {
  switch (action.type) {
    case 'join': {
      if (state.players.some((p) => p.id === action.player.id)) return state
      return { ...state, players: [...state.players, action.player] }
    }
    case 'leave':
      return {
        ...state,
        players: state.players.filter((p) => p.id !== action.playerId),
      }
    case 'setTeam':
      return {
        ...state,
        players: state.players.map((p) =>
          p.id === action.playerId ? { ...p, team: action.team } : p,
        ),
      }
    case 'setMode':
      return { ...state, mode: action.mode }
    case 'startGame': {
      if (state.phase !== 'lobby') return state
      const players =
        state.mode === 'coop'
          ? state.players.map((p) => ({ ...p, team: 'left' as TeamId }))
          : state.players
      return {
        ...state,
        players,
        phase: 'psychic',
        scores: { left: 0, right: 0 },
        cardsRemaining: state.mode === 'coop' ? COOP_DECK : 0,
        winner: null,
        round: startRound(action.seed),
        roundNo: 1,
      }
    }
    case 'submitClue': {
      if (!state.round || state.phase !== 'psychic') return state
      return {
        ...state,
        phase: 'team',
        round: { ...state.round, clue: action.clue },
      }
    }
    case 'moveNeedle': {
      if (!state.round || state.phase !== 'team') return state
      return { ...state, round: { ...state.round, needlePos: action.pos } }
    }
    case 'lockNeedle': {
      if (!state.round || state.phase !== 'team') return state
      // coop минует фазу слева/справа; обе ветки ждут раскрытия телепатом
      return { ...state, phase: state.mode === 'coop' ? 'await_reveal' : 'leftright' }
    }
    case 'submitSide': {
      if (!state.round || state.phase !== 'leftright') return state
      return {
        ...state,
        phase: 'await_reveal',
        round: { ...state.round, leftRightGuess: action.side },
      }
    }
    case 'reveal': {
      if (!state.round || state.phase !== 'await_reveal') return state
      const round = { ...state.round, target: action.target }
      const r = applyReveal(state, round)
      return {
        ...state,
        round,
        phase: r.winner ? 'gameover' : 'reveal',
        scores: r.scores,
        cardsRemaining: r.cardsRemaining,
        winner: r.winner,
      }
    }
    case 'nextRound': {
      if (state.phase !== 'reveal') return state
      if (state.mode === 'coop' && state.cardsRemaining <= 0) {
        return { ...state, phase: 'gameover', round: null }
      }
      return {
        ...state,
        phase: 'psychic',
        round: startRound(action.seed),
        roundNo: state.roundNo + 1,
      }
    }
    case 'reset':
      return { ...initialState, players: state.players, mode: state.mode }
  }
}

// какая команда ходит следующей (правило догоняющего). versus-only
export const nextActiveTeam = (state: GameState): TeamId => {
  if (!state.round || state.round.target === null) return 'left'
  const stays = keepsTurn({
    pointsThisTurn: bandPoints(state.round.target, state.round.needlePos),
    scoresAfter: state.scores,
    activeTeam: state.round.activeTeam,
  })
  return stays ? state.round.activeTeam : otherTeam(state.round.activeTeam)
}
