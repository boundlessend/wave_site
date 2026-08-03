// Supabase Realtime транспорт. авторитет (host) выбирается по presence.
// весь трафик (broadcast и presence) зашифрован ключом комнаты — см. crypto.ts.
// здесь живёт протокол поверх шифра: конверты, свежесть, дедуп, seq состояния,
// выборы хоста, учёт живости игроков и анти-флуд
import { RealtimeClient } from '@supabase/realtime-js'
import type { ConnStatus, Transport } from './transport.ts'
import { createCipher, type Sealed } from './crypto.ts'
import { createPresenceReader, earlier, type PresenceRecord } from './presence.ts'
import { isGameState } from './validate.ts'
import { reduce, initialState, type Action } from '../game/engine.ts'
import { targetCommit } from '../game/commit.ts'
import { clamp, TARGET_MAX, TARGET_MIN } from '../game/rules.ts'
import type { GameState } from '../game/types.ts'

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const supabaseConfigured = (): boolean =>
  typeof URL === 'string' && /supabase\.co/.test(URL) && typeof KEY === 'string' && KEY.length > 0

// версия протокола: при её смене меняется и HKDF-info (старые клиенты не расшифруют),
// а по открытому полю v на конверте клиент понимает, что пора обновить страницу
const PROTO = 2
const NEEDLE_MS = 50
const SKEW_MS = 60_000
const PRESENCE_TTL_MS = 5 * 60_000 // рекорд старше — считается replay
const PRESENCE_RETRACK_MS = 2 * 60_000 // периодическое обновление ts в presence
// presence в фоновых вкладках ненадёжен (браузер троттлит heartbeat, рекорд флапает),
// поэтому живость определяется двумя сигналами: presence ИЛИ ping по broadcast.
// игрок удаляется, только когда пропали оба (и после отсрочки на перепроверку)
const LEAVE_GRACE_MS = 15_000 // шаг перепроверки отсутствующего presence
const PING_MS = 25_000 // клиентский ping (фоновый троттлинг растянет до ~минуты)
const LIVENESS_MS = 90_000 // нет ни presence, ни ping дольше этого — игрок ушёл
// потерянный broadcast не ретранслируется сам: хост периодически рассылает state,
// а вернувшаяся из фона вкладка сразу просит его через hello
const STATE_REFRESH_MS = 45_000
const SWEEP_MS = SKEW_MS // уборка окон дедупа и счётчиков частоты
// анти-флуд в два уровня: общий бюджет бережёт CPU хоста от расшифровки мусора,
// бюджет на отправителя не даёт одному клиенту выесть лимит остальных
const RATE_GLOBAL_MAX = 240
const RATE_SENDER_MAX = 60
// действия, отложенные до подтверждения presence (см. fail-closed ниже)
const PENDING_MAX = 10

// конверт broadcast-сообщения (внутри шифртекста); n — seq только для state
type Envelope = { v: number; e: string; c: string; cid: string; t: number; n?: number; d: unknown }
type RateWindow = { start: number; count: number }

// ролевые действия: хост принимает их, только если presence отправителя
// объявляет его именно этим игроком
const ROLE_ACTIONS = new Set<Action['type']>([
  'commitTarget',
  'submitClue',
  'moveNeedle',
  'lockNeedle',
  'submitSide',
  'reveal',
  'setTeam',
  'kick',
])

