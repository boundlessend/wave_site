import { useCallback, useEffect, useRef, useState } from 'react'
import type { Transport } from './net/transport.ts'
import { nextActiveTeam } from './game/engine.ts'
import type { GameMode, GameState, Player, Side, TeamId } from './game/types.ts'
import { randomTarget } from './game/rules.ts'
import { pickCard, pickPsychic } from './game/orchestrate.ts'

// хук комнаты: состояние из транспорта + локальный секрет мишени телепата
export const useRoom = (transport: Transport) => {
  const [state, setState] = useState<GameState>(transport.getState())
  const [meId, setMeId] = useState<string | null>(null)
  const [secret, setSecret] = useState<number | null>(null)
  const secretRound = useRef<number>(-1)

  useEffect(() => transport.subscribe(setState), [transport])

  const me: Player | null = state.players.find((p) => p.id === meId) ?? null

  // телепат генерирует мишень один раз за раунд — только на своём устройстве
  useEffect(() => {
    if (
      state.phase === 'psychic' &&
      me !== null &&
      state.round?.psychicId === me.id &&
      secretRound.current !== state.roundNo
    ) {
      secretRound.current = state.roundNo
      setSecret(randomTarget())
    }
  }, [state.phase, state.roundNo, state.round, me])

  const d = transport.dispatch

  const join = useCallback(
    (name: string, team: TeamId): string => {
      const id = crypto.randomUUID()
      d({ type: 'join', player: { id, name, team } })
      setMeId(id)
      transport.setIdentity(id) // привязать устройство к игроку
      return id
    },
    [transport, d],
  )

  const startGame = useCallback(() => {
    const s = transport.getState()
    const team: TeamId = 'left'
    const psychicId = pickPsychic(s.players, team, '')
    d({ type: 'startGame', seed: { activeTeam: team, psychicId, card: pickCard() } })
  }, [transport, d])

  const nextRound = useCallback(() => {
    const s = transport.getState()
    const team = s.mode === 'coop' ? ('left' as TeamId) : nextActiveTeam(s)
    const psychicId = pickPsychic(s.players, team, s.round?.psychicId ?? '')
    d({ type: 'nextRound', seed: { activeTeam: team, psychicId, card: pickCard() } })
  }, [transport, d])

  const reveal = useCallback(() => {
    if (secret === null) return
    d({ type: 'reveal', target: secret })
  }, [d, secret])

  // добавить игрока, не присваивая его себе (для локальной отладки)
  const addPlayer = useCallback(
    (name: string, team: TeamId): void => {
      d({ type: 'join', player: { id: crypto.randomUUID(), name, team } })
    },
    [d],
  )

  const actions = {
    join,
    addPlayer,
    setTeam: (playerId: string, team: TeamId) => d({ type: 'setTeam', playerId, team }),
    setMode: (mode: GameMode) => d({ type: 'setMode', mode }),
    startGame,
    submitClue: (clue: string) => d({ type: 'submitClue', clue }),
    moveNeedle: (pos: number) => d({ type: 'moveNeedle', pos }),
    lockNeedle: () => d({ type: 'lockNeedle' }),
    submitSide: (side: Side) => d({ type: 'submitSide', side }),
    reveal,
    nextRound,
    reset: () => d({ type: 'reset' }),
  }

  return { state, me, setMeId, secret, actions }
}

export type Room = ReturnType<typeof useRoom>

