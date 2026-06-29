// Supabase Realtime транспорт. авторитет (host) выбирается по presence:
// хост = самый ранний присутствующий клиент. при его уходе авторитет берёт
// следующий по старшинству — у каждого клиента уже есть последний снапшот.
import { createClient } from '@supabase/supabase-js'
import type { ConnStatus, Transport } from './transport.ts'
import { reduce, initialState, type Action } from '../game/engine.ts'
import type { GameState } from '../game/types.ts'

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const supabaseConfigured = (): boolean =>
  typeof URL === 'string' && /supabase\.co/.test(URL) && typeof KEY === 'string' && KEY.length > 0

const supabase = supabaseConfigured() ? createClient(URL as string, KEY as string) : null

type Presence = { clientId: string; joinedAt: number; playerId: string | null }

const NEEDLE_MS = 50 // троттл сетевых обновлений стрелки

export const createSupabaseTransport = (opts: { code: string }): Transport => {
  if (!supabase) throw new Error('Supabase не настроен: проверь VITE_SUPABASE_URL и VITE_SUPABASE_KEY')
  const clientId = crypto.randomUUID()
  const joinedAt = Date.now()
  let myPlayerId: string | null = null
  let state: GameState = initialState
  let amHost = false
  const subs = new Set<(s: GameState) => void>()
  const statusSubs = new Set<(s: ConnStatus) => void>()
  let conn: ConnStatus = 'connecting'
  const notify = (): void => subs.forEach((cb) => cb(state))
  const setConn = (s: ConnStatus): void => {
    conn = s
    statusSubs.forEach((cb) => cb(s))
  }

  const channel = supabase.channel(`room-${opts.code}`, {
    config: { broadcast: { self: false }, presence: { key: clientId } },
  })

  const track = (): void => {
    void channel.track({ clientId, joinedAt, playerId: myPlayerId } satisfies Presence)
  }
  const sendState = (): void => {
    void channel.send({ type: 'broadcast', event: 'state', payload: state })
  }
  const sendAction = (action: Action): void => {
    void channel.send({ type: 'broadcast', event: 'action', payload: action })
  }
  const applyAsHost = (action: Action): void => {
    state = reduce(state, action)
    notify()
    sendState()
  }
  const presentPlayerIds = (): Set<string> => {
    const ids = new Set<string>()
    for (const arr of Object.values(channel.presenceState() as Record<string, Presence[]>)) {
      const pid = arr[0]?.playerId
      if (pid) ids.add(pid)
    }
    return ids
  }

  // хост = самый ранний присутствующий (стабильно к новым участникам)
  const recomputeHost = (): void => {
    const present = Object.values(channel.presenceState() as Record<string, Presence[]>)
      .map((a) => a[0])
      .filter(Boolean)
    present.sort((a, b) => a.joinedAt - b.joinedAt || (a.clientId < b.clientId ? -1 : 1))
    const becameHost = present[0]?.clientId === clientId && !amHost
    amHost = present[0]?.clientId === clientId
    if (becameHost) {
      // приняв авторитет, убираем игроков, чьих устройств уже нет, и рассылаем истину
      const presentIds = presentPlayerIds()
      for (const p of state.players) {
        if (!presentIds.has(p.id)) state = reduce(state, { type: 'leave', playerId: p.id })
      }
      notify()
      sendState()
    }
  }

  channel.on('presence', { event: 'sync' }, recomputeHost)

  // устройство отключилось — хост удаляет привязанного к нему игрока
  channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
    if (!amHost) return
    for (const lp of leftPresences as unknown as Presence[]) {
      if (lp.playerId) applyAsHost({ type: 'leave', playerId: lp.playerId })
    }
  })

  channel.on('broadcast', { event: 'action' }, ({ payload }) => {
    if (!amHost) return
    applyAsHost(payload as Action)
  })
  channel.on('broadcast', { event: 'state' }, ({ payload }) => {
    if (amHost) return
    state = payload as GameState
    notify()
  })
  channel.on('broadcast', { event: 'hello' }, () => {
    if (amHost) sendState()
  })

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      setConn('online')
      track()
      void channel.send({ type: 'broadcast', event: 'hello', payload: {} })
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // не глотаем: сообщаем UI о потере связи (supabase сам переподключает сокет)
      setConn('error')
    }
  })

  // троттл сетевых обновлений стрелки с гарантированной досылкой финальной позиции
  let lastSent = 0
  let pendingNeedle: Action | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flushNeedle = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    lastSent = performance.now()
    if (amHost) sendState()
    else if (pendingNeedle) sendAction(pendingNeedle)
    pendingNeedle = null
  }

  const dispatch = (action: Action): void => {
    state = reduce(state, action)
    notify()
    if (action.type === 'moveNeedle') {
      pendingNeedle = action
      const elapsed = performance.now() - lastSent
      if (elapsed >= NEEDLE_MS) flushNeedle()
      else if (!timer) timer = setTimeout(flushNeedle, NEEDLE_MS - elapsed)
      return
    }
    // прочее действие: сперва дослать отложенную стрелку (порядок на проводе), затем само действие
    if (pendingNeedle) flushNeedle()
    if (amHost) sendState()
    else sendAction(action)
  }

  return {
    dispatch,
    subscribe: (cb) => {
      subs.add(cb)
      cb(state)
      return () => void subs.delete(cb)
    },
    subscribeStatus: (cb) => {
      statusSubs.add(cb)
      cb(conn)
      return () => void statusSubs.delete(cb)
    },
    getState: () => state,
    setIdentity: (playerId) => {
      myPlayerId = playerId
      track()
    },
    dispose: () => {
      if (timer) clearTimeout(timer)
      subs.clear()
      statusSubs.clear()
      void supabase.removeChannel(channel)
    },
  }
}
