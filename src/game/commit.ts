// commit-reveal мишени: телепат публикует хеш (мишень+nonce) до подсказки,
// при раскрытии хост сверяет — телепат не может «выбрать» мишень после просмотра стрелки
const enc = new TextEncoder()

export const genNonce = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const targetCommit = async (roundNo: number, target: number, nonce: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${roundNo}:${target}:${nonce}`))
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
