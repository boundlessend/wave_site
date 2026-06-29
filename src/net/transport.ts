// транспорт состояния игры. одна абстракция, две реализации:
// локальная (одна вкладка, для разработки) и Supabase (онлайн, добавится позже)
import type { Action } from '../game/engine.ts'
import { reduce, initialState } from '../game/engine.ts'
import type { GameState } from '../game/types.ts'

export type ConnStatus = 'connecting' | 'online' | 'error'

export type Transport = {
  dispatch: (action: Action) => void
  subscribe: (cb: (state: GameState) => void) => () => void
  subscribeStatus: (cb: (status: ConnStatus) => void) => () => void
  getState: () => GameState
  // связать это устройство с игроком (для удаления при отключении)
  setIdentity: (playerId: string) => void
  dispose: () => void
}

// локальный транспорт: состояние живёт в памяти вкладки, reduce на месте
export const createLocalTransport = (): Transport => {
  let state: GameState = initialState
  const subs = new Set<(s: GameState) => void>()
  const notify = (): void => subs.forEach((cb) => cb(state))
  return {
    dispatch: (action) => {
      state = reduce(state, action)
      notify()
    },
    subscribe: (cb) => {
      subs.add(cb)
      cb(state)
      return () => void subs.delete(cb)
    },
    subscribeStatus: (cb) => {
      cb('online') // локально связь всегда есть
      return () => {}
    },
    getState: () => state,
    setIdentity: () => {}, // локально presence нет
    dispose: () => subs.clear(),
  }
}
