// Supabase Realtime транспорт. авторитет (host) выбирается по presence.
// безопасность: все broadcast-сообщения и presence подписаны HMAC секретом комнаты.
// секрет приходит из ссылки-приглашения (hash) и НЕ передаётся по сети —
// чужой, знающий лишь код комнаты, не сможет подделать состояние/действия/host.
import { createClient } from '@supabase/supabase-js'
import type { ConnStatus, Transport } from './transport.ts'
import { reduce, initialState, type Action } from '../game/engine.ts'
import type { GameState } from '../game/types.ts'

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const supabaseConfigured = (): boolean =>
  typeof URL === 'string' && /supabase\.co/.test(URL) && typeof KEY === 'string' && KEY.length > 0

const supabase = supabaseConfigured() ? createClient(URL as string, KEY as string) : null

type Presence = { clientId: string; joinedAt: number; playerId: string | null; auth: string }

const NEEDLE_MS = 50

export const createSupabaseTransport = (opts: { code: string; secret: string }): Transport => {
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

  // --- HMAC-подпись секретом комнаты ---
  const enc = new TextEncoder()
  let keyPromise: Promise<CryptoKey> | null = null
  const getKey = (): Promise<CryptoKey> =>
    (keyPromise ??= crypto.subtle.importKey(
      'raw',
      enc.encode(opts.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    ))
  const hmac = async (bytes: Uint8Array): Promise<string> => {
    const buf = await crypto.subtle.sign('HMAC', await getKey(), new Uint8Array(bytes))
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
  }
  const verifyHmac = async (bytes: Uint8Array, sigB64: string): Promise<boolean> => {
    try {
      const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0))
      return await crypto.subtle.verify('HMAC', await getKey(), new Uint8Array(sig), new Uint8Array(bytes))
    } catch {
      return false
    }
  }
  const signData = (data: unknown): Promise<string> => hmac(enc.encode(JSON.stringify(data)))
  const verifyData = async (msg: { d?: unknown; s?: unknown }): Promise<boolean> =>
    typeof msg?.s === 'string' && verifyHmac(enc.encode(JSON.stringify(msg.d)), msg.s)

  const channel = supabase.channel(`room-${opts.code}`, {
    config: { broadcast: { self: false }, presence: { key: clientId } },
  })

  // presence с подписью clientId — чужой без секрета не попадёт в выбор host
  const track = async (): Promise<void> => {
    const auth = await hmac(enc.encode(clientId))
    void channel.track({ clientId, joinedAt, playerId: myPlayerId, auth } satisfies Presence)
  }
  const emit = (event: string, data: unknown): void => {
    void signData(data).then((s) => channel.send({ type: 'broadcast', event, payload: { d: data, s } }))
  }
  const sendState = (): void => emit('state', state)
  const sendAction = (action: Action): void => emit('action', action)
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
  const verifyAuth = (p: Presence): Promise<boolean> =>
    typeof p?.auth === 'string' && typeof p?.clientId === 'string'
      ? verifyHmac(enc.encode(p.clientId), p.auth)
      : Promise.resolve(false)

  // хост = самый ранний присутствующий С ВАЛИДНОЙ подписью (чужой не захватит/не застопорит)
  const recomputeHost = async (): Promise<void> => {
    const raw = Object.values(channel.presenceState() as Record<string, Presence[]>)
      .map((a) => a[0])
      .filter(Boolean)
    const valid: Presence[] = []
    for (const p of raw) if (await verifyAuth(p)) valid.push(p)
    valid.sort((a, b) => a.joinedAt - b.joinedAt || (a.clientId < b.clientId ? -1 : 1))
    const becameHost = valid[0]?.clientId === clientId && !amHost
    amHost = valid[0]?.clientId === clientId
    if (becameHost) {
      const ids = presentPlayerIds()
      for (const p of state.players) {
        if (!ids.has(p.id)) state = reduce(state, { type: 'leave', playerId: p.id })
      }
      notify()
      sendState()
    }
  }

  channel.on('presence', { event: 'sync' }, () => void recomputeHost())

  // отключение устройства: хост удаляет привязанного игрока (presence от Supabase, не подделать)
  channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
    if (!amHost) return
    for (const lp of leftPresences as unknown as Presence[]) {
      if (lp.playerId) applyAsHost({ type: 'leave', playerId: lp.playerId })
    }
  })

  channel.on('broadcast', { event: 'action' }, ({ payload }) => {
    if (!amHost) return
    void verifyData(payload).then((ok) => {
      if (!ok) return
      const action = (payload as { d: Action }).d
      if (action.type === 'leave') return // host-internal, из сети не принимаем
      applyAsHost(action)
    })
  })
  channel.on('broadcast', { event: 'state' }, ({ payload }) => {
    if (amHost) return
    void verifyData(payload).then((ok) => {
      if (!ok) return
      state = (payload as { d: GameState }).d
      notify()
    })
  })
  channel.on('broadcast', { event: 'hello' }, ({ payload }) => {
    if (!amHost) return
    void verifyData(payload).then((ok) => ok && sendState())
  })

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      setConn('online')
      void track()
      emit('hello', {})
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      setConn('error')
    }
  })

  // троттл сетевых обновлений стрелки с досылкой финальной позиции
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
      void track()
    },
    dispose: () => {
      if (timer) clearTimeout(timer)
      subs.clear()
      statusSubs.clear()
      void supabase.removeChannel(channel)
    },
  }
}