export const createSupabaseTransport = (opts: { code: string; secret: string }): Transport => {
  if (!supabaseConfigured()) {
    throw new Error('Supabase не настроен: проверь VITE_SUPABASE_URL и VITE_SUPABASE_KEY')
  }
  // клиент на комнату, а не глобальный синглтон: dispose закрывает сокет
  const client = new RealtimeClient(`${URL as string}/realtime/v1`, {
    params: { apikey: KEY as string },
  })
  const cipher = createCipher({ code: opts.code, secret: opts.secret, proto: PROTO })

  const clientId = crypto.randomUUID()
  const joinedAt = Date.now()
  let myPlayerId: string | null = null
  let state: GameState = initialState
  let amHost = false
  let hostClientId: string | null = null
  const subs = new Set<(s: GameState) => void>()
  const statusSubs = new Set<(s: ConnStatus) => void>()
  let conn: ConnStatus = 'connecting'
  const notify = (): void => subs.forEach((cb) => cb(state))
  const setConn = (s: ConnStatus): void => {
    if (conn === 'outdated') return // «обнови страницу» не перебивается реконнектом
    conn = s
    statusSubs.forEach((cb) => cb(s))
  }

  // --- анти-флуд ---
  const globalWindow: RateWindow = { start: 0, count: 0 }
  const senderWindows = new Map<string, RateWindow>()
  const withinWindow = (w: RateWindow, now: number, max: number): boolean => {
    if (now - w.start > 1000) {
      w.start = now
      w.count = 0
    }
    w.count += 1
    return w.count <= max
  }
  const globalRateOk = (): boolean =>
    withinWindow(globalWindow, performance.now(), RATE_GLOBAL_MAX)
  const senderRateOk = (cid: string): boolean => {
    const now = performance.now()
    const w = senderWindows.get(cid) ?? { start: now, count: 0 }
    senderWindows.set(cid, w)
    return withinWindow(w, now, RATE_SENDER_MAX)
  }

  // --- конверты: свежесть + дедуп (replay-guard) по шифртексту ---
  const seen = new Map<string, number>()
  const openEnvelope = async (event: string, p: Partial<Sealed> | undefined): Promise<Envelope | null> => {
    const env = (await cipher.open(p)) as Envelope | null
    if (env === null) {
      if (typeof p?.v === 'number' && p.v > PROTO) setConn('outdated')
      return null
    }
    if (env.v !== PROTO || env.e !== event || env.c !== opts.code) return null
    if (typeof env.cid !== 'string' || env.cid.length === 0) return null
    if (typeof env.t !== 'number' || Math.abs(Date.now() - env.t) > SKEW_MS) return null
    const key = p?.ct as string
    if (seen.has(key)) return null
    seen.set(key, Date.now())
    if (!senderRateOk(env.cid)) return null
    return env
  }

  const channel = client.channel(`room-${opts.code}`, {
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
    void cipher.seal(env).then((p) => trySend(event, p, event === 'state'))
  }

  // seq состояния: монотонный, продолжается через смену хоста —
  // устаревший state (реордеринг/replay) не перекроет свежий
  let lastStateSeq = 0
  const sendState = (): void => {
    lastStateSeq += 1
    emit('state', state, lastStateSeq)
  }
  const applyAsHost = (action: Action): void => {
    state = reduce(state, action)
    notify()
    sendState()
  }

  // --- presence: расшифровка с привязкой к ключу presence и проверкой свежести ---
  // presence публикуется асинхронно, а хост принимает ролевые действия только от
  // объявленного игрока — поэтому свои действия ждут подтверждения track
  let trackedPlayerId: string | null = null
  let pending: Action[] = []
  const track = async (): Promise<void> => {
    const rec: PresenceRecord = { clientId, joinedAt, playerId: myPlayerId, ts: Date.now() }
    const res = await channel.track(await cipher.seal(rec))
    if (res !== 'ok') return
    trackedPlayerId = myPlayerId
    const queued = pending
    pending = []
    for (const action of queued) emit('action', action)
  }
  const presence = createPresenceReader({
    cipher,
    raw: () => channel.presenceState() as Record<string, unknown[]>,
    ttlMs: PRESENCE_TTL_MS,
  })

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
  const lastSeen = new Map<string, number>() // последнее верифицированное сообщение устройства игрока
  const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>()
  const scheduleLeave = (playerId: string): void => {
    // флап собственного presence (реконнект/фоновая вкладка) - не повод удалять себя
    if (playerId === myPlayerId) return
    if (pendingLeaves.has(playerId)) return
    if (!lastSeen.has(playerId)) lastSeen.set(playerId, Date.now())
    pendingLeaves.set(
      playerId,
      setTimeout(() => {
        pendingLeaves.delete(playerId)
        void presence.playerIds().then((ids) => {
          if (!amHost || ids.has(playerId)) return
          if (Date.now() - (lastSeen.get(playerId) ?? 0) > LIVENESS_MS) {
            console.warn('wave: удаляю игрока (нет ни presence, ни ping)', { playerId })
            lastSeen.delete(playerId)
            applyAsHost({ type: 'leave', playerId })
          } else {
            scheduleLeave(playerId) // presence нет, но устройство живо — перепроверим
          }
        })
      }, LEAVE_GRACE_MS),
    )
  }
  const cancelReturnedLeaves = async (): Promise<void> => {
    if (pendingLeaves.size === 0) return
    const ids = await presence.playerIds()
    for (const [pid, timer] of pendingLeaves) {
      if (ids.has(pid)) {
        clearTimeout(timer)
        pendingLeaves.delete(pid)
      }
    }
  }

  // хост = самый ранний присутствующий с валидным (расшифровавшимся) рекордом.
  // пересчёты выстроены в цепочку: параллельные sync иначе запишут amHost вразнобой
  const recomputeHost = async (): Promise<void> => {
    const { hostId, records } = await presence.host()
    hostClientId = hostId
    const becameHost = hostId === clientId && !amHost
    amHost = hostId === clientId
    if (becameHost) {
      console.warn('wave: стал хостом', { clientId, presences: records.length })
      // новый хост: игроков без presence удаляем с той же отсрочкой, не сразу
      const ids = new Set<string>()
      for (const r of records) if (r.playerId) ids.add(r.playerId)
      for (const p of state.players) if (!ids.has(p.id)) scheduleLeave(p.id)
      sendState()
    }
  }
  let hostChain: Promise<void> = Promise.resolve()
  const queueRecomputeHost = (): void => {
    hostChain = hostChain.then(recomputeHost).catch((e: unknown) => {
      console.warn('wave: пересчёт хоста не удался', { error: e })
    })
  }

  channel.on('presence', { event: 'sync' }, () => {
    queueRecomputeHost()
    void cancelReturnedLeaves()
  })

  channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
    if (!amHost) return
    void Promise.all(
      (leftPresences as unknown[]).map((lp) => cipher.open(lp as Partial<Sealed>)),
    ).then((recs) => {
      for (const rec of recs as (PresenceRecord | null)[]) {
        if (rec?.playerId) scheduleLeave(rec.playerId)
      }
    })
  })

  // раскрытие мишени принимается, только если сходится с опубликованным хешем.
  // клампим ДО сверки: иначе хеш считался бы от одного числа, а в стол легло другое
  const revealChecked = async (action: Extract<Action, { type: 'reveal' }>): Promise<void> => {
    const commit = state.round?.commit
    if (typeof commit !== 'string') return
    if (!Number.isFinite(action.target)) return
    const target = clamp(action.target, TARGET_MIN, TARGET_MAX)
    if ((await targetCommit(state.roundNo, target, action.nonce)) !== commit) return
    applyAsHost({ ...action, target })
  }

  channel.on('broadcast', { event: 'action' }, ({ payload }) => {
    if (!amHost || !globalRateOk()) return
    void (async () => {
      const env = await openEnvelope('action', payload as Sealed)
      if (!env) return
      const action = env.d as Action
      if (typeof action?.type !== 'string') return
      if (action.type === 'leave') return // host-internal, из сети не принимаем
      // роль актёра обязана принадлежать устройству-отправителю (по presence).
      // отсутствие presence — отказ: иначе не публикуя себя можно ходить за других
      if (ROLE_ACTIONS.has(action.type) && 'actorId' in action) {
        const boundPid = await presence.of(env.cid).then((r) => r?.playerId ?? null)
        if (boundPid === null || action.actorId !== boundPid) return
        lastSeen.set(boundPid, Date.now())
      }
      if (action.type === 'join') lastSeen.set(action.player.id, Date.now())
      if (action.type === 'reveal') {
        await revealChecked(action)
        return
      }
      applyAsHost(action)
    })()
  })

  channel.on('broadcast', { event: 'state' }, ({ payload }) => {
    if (!globalRateOk()) return
    void (async () => {
      const env = await openEnvelope('state', payload as Sealed)
      if (!env) return
      const sender = await presence.of(env.cid)
      if (!sender) return // состояние принимаем только от присутствующего клиента
      if (amHost) {
        // split-brain (presence разошёлся): уступаем более раннему клиенту,
        // иначе оба хоста игнорируют друг друга и столы расходятся навсегда
        if (!earlier(sender, { joinedAt, clientId })) return
        console.warn('wave: уступаю роль хоста', { to: sender.clientId })
        amHost = false
        hostClientId = sender.clientId
        lastStateSeq = 0 // свой счётчик обнуляем, иначе состояние победителя не пройдёт по seq
      } else if (env.cid !== hostClientId) {
        return // не-хост не вправе переписывать стол
      }
      if (typeof env.n !== 'number' || env.n <= lastStateSeq) return // устаревший state
      if (!isGameState(env.d)) {
        console.warn('wave: состояние неверной формы отброшено')
        return
      }
      lastStateSeq = env.n
      state = env.d
      notify()
    })()
  })

  channel.on('broadcast', { event: 'hello' }, ({ payload }) => {
    if (!amHost || !globalRateOk()) return
    void openEnvelope('hello', payload as Sealed).then((env) => env && scheduleHelloState())
  })
  // ping: живость устройства игрока независимо от presence
  channel.on('broadcast', { event: 'ping' }, ({ payload }) => {
    if (!amHost || !globalRateOk()) return
    void openEnvelope('ping', payload as Sealed).then(async (env) => {
      if (!env) return
      const boundPid = await presence.of(env.cid).then((r) => r?.playerId ?? null)
      if (boundPid !== null) lastSeen.set(boundPid, Date.now())
    })
  })

  let retrackTimer: ReturnType<typeof setInterval> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  // окна дедупа и частоты чистим по таймеру, а не на каждом сообщении:
  // проход по всей карте на входящее — это O(n) в самый неподходящий момент
  const sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [k, ts] of seen) if (now - ts > SKEW_MS) seen.delete(k)
    const mono = performance.now()
    for (const [cid, w] of senderWindows) if (mono - w.start > SWEEP_MS) senderWindows.delete(cid)
  }, SWEEP_MS)

  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') console.warn('wave: статус канала', { status })
    if (status === 'SUBSCRIBED') {
      setConn('online')
      void track()
      emit('hello', {})
      retrackTimer ??= setInterval(() => void track(), PRESENCE_RETRACK_MS)
      pingTimer ??= setInterval(() => {
        if (myPlayerId !== null) emit('ping', { playerId: myPlayerId })
      }, PING_MS)
      refreshTimer ??= setInterval(() => {
        if (amHost) sendState()
      }, STATE_REFRESH_MS)
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      setConn('error')
    }
  })

  // возврат вкладки из фона: presence и state могли устареть — обновляем сразу
  const onVisible = (): void => {
    if (document.hidden) return
    void track()
    if (!amHost) emit('hello', {})
  }
  document.addEventListener('visibilitychange', onVisible)

  // отправка действия не-хостом. ролевое ждёт, пока presence объявит игрока:
  // хост его иначе отбросит (fail-closed выше)
  const sendAction = (action: Action): void => {
    if (ROLE_ACTIONS.has(action.type) && trackedPlayerId !== myPlayerId) {
      if (pending.length < PENDING_MAX) pending.push(action)
      return
    }
    emit('action', action)
  }

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
    // хост сверяет commit и на своих действиях: телепат-хост иначе раскрыл бы
    // любую мишень в обход обязательства
    if (amHost && action.type === 'reveal') {
      void revealChecked(action)
      return
    }
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
      if (pingTimer) clearInterval(pingTimer)
      if (refreshTimer) clearInterval(refreshTimer)
      clearInterval(sweepTimer)
      document.removeEventListener('visibilitychange', onVisible)
      for (const t of pendingLeaves.values()) clearTimeout(t)
      pendingLeaves.clear()
      subs.clear()
      statusSubs.clear()
      void client.removeChannel(channel)
      client.disconnect()
    },
  }
}
