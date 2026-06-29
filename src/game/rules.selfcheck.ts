// self-check правил: запуск `node src/game/rules.selfcheck.ts`
import assert from 'node:assert/strict'
import {
  bandPoints,
  sideOfTarget,
  scoreVersusRound,
  keepsTurn,
  checkWinner,
  ZONE,
} from './rules.ts'

// полосы очков по расстоянию от центра
assert.equal(bandPoints(50, 50), 4, 'точный центр = 4')
assert.equal(bandPoints(50, 50 + ZONE.four - 0.01), 4)
assert.equal(bandPoints(50, 50 + ZONE.four + 0.01), 3)
assert.equal(bandPoints(50, 50 + ZONE.three + 0.01), 2)
assert.equal(bandPoints(50, 50 + ZONE.two + 0.01), 0, 'вне зоны = 0')

// сторона мишени относительно стрелки
assert.equal(sideOfTarget(30, 50), 'LEFT', 'мишень левее стрелки')
assert.equal(sideOfTarget(70, 50), 'RIGHT', 'мишень правее стрелки')

// versus: телепат попал в центр (4) — вторая команда не получает очка даже за верную сторону
let s = scoreVersusRound({ target: 50, needle: 50, activeTeam: 'left', leftRightGuess: 'LEFT' })
assert.deepEqual(s, { left: 4, right: 0 }, 'центр: вторая команда 0')

// versus: телепат 3 очка, вторая команда угадала сторону → +1
s = scoreVersusRound({ target: 50, needle: 55, activeTeam: 'left', leftRightGuess: 'LEFT' })
assert.deepEqual(s, { left: 3, right: 1 }, 'мишень слева от стрелки, угадали LEFT')

// versus: вторая команда ошиблась стороной → 0
s = scoreVersusRound({ target: 50, needle: 55, activeTeam: 'right', leftRightGuess: 'RIGHT' })
assert.deepEqual(s, { left: 0, right: 3 }, 'ошиблись стороной')

// правило догоняющего: 4 очка и всё ещё проигрываешь → ходишь снова
assert.equal(
  keepsTurn({ pointsThisTurn: 4, scoresAfter: { left: 8, right: 9 }, activeTeam: 'left' }),
  true,
)
assert.equal(
  keepsTurn({ pointsThisTurn: 4, scoresAfter: { left: 10, right: 9 }, activeTeam: 'left' }),
  false,
  'ведёшь — ход передаётся',
)
assert.equal(
  keepsTurn({ pointsThisTurn: 3, scoresAfter: { left: 8, right: 9 }, activeTeam: 'left' }),
  false,
  'не 4 очка — ход передаётся',
)

// победитель
assert.equal(checkWinner({ left: 9, right: 7 }), null, 'до 10 нет победителя')
assert.equal(checkWinner({ left: 10, right: 7 }), 'left')
assert.equal(checkWinner({ left: 11, right: 11 }), 'tie', 'равенство на вершине — доигрываем')

console.log('rules.selfcheck: OK')
