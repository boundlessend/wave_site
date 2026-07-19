// Supabase Realtime транспорт. авторитет (host) выбирается по presence.
// безопасность (протокол v2): все broadcast-сообщения и presence зашифрованы
// AES-GCM ключом, выведенным (HKDF) из секрета комнаты. секрет приходит из
// ссылки-приглашения (hash) и НЕ передаётся по сети — чужой, знающий лишь код
// комнаты, не прочитает трафик и не подделает состояние/действия/host.
// GCM даёт целостность и конфиденциальность; свежесть/дедуп/seq — поверх.
import { RealtimeClient } from '@supabase/realtime-js'
import type { ConnStatus, Transport } from './transport.ts'
import { reduce, initialState, type Action } from '../game/engine.ts'
import { targetCommit } from '../game/commit.ts'
import type { GameState } from '../game/types.ts'

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const supabaseConfigured = (): boolean =>
  typeof URL === 'string' && /supabase\.co/.test(URL) && typeof KEY === 'string' && KEY.length > 0

// только Realtime (broadcast + presence) — без auth/postgrest/storage из полного supabase-js
const supabase = supabaseConfigured()
  ? new RealtimeClient(`${URL as string}/realtime/v1`, { params: { apikey: KEY as string } })
  : null

// версия протокола: при её смене меняется и HKDF-info (старые клиенты не расшифруют),
// а по открытому полю v на конверте клиент понимает, что пора обновить страницу
const PROTO = 2
const NEEDLE_MS = 50
const SKEW_MS = 60_000
const PRESENCE_TTL_MS = 5 * 60_000 // рекорд старше — считается replay
const PRESENCE_RETRACK_MS = 2 * 60_000 // периодическое обновление ts в presence
const LEAVE_GRACE_MS = 10_000 // отсрочка удаления игрока: перезагрузка успевает вернуться

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b))
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// конверт broadcast-сообщения (внутри шифртекста); n — seq только для state
type Envelope = { v: number; e: string; c: string; cid: string; t: number; n?: number; d: unknown }
// то, что реально летит по сети
type Sealed = { v: number; iv: string; ct: string }
// presence-рекорд (внутри шифртекста); ts + TTL отсекают replay старых рекордов
type PresenceRecord = { clientId: string; joinedAt: number; playerId: string | null; ts: number }

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
    if (conn === 'outdated') return // «обнови страницу» не перебивается реконнектом
    conn = s
    statusSubs.forEach((cb) => cb(s))
  }

  // --- AES-GCM ключ из секрета комнаты (HKDF) ---
  let keyPromise: Promise<CryptoKey> | null = null
  const getKey = (): Promise<CryptoKey> =>
    (keyPromise ??= crypto.subtle
      .importKey('raw', enc.encode(opts.secret), 'HKDF', false, ['deriveKey'])
      .then((raw) =>
        crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: enc.encode(`wave:${opts.code}`),
            info: enc.encode(`proto${PROTO}`),
          },
          raw,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      ))
  const seal = async (data: unknown): Promise<Sealed> => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const buf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await getKey(),
      new Uint8Array(enc.encode(JSON.stringify(data))),
    )
    return { v: PROTO, iv: b64(iv), ct: b64(new Uint8Array(buf)) }
  }
  // null = не расшифровалось (чужой ключ, другая версия протокола, мусор)
  const open = async (p: Partial<Sealed> | undefined): Promise<unknown> => {
    if (!p || typeof p.iv !== 'string' || typeof p.ct !== 'string') return null
    try {
      const buf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(unb64(p.iv)) },
        await getKey(),
        new Uint8Array(unb64(p.ct)),
      )
      return JSON.parse(dec.decode(buf)) as unknown
    } catch {
      return null
    }
  }

  // свежесть + дедуп (replay-guard) по шифртексту
  const seen = new Map<string, number>()
  const openEnvelope = async (event: string, p: Partial<Sealed> | undefined): Promise<Envelope | null> => {
    const env = (await open(p)) as Envelope | null
    if (env === null) {
      if (typeof p?.v === 'number' && p.v > PROTO) setConn('outdated')
      return null
    }
    if (env.v !== PROTO || env.e !== event || env.c !== opts.code) return null
    if (typeof env.t !== 'number' || Math.abs(Date.now() - env.t) > SKEW_MS) return null
    const key = p?.ct as string
    if (seen.has(key)) return null
    const now = Date.now()
    seen.set(key, now)
    for (const [k, ts] of seen) if (now - ts > SKEW_MS) seen.delete(k)
    return env
  }

  const channel = supabase.channel(`room-${opts.code}`, {
    config: { broadcast: { self: false }, presence: { key: clientId } },
  })

  // недоставленные сообщения не глотаем: warning всегда, state ретраим один раз
  // (state идемпотентен — last-write-wins по seq)
  const trySend = (event: string, payload: Sealed, retry: boolean): void => {
    void channel.send({ type: 'broadcast', event, payload }).then((res) => {
      if (res === 'ok') return
      console.warn('wave: broadcast не доставлен', { event, res, willRetry: retry })
      if (retry) setTimeout(() => trySend(event, payload, false), 400)
    })
  }
  const emit = (event: string, data: unknown, n?: number): void => {
    const env: Envelope = {
      v: PROTO,
      e: event,
      c: opts.code,
      cid: clientId,
      t: Date.now(),
      ...(n === undefined ? {} : { n }),
      d: data,
    }
    void seal(env).then((p) => trySend(event, p, event === 'state'))
  }

  // seq состояния: монотонный, продолжается через смену хоста —
  // устаревший state (реордеринг/replay) не перекроет свежий
  let lastStateSeq = 0
  const sendState = (): void => {
    lastStateSeq += 1
    emit('state', state, lastStateSeq)
  }
  const sendAction = (action: Action): void => emit('action', action)
  const applyAsHost = (action: Action): void => {
    state = reduce(state, action)
    notify()
    sendState()
  }

  // --- presence: расшифровка с привязкой к ключу presence и проверкой свежести ---
  const track = async (): Promise<void> => {
    const rec: PresenceRecord = { clientId, joinedAt, playerId: myPlayerId, ts: Date.now() }
    void channel.track(await seal(rec))
  }
  const openPresence = async (key: string, p: unknown): Promise<PresenceRecord | null> => {
    const rec = (await open(p as Partial<Sealed>)) as PresenceRecord | null
    if (!rec || rec.clientId !== key) return null
    if (typeof rec.ts !== 'number' || Math.abs(Date.now() - rec.ts) > PRESENCE_TTL_MS) return null
    return rec
  }
  const presences = async (): Promise<PresenceRecord[]> => {
    const raw = channel.presenceState() as Record<string, unknown[]>
    const out: PresenceRecord[] = []
    for (const [key, arr] of Object.entries(raw)) {
      const rec = await openPresence(key, arr[0])
      if (rec) out.push(rec)
    }
    return out
  }
  const presentPlayerIds = async (): Promise<Set<string>> => {
    const ids = new Set<string>()
    for (const rec of await presences()) if (rec.playerId) ids.add(rec.playerId)
    return ids
  }
  // playerId, привязанный к валидной presence отправителя (по его clientId)
  const playerIdForClient = async (cid: string): Promise<string | null> => {
    const rec = await openPresence(cid, (channel.presenceState() as Record<string, unknown[]>)[cid]?.[0])
    return rec?.playerId ?? null
  }

  const roleActions = new Set<Action['type']>([
    'commitTarget',
    'submitClue',
    'moveNeedle',
    'lockNeedle',
    'submitSide',
    'reveal',
    'setTeam',
    'kick',
  ])

  // грубый лимит входящих сообщений (анти-флуд/CPU-DoS у хоста)
  const RATE_MAX = 80
  let winStart = 0
  let winCount = 0
  const rateOk = (): boolean => {
    const now = performance.now()
    if (now - winStart > 1000) {
      winStart = now
      winCount = 0
    }
    winCount += 1
    return winCount <= RATE_MAX
  }

  // ответ на hello коалесцируем — иначе флуд hello усиливается в рассылку полного state
  let helloTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleHelloState = (): void => {
    if (helloTimer) return
    helloTimer = setTimeout(() => {
      helloTimer = null
      if (amHost) sendState()
    }, 250)
  }

  // отключение устройства: игрок удаляется с отсрочкой — перезагрузившаяся
  // вкладка успевает вернуться и сохранить место (восстановление в useRoom)
  const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>()
  const scheduleLeave = (playerId: string): void => {
    if (pendingLeaves.has(playerId)) return
    pendingLeaves.set(
      playerId,
      setTimeout(() => {
        pendingLeaves.delete(playerId)
        void presentPlayerIds().then((ids) => {
          if (amHost && !ids.has(playerId)) applyAsHost({ type: 'leave', playerId })
        })
      }, LEAVE_GRACE_MS),
    )
  }
  const cancelReturnedLeaves = async (): Promise<void> => {
    if (pendingLeaves.size === 0) return
    const ids = await presentPlayerIds()
    for (const [pid, timer] of pendingLeaves) {
      if (ids.has(pid)) {
        clearTimeout(timer)
        pendingLeaves.delete(pid)
      }
    }
  }

  // хост = самый ранний присутствующий с валидным (расшифровавшимся) рекордом
  const recomputeHost = async (): Promise<void> => {
    const valid = await presences()
    valid.sort((a, b) => a.joinedAt - b.joinedAt || (a.clientId < b.clientId ? -1 : 1))
    const becameHost = valid[0]?.clientId === clientId && !amHost
    amHost = valid[0]?.clientId === clientId
    if (becameHost) {
      // новый хост: игроков без presence удаляем с той же отсрочкой, не сразу
      const ids = new Set<string>()
      for (const r of valid) if (r.playerId) ids.add(r.playerId)
      for (const p of state.players) if (!ids.has(p.id)) scheduleLeave(p.id)
      sendState()
    }
  }

  channel.on('presence', { event: 'sync' }, () => {
    void recomputeHost()
    void cancelReturnedLeaves()
  })

  channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
    if (!amHost) return
    void (async () => {
      for (const lp of leftPresences as unknown[]) {
        const rec = (await open(lp as Partial<Sealed>)) as PresenceRecord | null
        if (rec?.playerId) scheduleLeave(rec.playerId)
      }
    })()
  })

  channel.on('broadcast', { event: 'action' }, ({ payload }) => {
    if (!amHost || !rateOk()) return
    void (async () => {
      const env = await openEnvelope('action', payload as Sealed)
      if (!env) return
      const action = env.d as Action
      if (action.type === 'leave') return // host-internal, из сети не принимаем
      // роль актёра должна принадлежать устройству-отправителю (по presence)
      if (roleActions.has(action.type) && 'actorId' in action) {
        const boundPid = await playerIdForClient(env.cid)
        if (boundPid !== null && action.actorId !== boundPid) return
      }
      // commit-reveal: раскрытая мишень обязана совпасть с зафиксированным хешем
      if (action.type === 'reveal') {
        const commit = state.round?.commit
        if (typeof commit !== 'string') return
        if ((await targetCommit(state.roundNo, action.target, action.nonce)) !== commit) return
      }
      applyAsHost(action)
    })()
  })
  channel.on('broadcast', { event: 'state' }, ({ payload }) => {
    if (amHost || !rateOk()) return
    void openEnvelope('state', payload as Sealed).then((env) => {
      if (!env) return
      if (typeof env.n !== 'number' || env.n <= lastStateSeq) return // устаревший state
      lastStateSeq = env.n
      state = env.d as GameState
      notify()
    })
  })
  channel.on('broadcast', { event: 'hello' }, ({ payload }) => {
    if (!amHost || !rateOk()) return
    void openEnvelope('hello', payload as Sealed).then((env) => env && scheduleHelloState())
  })

  let retrackTimer: ReturnType<typeof setInterval> | null = null
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      setConn('online')
      void track()
      emit('hello', {})
      retrackTimer ??= setInterval(() => void track(), PRESENCE_RETRACK_MS)
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
      if (helloTimer) clearTimeout(helloTimer)
      if (retrackTimer) clearInterval(retrackTimer)
      for (const t of pendingLeaves.values()) clearTimeout(t)
      pendingLeaves.clear()
      subs.clear()
      statusSubs.clear()
      void supabase.removeChannel(channel)
    },
  }
}
