// commit-reveal мишени: телепат публикует хеш (мишень+nonce) до подсказки,
// при раскрытии хост сверяет — телепат не может «выбрать» мишень после просмотра стрелки
import { b64, randomB64url } from '../lib/base64.ts'

const enc = new TextEncoder()

export const genNonce = (): string => randomB64url(16)

export const targetCommit = async (roundNo: number, target: number, nonce: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${roundNo}:${target}:${nonce}`))
  return b64(new Uint8Array(buf))
}
