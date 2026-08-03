// presence комнаты: кто сейчас на связи и кто из них хост.
// рекорды зашифрованы тем же ключом, что и сообщения, поэтому «присутствующий» —
// это тот, чей рекорд расшифровался, лёг на свой ключ presence и не протух
import type { Cipher, Sealed } from './crypto.ts'

export type PresenceRecord = {
  clientId: string
  joinedAt: number
  playerId: string | null
  ts: number
}

// кандидат в хосты: кто раньше вошёл, при равенстве — по clientId
export type HostRef = { joinedAt: number; clientId: string }

export const earlier = (a: HostRef, b: HostRef): boolean =>
  a.joinedAt !== b.joinedAt ? a.joinedAt < b.joinedAt : a.clientId < b.clientId

export type PresenceReader = {
  readonly open: (key: string, payload: unknown) => Promise<PresenceRecord | null>
  readonly all: () => Promise<PresenceRecord[]>
  readonly of: (clientId: string) => Promise<PresenceRecord | null>
  readonly playerIds: () => Promise<Set<string>>
  // хост = самый ранний присутствующий; null, если presence ещё пуста
  readonly host: () => Promise<{ hostId: string | null; records: PresenceRecord[] }>
}

export const createPresenceReader = (params: {
  cipher: Cipher
  // сырое состояние presence канала: ключ клиента → его рекорды
  raw: () => Record<string, unknown[]>
  ttlMs: number
}): PresenceReader => {
  const open = async (key: string, payload: unknown): Promise<PresenceRecord | null> => {
    const rec = (await params.cipher.open(payload as Partial<Sealed>)) as PresenceRecord | null
    if (!rec || rec.clientId !== key) return null
    if (typeof rec.ts !== 'number' || Math.abs(Date.now() - rec.ts) > params.ttlMs) return null
    return rec
  }
  const all = async (): Promise<PresenceRecord[]> => {
    const opened = await Promise.all(
      Object.entries(params.raw()).map(([key, arr]) => open(key, arr[0])),
    )
    return opened.filter((r): r is PresenceRecord => r !== null)
  }
  const of = (clientId: string): Promise<PresenceRecord | null> =>
    open(clientId, params.raw()[clientId]?.[0])
  return {
    open,
    all,
    of,
    playerIds: async () => {
      const ids = new Set<string>()
      for (const rec of await all()) if (rec.playerId) ids.add(rec.playerId)
      return ids
    },
    host: async () => {
      const records = await all()
      records.sort((a, b) => (earlier(a, b) ? -1 : 1))
      return { hostId: records[0]?.clientId ?? null, records }
    },
  }
}
