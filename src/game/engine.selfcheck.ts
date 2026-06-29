// self-check движка: `node src/game/engine.selfcheck.ts`
import assert from 'node:assert/strict'
import { reduce, initialState, nextActiveTeam, type Action } from './engine.ts'
import type { GameState } from './types.ts'

const run = (state: GameState, actions: readonly Action[]): GameState =>
  actions.reduce(reduce, state)

const card = ['Холодное', 'Горячее'] as const

// --- versus: полный раунд ---
let s = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'Аня', team: 'left' } },
  { type: 'join', player: { id: 'b', name: 'Боря', team: 'right' } },
  { type: 'setMode', mode: 'versus' },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
])
assert.equal(s.phase, 'psychic')
assert.equal(s.players.length, 2)
assert.equal(s.round?.target, null, 'мишень скрыта до раскрытия')

s = reduce(s, { type: 'submitClue', clue: 'Кофе' })
assert.equal(s.phase, 'team')

s = reduce(s, { type: 'moveNeedle', pos: 50 }) // точно в центр
assert.equal(s.round?.needlePos, 50)

s = reduce(s, { type: 'lockNeedle' })
assert.equal(s.phase, 'leftright', 'versus идёт в фазу слева/справа')

s = reduce(s, { type: 'submitSide', side: 'LEFT' })
assert.equal(s.phase, 'await_reveal', 'ждём телепата')
assert.deepEqual(s.scores, { left: 0, right: 0 }, 'до раскрытия очки не начислены')

s = reduce(s, { type: 'reveal', target: 50 }) // телепат открывает: стрелка в центре
// телепат попал в центр (4), вторая команда 0 даже несмотря на guess
assert.deepEqual(s.scores, { left: 4, right: 0 })
assert.equal(s.phase, 'reveal')

// правило догоняющего: left набрала 4 и проигрывает? нет (4>0) → ход переходит
// сделаем сценарий где left проигрывает: дадим right фору вручную через прогон
let catchup = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'join', player: { id: 'b', name: 'Б', team: 'right' } },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
])
catchup = { ...catchup, scores: { left: 0, right: 6 } } // right ведёт
catchup = run(catchup, [
  { type: 'submitClue', clue: 'к' },
  { type: 'moveNeedle', pos: 50 },
  { type: 'lockNeedle' },
  { type: 'submitSide', side: 'LEFT' },
  { type: 'reveal', target: 50 },
])
assert.deepEqual(catchup.scores, { left: 4, right: 6 })
assert.equal(nextActiveTeam(catchup), 'left', 'набрала 4 и проигрывает → ходит снова')

// --- coop: попадание в центр даёт +карту (нетто колода не меняется) ---
let c = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'setMode', mode: 'coop' },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
])
assert.equal(c.cardsRemaining, 7)
c = run(c, [
  { type: 'submitClue', clue: 'к' },
  { type: 'moveNeedle', pos: 50 }, // центр
  { type: 'lockNeedle' },
])
assert.equal(c.phase, 'await_reveal', 'coop минует фазу слева/справа, ждёт телепата')
c = reduce(c, { type: 'reveal', target: 50 })
assert.equal(c.phase, 'reveal')
assert.deepEqual(c.scores, { left: 3, right: 0 }, 'кооп: центр = 3 очка')
assert.equal(c.cardsRemaining, 7, 'центр: -1 карта +1 бонус = 7')

// coop: промах тратит карту
let c2 = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'setMode', mode: 'coop' },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
  { type: 'submitClue', clue: 'к' },
  { type: 'moveNeedle', pos: 90 }, // мимо
  { type: 'lockNeedle' },
  { type: 'reveal', target: 50 },
])
assert.equal(c2.cardsRemaining, 6, 'промах: -1 карта')
assert.deepEqual(c2.scores, { left: 0, right: 0 })

console.log('engine.selfcheck: OK')
