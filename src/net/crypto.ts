// шифрование трафика комнаты: AES-GCM на ключе, выведенном (HKDF) из секрета
// из ссылки-приглашения. секрет по сети не ходит, поэтому знающий лишь код
// комнаты не прочитает трафик и не подделает сообщение. GCM даёт целостность
// и конфиденциальность; свежесть/дедуп/seq живут уровнем выше
import { b64, unb64 } from '../lib/base64.ts'

// то, что реально летит по сети
export type Sealed = { v: number; iv: string; ct: string }

export type Cipher = {
  readonly seal: (data: unknown) => Promise<Sealed>
  // null = не расшифровалось (чужой ключ, другая версия протокола, мусор)
  readonly open: (payload: Partial<Sealed> | undefined) => Promise<unknown>
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export const createCipher = (params: {
  code: string
  secret: string
  proto: number
}): Cipher => {
  let keyPromise: Promise<CryptoKey> | null = null
  const getKey = (): Promise<CryptoKey> =>
    (keyPromise ??= crypto.subtle
      .importKey('raw', enc.encode(params.secret), 'HKDF', false, ['deriveKey'])
      .then((raw) =>
        crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: enc.encode(`wave:${params.code}`),
            info: enc.encode(`proto${params.proto}`),
          },
          raw,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      ))

  return {
    seal: async (data) => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const buf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        await getKey(),
        new Uint8Array(enc.encode(JSON.stringify(data))),
      )
      return { v: params.proto, iv: b64(iv), ct: b64(new Uint8Array(buf)) }
    },
    open: async (payload) => {
      if (!payload || typeof payload.iv !== 'string' || typeof payload.ct !== 'string') return null
      try {
        const buf = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(unb64(payload.iv)) },
          await getKey(),
          new Uint8Array(unb64(payload.ct)),
        )
        return JSON.parse(dec.decode(buf)) as unknown
      } catch {
        return null
      }
    },
  }
}
