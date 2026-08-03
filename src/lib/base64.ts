// base64/base64url: единственная реализация на проект (крипто-конверты,
// nonce commit-reveal, секрет комнаты). без spread: он упирается в лимит
// аргументов на длинных шифртекстах

export const b64 = (bytes: Uint8Array): string => {
  let s = ''
  for (const byte of bytes) s += String.fromCharCode(byte)
  return btoa(s)
}

export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// случайная строка из n байт в base64url (без padding)
export const randomB64url = (bytes: number): string =>
  b64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
