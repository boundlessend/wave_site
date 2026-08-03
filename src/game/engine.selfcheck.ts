// self-check движка: `node src/game/engine.selfcheck.ts`
import assert from 'node:assert/strict'
import {
  reduce,
  initialState,
  nextActiveTeam,
  teamWithPlayers,
  MAX_PLAYERS,
  type Action,
} from './engine.ts'
import { TARGET_MAX } from './rules.ts'
import type { GameState } from './types.ts'

const run = (state: GameState, actions: readonly Action[]): GameState =>
  actions.reduce(reduce, state)

const card = ['Холодное', 'Горячее'] as const

// --- versus: полный раунд + проверки ролей ---
let s = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'Аня', team: 'left' } },
  { type: 'join', player: { id: 'b', name: 'Боря', team: 'right' } },
  { type: 'setMode', mode: 'versus' },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
])
assert.equal(s.phase, 'psychic')
assert.equal(s.round?.target, null, 'мишень скрыта до раскрытия')
assert.equal(s.round?.commit, null)

// commit-reveal: чужой commit отклонён, свой фиксируется ровно один раз
assert.equal(reduce(s, { type: 'commitTarget', actorId: 'b', commit: 'x' }).round?.commit, null, 'чужой commitTarget отклонён')
s = reduce(s, { type: 'commitTarget', actorId: 'a', commit: 'h1' })
assert.equal(s.round?.commit, 'h1')
assert.equal(reduce(s, { type: 'commitTarget', actorId: 'a', commit: 'h2' }).round?.commit, 'h1', 'повторный commit отклонён')

// роль: не-телепат не может дать подсказку
assert.equal(reduce(s, { type: 'submitClue', actorId: 'b', clue: 'x' }).phase, 'psychic', 'чужой submitClue отклонён')
s = reduce(s, { type: 'submitClue', actorId: 'a', clue: 'Кофе' })
assert.equal(s.phase, 'team')

// роль: игрок не активной команды не двигает стрелку
assert.equal(reduce(s, { type: 'moveNeedle', actorId: 'b', pos: 10 }).round?.needlePos, 50, 'чужой moveNeedle отклонён')
s = reduce(s, { type: 'moveNeedle', actorId: 'a', pos: 50 })
s = reduce(s, { type: 'lockNeedle', actorId: 'a' })
assert.equal(s.phase, 'leftright')

// роль: активная команда не выбирает сторону
assert.equal(reduce(s, { type: 'submitSide', actorId: 'a', side: 'LEFT' }).phase, 'leftright', 'активная команда не угадывает сторону')
s = reduce(s, { type: 'submitSide', actorId: 'b', side: 'LEFT' })
assert.equal(s.phase, 'await_reveal')
assert.deepEqual(s.scores, { left: 0, right: 0 }, 'до раскрытия очки не начислены')

// роль: не-телепат не раскрывает
assert.equal(reduce(s, { type: 'reveal', actorId: 'b', target: 50, nonce: 'n' }).phase, 'await_reveal', 'чужой reveal отклонён')
s = reduce(s, { type: 'reveal', actorId: 'a', target: 50, nonce: 'n' })
assert.deepEqual(s.scores, { left: 4, right: 0 }, 'центр: вторая команда 0')
assert.equal(s.phase, 'reveal')

// история партии: раунд записан с картой, подсказкой и приростом очков
assert.equal(s.history.length, 1, 'раунд попал в историю')
assert.deepEqual(s.history[0].gained, { left: 4, right: 0 })
assert.equal(s.history[0].clue, 'Кофе')
assert.equal(s.history[0].roundNo, 1)

// nextRound c дедупом по roundNo
const rn = s.roundNo
assert.equal(reduce(s, { type: 'nextRound', seed: { activeTeam: 'right', psychicId: 'b', card }, fromRoundNo: 999 }).roundNo, rn, 'устаревший nextRound отклонён')
s = reduce(s, { type: 'nextRound', seed: { activeTeam: 'right', psychicId: 'b', card }, fromRoundNo: rn })
assert.equal(s.roundNo, rn + 1)
assert.equal(s.round?.psychicId, 'b')

// --- догоняющий ---
let catchup = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'join', player: { id: 'b', name: 'Б', team: 'right' } },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
])
catchup = { ...catchup, scores: { left: 0, right: 6 } }
catchup = run(catchup, [
  { type: 'commitTarget', actorId: 'a', commit: 'h' },
  { type: 'submitClue', actorId: 'a', clue: 'к' },
  { type: 'moveNeedle', actorId: 'a', pos: 50 },
  { type: 'lockNeedle', actorId: 'a' },
  { type: 'submitSide', actorId: 'b', side: 'LEFT' },
  { type: 'reveal', actorId: 'a', target: 50, nonce: 'n' },
])
assert.deepEqual(catchup.scores, { left: 4, right: 6 })
assert.equal(nextActiveTeam(catchup), 'left', 'набрала 4 и проигрывает → ходит снова')

// --- reveal без commit отклоняется, мишень клампится к шкале ---
let nc = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'join', player: { id: 'b', name: 'Б', team: 'right' } },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
  { type: 'submitClue', actorId: 'a', clue: 'к' },
  { type: 'moveNeedle', actorId: 'a', pos: 50 },
  { type: 'lockNeedle', actorId: 'a' },
  { type: 'submitSide', actorId: 'b', side: 'LEFT' },
])
assert.equal(reduce(nc, { type: 'reveal', actorId: 'a', target: 50, nonce: 'n' }).phase, 'await_reveal', 'reveal без commit отклонён')
nc = run(nc, [{ type: 'toLobby' }, { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } }])
nc = run(nc, [
  { type: 'commitTarget', actorId: 'a', commit: 'h' },
  { type: 'submitClue', actorId: 'a', clue: 'к' },
  { type: 'moveNeedle', actorId: 'a', pos: 50 },
  { type: 'lockNeedle', actorId: 'a' },
  { type: 'submitSide', actorId: 'b', side: 'LEFT' },
  { type: 'reveal', actorId: 'a', target: 999, nonce: 'n' },
])
assert.equal(nc.round?.target, TARGET_MAX, 'мишень клампится к границе шкалы')

