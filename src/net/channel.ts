// транспорт «несколько вкладок одного браузера» поверх BroadcastChannel.
// сервера и шифрования нет (канал не покидает устройство), но модель авторитета
// та же, что в сети: host — самый ранний присутствующий, остальные шлют действия
// и принимают состояние. нужен там, где Supabase не настроен, и в e2e — чтобы
// многоклиентная логика (выборы хоста, роли, восстановление) проверялась без сети
import type { ConnStatus, Transport } from './transport.ts'
import { reduce, initialState, type Action } from '../game/engine.ts'
import type { GameState } from '../game/types.ts'

const ANNOUNCE_MS = 700
const PEER_TTL_MS = 2500
// перезагрузка вкладки выглядит как уход: игрока удаляем с отсрочкой, чтобы
// вернувшаяся вкладка успела занять своё место (в сетевом транспорте то же самое)
const LEAVE_GRACE_MS = 3000

type Peer = { joinedAt: number; playerId: string | null; seen: number }

type Msg =
  | { t: 'hi'; cid: string; joinedAt: number; playerId: string | null }
  | { t: 'bye'; cid: string }
  | { t: 'state'; cid: string; n: number; d: GameState }
  | { t: 'action'; cid: string; d: Action }
  | { t: 'ask'; cid: string }

export const createChannelTransport = (opts: { code: string }): Transport => {
  const bc = new BroadcastChannel(`wave-${opts.code}`)
  const clientId = crypto.randomUUID()
  const joinedAt = Date.now()
  let myPlayerId: string | null = null
  let state: GameState = initialState
  let seq = 0
  let amHost = true // до первого чужого объявления вкладка одна
  const peers = new Map<string, Peer>()
  const subs = new Set<(s: GameState) => void>()
  const notify = (): void => subs.forEach((cb) => cb(state))

  const post = (m: Msg): void => bc.postMessage(m)
  const announce = (): void => post({ t: 'hi', cid: clientId, joinedAt, playerId: myPlayerId })
  const sendState = (): void => {
    seq += 1
    post({ t: 'state', cid: clientId, n: seq, d: state })
  }

  // хост = самый ранний живой участник (при равенстве — по clientId)
  const recomputeHost = (): void => {
    const now = Date.now()
    let bestAt = joinedAt
    let bestId: string = clientId
    for (const [cid, p] of peers) {
      if (now - p.seen > PEER_TTL_MS) {
        peers.delete(cid)
        continue
      }
      if (p.joinedAt < bestAt || (p.joinedAt === bestAt && cid < bestId)) {
        bestAt = p.joinedAt
        bestId = cid
      }
    }
    const became = bestId === clientId && !amHost
    const lost = bestId !== clientId && amHost
    amHost = bestId === clientId
    if (became) sendState()
    if (lost) {
      // счётчик обнуляем, иначе собственный seq не даст принять стол хоста
      seq = 0
      post({ t: 'ask', cid: clientId })
    }
  }

  // вкладка закрылась: её игрок покидает партию, но не сразу (аналог presence leave)
  const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>()
  const alivePlayerIds = (): Set<string> => {
    const ids = new Set<string>()
    if (myPlayerId !== null) ids.add(myPlayerId)
    for (const p of peers.values()) if (p.playerId) ids.add(p.playerId)
    return ids
  }
  const scheduleLeave = (playerId: string): void => {
    if (pendingLeaves.has(playerId)) return
    pendingLeaves.set(
      playerId,
      setTimeout(() => {
        pendingLeaves.delete(playerId)
        if (!amHost || alivePlayerIds().has(playerId)) return // вкладка вернулась
        state = reduce(state, { type: 'leave', playerId })
        notify()
        sendState()
      }, LEAVE_GRACE_MS),
    )
  }
  const dropPeer = (cid: string): void => {
    const peer = peers.get(cid)
    peers.delete(cid)
    recomputeHost()
    if (peer?.playerId) scheduleLeave(peer.playerId)
  }

  bc.onmessage = (e: MessageEvent<Msg>): void => {
    const m = e.data
    if (m.cid === clientId) return
    if (m.t === 'hi') {
      peers.set(m.cid, { joinedAt: m.joinedAt, playerId: m.playerId, seen: Date.now() })
      recomputeHost()
      if (amHost) sendState()
      return
    }
    if (m.t === 'bye') return dropPeer(m.cid)
    if (m.t === 'ask') {
      if (amHost) sendState()
      return
    }
    if (m.t === 'action') {
      if (!amHost) return
      if (m.d.type === 'leave') return // host-internal
      state = reduce(state, m.d)
      notify()
      sendState()
      return
    }
    if (amHost || m.n <= seq) return
    seq = m.n
    state = m.d
    notify()
  }

  const timer = setInterval(() => {
    announce()
    recomputeHost()
  }, ANNOUNCE_MS)
  announce()
  post({ t: 'ask', cid: clientId })

  const onUnload = (): void => post({ t: 'bye', cid: clientId })
  window.addEventListener('pagehide', onUnload)

  return {
    dispatch: (action) => {
      state = reduce(state, action)
      notify()
      if (amHost) sendState()
      else post({ t: 'action', cid: clientId, d: action })
    },
    subscribe: (cb) => {
      subs.add(cb)
      cb(state)
      return () => void subs.delete(cb)
    },
    subscribeStatus: (cb) => {
      cb('online' as ConnStatus) // локальный канал всегда доступен
      return () => {}
    },
    getState: () => state,
    setIdentity: (playerId) => {
      myPlayerId = playerId
      announce()
    },
    dispose: () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', onUnload)
      for (const t of pendingLeaves.values()) clearTimeout(t)
      pendingLeaves.clear()
      post({ t: 'bye', cid: clientId })
      subs.clear()
      bc.close()
    },
  }
}
