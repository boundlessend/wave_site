// проверка формы состояния, пришедшего по сети. расшифровка доказывает знание
// ключа комнаты, но не структуру: без этой проверки битый или подделанный объект
// подменит стол и уронит рендер. редьюсер защищён своими guard'ами, состояние — нет
import type { Card, GameState, Player, Round, RoundResult, Scores } from '../game/types.ts'

const PHASES = ['lobby', 'psychic', 'team', 'leftright', 'await_reveal', 'reveal', 'gameover']
const TEAMS = ['left', 'right']

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isTeam = (v: unknown): v is 'left' | 'right' => typeof v === 'string' && TEAMS.includes(v)

const isCard = (v: unknown): v is Card =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string'

const isScores = (v: unknown): v is Scores => isObj(v) && isNum(v.left) && isNum(v.right)

const isPlayer = (v: unknown): v is Player =>
  isObj(v) && typeof v.id === 'string' && typeof v.name === 'string' && isTeam(v.team)

const isRound = (v: unknown): v is Round =>
  isObj(v) &&
  isTeam(v.activeTeam) &&
  typeof v.psychicId === 'string' &&
  isCard(v.card) &&
  typeof v.clue === 'string' &&
  (v.commit === null || typeof v.commit === 'string') &&
  (v.target === null || isNum(v.target)) &&
  isNum(v.needlePos) &&
  (v.leftRightGuess === null || v.leftRightGuess === 'LEFT' || v.leftRightGuess === 'RIGHT')

const isRoundResult = (v: unknown): v is RoundResult =>
  isObj(v) &&
  isNum(v.roundNo) &&
  isCard(v.card) &&
  typeof v.clue === 'string' &&
  isNum(v.target) &&
  isNum(v.needlePos) &&
  isTeam(v.activeTeam) &&
  typeof v.psychicId === 'string' &&
  isScores(v.gained)

export const isGameState = (v: unknown): v is GameState =>
  isObj(v) &&
  (v.mode === 'versus' || v.mode === 'coop') &&
  typeof v.phase === 'string' &&
  PHASES.includes(v.phase) &&
  Array.isArray(v.players) &&
  v.players.every(isPlayer) &&
  Array.isArray(v.kicked) &&
  v.kicked.every((id) => typeof id === 'string') &&
  isScores(v.scores) &&
  (v.round === null || isRound(v.round)) &&
  isNum(v.roundNo) &&
  isNum(v.cardsRemaining) &&
  (v.winner === null || isTeam(v.winner)) &&
  Array.isArray(v.history) &&
  v.history.every(isRoundResult)
