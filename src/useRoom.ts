import { useEffect, useRef, useState } from 'react'
import type { Transport, ConnStatus } from './net/transport.ts'
import { nextActiveTeam, teamWithPlayers, type RoundSeed } from './game/engine.ts'
import type { GameMode, GameState, Player, Side, TeamId } from './game/types.ts'
import { randomTarget } from './game/rules.ts'
import { genNonce, targetCommit } from './game/commit.ts'
import { pickCard, pickPsychic } from './game/orchestrate.ts'

// секрет телепата: мишень + nonce для commit-reveal, живёт только на его устройстве
export type TargetSecret = { readonly target: number; readonly nonce: string }

// зерно нового раунда с валидной (непустой) командой и телепатом
const buildSeed = (s: GameState, preferred: TeamId): RoundSeed | null => {
  const avoidCard = s.round?.card ?? null
  if (s.mode === 'coop') {
    // startGame переносит всех в 'left'; телепат из всех игроков, ход всегда за 'left'
    const asLeft = s.players.map((p) => ({ ...p, team: 'left' as TeamId }))
    const psychicId = pickPsychic(asLeft, 'left', s.round?.psychicId ?? '')
    if (psychicId === '') return null
    return { activeTeam: 'left', psychicId, card: pickCard(avoidCard) }
  }
  const team = teamWithPlayers(s, preferred)
  if (team === null) return null
  const psychicId = pickPsychic(s.players, team, s.round?.psychicId ?? '')
  if (psychicId === '') return null
  return { activeTeam: team, psychicId, card: pickCard(avoidCard) }
}

// хук комнаты: состояние из транспорта + локальный секрет мишени телепата.
// persistKey — ключ sessionStorage для восстановления игрока после перезагрузки
// вкладки (null = без восстановления, локальный режим)
export const useRoom = (transport: Transport, persistKey: string | null) => {
  const [state, setState] = useState<GameState>(transport.getState())
  const [conn, setConn] = useState<ConnStatus>('connecting')
  const [meId, setMeId] = useState<string | null>(null)
  const [secret, setSecret] = useState<TargetSecret | null>(null)
  const secretRound = useRef<number>(-1)

  useEffect(() => transport.subscribe(setState), [transport])
  useEffect(() => transport.subscribeStatus(setConn), [transport])

  // восстановление после перезагрузки: если наш игрок ещё в партии
  // (хост удаляет ушедших с отсрочкой) — возвращаем себе его место
  useEffect(() => {
    if (meId !== null || persistKey === null) return
    const stored = sessionStorage.getItem(persistKey)
    if (stored !== null && state.players.some((p) => p.id === stored)) {
      setMeId(stored)
      transport.setIdentity(stored)
    }
  }, [state.players, meId, persistKey, transport])

  const me: Player | null = state.players.find((p) => p.id === meId) ?? null
  const d = transport.dispatch

  // телепат генерирует мишень один раз за раунд — только на своём устройстве;
  // сразу публикует commit (хеш мишени), чтобы не мог подменить её при раскрытии
  useEffect(() => {
    if (
      state.phase === 'psychic' &&
      me !== null &&
      state.round?.psychicId === me.id &&
      secretRound.current !== state.roundNo
    ) {
      secretRound.current = state.roundNo
      const roundNo = state.roundNo
      const actorId = me.id
      const target = randomTarget()
      const nonce = genNonce()
      setSecret({ target, nonce })
      void targetCommit(roundNo, target, nonce).then((commit) =>
        d({ type: 'commitTarget', actorId, commit }),
      )
    }
  }, [state.phase, state.roundNo, state.round, me, d])

  // сброс секрета при возврате в лобби: иначе он переиспользуется на roundNo=1 новой игры
  useEffect(() => {
    if (state.phase === 'lobby') {
      secretRound.current = -1
      setSecret(null)
    }
  }, [state.phase])

  // авто-восстановление: раунд не может продолжиться (вышел телепат или вся
  // вторая команда покинула фазу слева/справа) → пропускаем раунд
  useEffect(() => {
    const r = state.round
    const inRound =
      state.phase === 'psychic' ||
      state.phase === 'team' ||
      state.phase === 'leftright' ||
      state.phase === 'await_reveal'
    if (!r || !inRound) return
    const psychicGone = !state.players.some((p) => p.id === r.psychicId)
    const secondTeamGone =
      state.mode === 'versus' &&
      state.phase === 'leftright' &&
      !state.players.some((p) => p.team !== r.activeTeam)
    if (!psychicGone && !secondTeamGone) return
    const seed = buildSeed(state, r.activeTeam)
    if (seed) d({ type: 'skipRound', seed, fromRoundNo: state.roundNo })
    else d({ type: 'toLobby' })
  }, [state, d])

  const a = meId ?? ''

  const actions = {
    join: (name: string, team: TeamId): string => {
      const id = crypto.randomUUID()
      d({ type: 'join', player: { id, name, team } })
      setMeId(id)
      transport.setIdentity(id) // привязать устройство к игроку
      if (persistKey !== null) sessionStorage.setItem(persistKey, id)
      return id
    },
    // выйти из комнаты: убрать себя из партии и забыть сохранённое место.
    // если kick не долетит (вкладка закроется раньше) — presence-очистка добьёт
    leaveRoom: () => {
      if (meId !== null) d({ type: 'kick', actorId: meId, playerId: meId })
      if (persistKey !== null) sessionStorage.removeItem(persistKey)
    },
    // добавить игрока, не присваивая себе (только для локальной отладки)
    addPlayer: (name: string, team: TeamId) =>
      d({ type: 'join', player: { id: crypto.randomUUID(), name, team } }),
    setTeam: (team: TeamId) => d({ type: 'setTeam', actorId: a, team }),
    kick: (playerId: string) => d({ type: 'kick', actorId: a, playerId }),
    setMode: (mode: GameMode) => d({ type: 'setMode', mode }),
    startGame: () => {
      const s = transport.getState()
      const seed = buildSeed(s, 'left')
      if (seed) d({ type: 'startGame', seed })
    },
    submitClue: (clue: string) => d({ type: 'submitClue', actorId: a, clue }),
    moveNeedle: (pos: number) => d({ type: 'moveNeedle', actorId: a, pos }),
    lockNeedle: () => d({ type: 'lockNeedle', actorId: a }),
    submitSide: (side: Side) => d({ type: 'submitSide', actorId: a, side }),
    reveal: () => {
      if (secret === null) return
      d({ type: 'reveal', actorId: a, target: secret.target, nonce: secret.nonce })
    },
    nextRound: () => {
      const s = transport.getState()
      const seed = buildSeed(s, nextActiveTeam(s))
      if (seed) d({ type: 'nextRound', seed, fromRoundNo: s.roundNo })
      else d({ type: 'toLobby' })
    },
    skipRound: () => {
      const s = transport.getState()
      const seed = buildSeed(s, s.round?.activeTeam ?? 'left')
      if (seed) d({ type: 'skipRound', seed, fromRoundNo: s.roundNo })
      else d({ type: 'toLobby' })
    },
    toLobby: () => d({ type: 'toLobby' }),
    reset: () => d({ type: 'reset' }),
  }

  return { state, conn, me, setMeId, secret, actions }
}

export type Room = ReturnType<typeof useRoom>
