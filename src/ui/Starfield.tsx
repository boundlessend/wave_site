import { useEffect, useRef } from 'react'

type Star = { x: number; y: number; r: number; tw: number; ph: number; vy: number }

// лёгкое звёздное небо на canvas: медленный дрейф + мерцание
export const Starfield = () => {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let stars: Star[] = []
    let raf = 0
    let w = 0
    let h = 0

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round((w * h) / 9000)
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.4 + 0.3,
        tw: Math.random() * 0.6 + 0.4,
        ph: Math.random() * Math.PI * 2,
        vy: Math.random() * 0.12 + 0.02,
      }))
    }

    const draw = (t: number): void => {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        const twinkle = reduced ? 1 : 0.5 + 0.5 * Math.sin(t * 0.001 * s.tw + s.ph)
        ctx.globalAlpha = 0.35 + 0.65 * twinkle
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = s.r > 1.1 ? '#bcd2ff' : '#ffffff'
        ctx.fill()
        if (!reduced) {
          s.y += s.vy
          if (s.y > h + 2) {
            s.y = -2
            s.x = Math.random() * w
          }
        }
      }
      ctx.globalAlpha = 1
      if (!reduced) raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    if (reduced) draw(0)
    else raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
    />
  )
}
