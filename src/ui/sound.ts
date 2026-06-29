// минимальные звуки через WebAudio, без файлов
let ctx: AudioContext | null = null

const tone = (freq: number, durMs: number, delayS: number): void => {
  if (typeof AudioContext === 'undefined') return
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  osc.connect(gain)
  gain.connect(ctx.destination)
  const t = ctx.currentTime + delayS
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000)
  osc.start(t)
  osc.stop(t + durMs / 1000 + 0.02)
}

// короткий сигнал «твой ход»
export const playYourTurn = (): void => {
  tone(660, 120, 0)
  tone(880, 150, 0.1)
}

// аккорд на раскрытии мишени
export const playReveal = (): void => {
  tone(523, 150, 0)
  tone(659, 150, 0.12)
  tone(784, 220, 0.24)
}
