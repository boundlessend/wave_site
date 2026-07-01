// чистые функции правил "длины волны": геометрия шкалы, очки, переходы

import type { Scores, Side, TeamId } from './types.ts'

// шкала 0..100 слева направо. полуширины зон от центра мишени.
// 5 полос по ~3.33 единицы: 2-3-4-3-2, вся мишень ~16.7 единиц (~30° из 180°),
// как в настольной "Длине волны". ponytail: калибруется здесь же
export const ZONE = {
  four: 1.67, // |d| <= 1.67 → 4 очка (центр)
  three: 5, // |d| <= 5    → 3 очка
  two: 8.33, // |d| <= 8.33 → 2 очка
} as const

export const TARGET_MIN = ZONE.two
export const TARGET_MAX = 100 - ZONE.two
export const WIN_SCORE = 10

// случайный центр мишени так, чтобы вся зона помещалась на шкале
export const randomTarget = (): number =>
  TARGET_MIN + Math.random() * (TARGET_MAX - TARGET_MIN)

// очки за попадание стрелки относительно центра мишени
export const bandPoints = (target: number, needle: number): 0 | 2 | 3 | 4 => {
  const d = Math.abs(target - needle)
  if (d <= ZONE.four) return 4
  if (d <= ZONE.three) return 3
  if (d <= ZONE.two) return 2
  return 0
}

// очки за раунд в кооперативе: центр даёт 3 очка вместо 4
export const coopPoints = (target: number, needle: number): 0 | 2 | 3 => {
  const p = bandPoints(target, needle)
  return p === 4 ? 3 : p
}

// с какой стороны от стрелки находится центр мишени
export const sideOfTarget = (target: number, needle: number): Side =>
  target < needle ? 'LEFT' : 'RIGHT'

export const otherTeam = (team: TeamId): TeamId =>
  team === 'left' ? 'right' : 'left'

// прирост очков за раунд в режиме versus
export const scoreVersusRound = (params: {
  target: number
  needle: number
  activeTeam: TeamId
  leftRightGuess: Side | null
}): Scores => {
  const psychicPoints = bandPoints(params.target, params.needle)
  const other = otherTeam(params.activeTeam)
  // вторая команда получает очко за верную сторону, но не если телепат попал в центр (4)
  let otherPoints = 0
  if (psychicPoints !== 4 && params.leftRightGuess !== null) {
    if (params.leftRightGuess === sideOfTarget(params.target, params.needle)) {
      otherPoints = 1
    }
  }
  const zero: Scores = { left: 0, right: 0 }
  return {
    ...zero,
    [params.activeTeam]: psychicPoints,
    [other]: otherPoints,
  }
}

export const addScores = (a: Scores, b: Scores): Scores => ({
  left: a.left + b.left,
  right: a.right + b.right,
})

// правило догоняющего: команда, набравшая 4 очка за ход и всё ещё
// проигрывающая по счёту, ходит снова (телепат при этом меняется)
export const keepsTurn = (params: {
  pointsThisTurn: number
  scoresAfter: Scores
  activeTeam: TeamId
}): boolean => {
  if (params.pointsThisTurn !== 4) return false
  const other = otherTeam(params.activeTeam)
  return params.scoresAfter[params.activeTeam] < params.scoresAfter[other]
}

// победитель после раунда: игра кончается когда кто-то набрал WIN_SCORE+,
// побеждает команда с большим счётом; равные счёты на вершине → ничья (gameover)
export const checkWinner = (scores: Scores): TeamId | 'tie' | null => {
  if (scores.left < WIN_SCORE && scores.right < WIN_SCORE) return null
  if (scores.left === scores.right) return 'tie'
  return scores.left > scores.right ? 'left' : 'right'
}