// --- setTeam/kick: только в лобби, setTeam только себе ---
const lob = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'join', player: { id: 'b', name: 'Б', team: 'right' } },
])
assert.equal(
  reduce(lob, { type: 'setTeam', actorId: 'a', team: 'right' }).players.find((p) => p.id === 'a')?.team,
  'right',
)
const kicked = reduce(lob, { type: 'kick', actorId: 'a', playerId: 'b' })
assert.equal(kicked.players.length, 1, 'кик в лобби')
assert.deepEqual(kicked.kicked, ['b'], 'кик помечен в state (клиент не пере-зайдёт)')
assert.deepEqual(reduce(lob, { type: 'leave', playerId: 'b' }).kicked, [], 'leave не помечает кик')
assert.equal(reduce(lob, { type: 'kick', actorId: 'zzz', playerId: 'b' }).players.length, 2, 'кик не-участником отклонён')
const inGame = reduce(lob, { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } })
assert.equal(reduce(inGame, { type: 'kick', actorId: 'a', playerId: 'b' }).players.length, 2, 'кик вне лобби отклонён')
assert.equal(
  reduce(inGame, { type: 'setTeam', actorId: 'a', team: 'right' }).players.find((p) => p.id === 'a')?.team,
  'left',
  'смена команды вне лобби отклонена',
)

// --- skipRound и toLobby ---
let k = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'join', player: { id: 'b', name: 'Б', team: 'right' } },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
  { type: 'submitClue', actorId: 'a', clue: 'x' },
])
const before = k.roundNo
k = reduce(k, { type: 'skipRound', seed: { activeTeam: 'right', psychicId: 'b', card }, fromRoundNo: before })
assert.equal(k.phase, 'psychic')
assert.equal(k.roundNo, before + 1, 'skipRound увеличил номер')
assert.equal(k.round?.psychicId, 'b')
assert.equal(reduce(k, { type: 'skipRound', seed: { activeTeam: 'left', psychicId: 'a', card }, fromRoundNo: 999 }).roundNo, k.roundNo, 'устаревший skipRound отклонён')
const lobby = reduce(k, { type: 'toLobby' })
assert.equal(lobby.phase, 'lobby')
assert.equal(lobby.round, null)

// --- лимит игроков в комнате ---
const crowd = run(
  initialState,
  Array.from({ length: MAX_PLAYERS + 5 }, (_, i) => ({
    type: 'join' as const,
    player: { id: `p${i}`, name: `И${i}`, team: 'left' as const },
  })),
)
assert.equal(crowd.players.length, MAX_PLAYERS, 'join сверх лимита отклонён')

// --- равенство на вершине не заканчивает партию ---
let draw = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'join', player: { id: 'b', name: 'Б', team: 'right' } },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
])
draw = { ...draw, scores: { left: 6, right: 10 } }
draw = run(draw, [
  { type: 'commitTarget', actorId: 'a', commit: 'h' },
  { type: 'submitClue', actorId: 'a', clue: 'к' },
  { type: 'moveNeedle', actorId: 'a', pos: 50 },
  { type: 'lockNeedle', actorId: 'a' },
  { type: 'submitSide', actorId: 'b', side: 'LEFT' },
  { type: 'reveal', actorId: 'a', target: 50, nonce: 'n' },
])
assert.deepEqual(draw.scores, { left: 10, right: 10 })
assert.equal(draw.winner, null, '10:10 — доигрываем')
assert.equal(draw.phase, 'reveal', 'партия продолжается')

// teamWithPlayers
assert.equal(teamWithPlayers(k, 'left'), 'left')
const onlyRight = run(initialState, [{ type: 'join', player: { id: 'b', name: 'Б', team: 'right' } }])
assert.equal(teamWithPlayers(onlyRight, 'left'), 'right', 'fallback на непустую команду')

// --- coop ---
let c = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'setMode', mode: 'coop' },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
])
assert.equal(c.cardsRemaining, 7)
c = run(c, [
  { type: 'commitTarget', actorId: 'a', commit: 'h' },
  { type: 'submitClue', actorId: 'a', clue: 'к' },
  { type: 'moveNeedle', actorId: 'a', pos: 50 },
  { type: 'lockNeedle', actorId: 'a' },
])
assert.equal(c.phase, 'await_reveal', 'coop минует фазу слева/справа')
c = reduce(c, { type: 'reveal', actorId: 'a', target: 50, nonce: 'n' })
assert.deepEqual(c.scores, { left: 3, right: 0 }, 'кооп: центр = 3 очка')
assert.equal(c.cardsRemaining, 7, 'центр: -1 карта +1 бонус = 7')

let c2 = run(initialState, [
  { type: 'join', player: { id: 'a', name: 'А', team: 'left' } },
  { type: 'setMode', mode: 'coop' },
  { type: 'startGame', seed: { activeTeam: 'left', psychicId: 'a', card } },
  { type: 'commitTarget', actorId: 'a', commit: 'h' },
  { type: 'submitClue', actorId: 'a', clue: 'к' },
  { type: 'moveNeedle', actorId: 'a', pos: 90 },
  { type: 'lockNeedle', actorId: 'a' },
  { type: 'reveal', actorId: 'a', target: 50, nonce: 'n' },
])
assert.equal(c2.cardsRemaining, 6, 'промах: -1 карта')

console.log('engine.selfcheck: OK')
