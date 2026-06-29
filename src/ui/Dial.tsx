import { useEffect, useLayoutEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { ZONE } from '../game/rules.ts'

// геометрия viewBox
const W = 400
const H = 216
const CX = 200
const CY = 200
const R = 184

const angleOf = (p: number): number => Math.PI * (1 - p / 100)

const pointAt = (p: number, r: number): { x: number; y: number } => {
  const t = angleOf(p)
  return { x: CX + r * Math.cos(t), y: CY - r * Math.sin(t) }
}

const wedge = (pLo: number, pHi: number, r: number): string => {
  const a = pointAt(pLo, r)
  const b = pointAt(pHi, r)
  return `M ${CX} ${CY} L ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n))

type DialProps = {
  needlePos: number
  target: number | null
  interactive: boolean
  onChange: ((p: number) => void) | null
}

export const Dial = ({ needlePos, target, interactive, onChange }: DialProps) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const bandsRef = useRef<SVGGElement>(null)
  const dragging = useRef(false)
  const prevTarget = useRef<number | null>(target)

  const posMV = useMotionValue(needlePos)
  const spring = useSpring(posMV, { stiffness: 280, damping: 30 })
  useEffect(() => {
    posMV.set(needlePos)
  }, [needlePos, posMV])
  const nx = useTransform(spring, (p) => pointAt(p, R - 12).x)
  const ny = useTransform(spring, (p) => pointAt(p, R - 12).y)

  // GSAP-хореография раскрытия зоны (ленивый импорт — gsap не в основном бандле)
  useLayoutEffect(() => {
    const appeared = prevTarget.current === null && target !== null
    prevTarget.current = target
    const g = bandsRef.current
    if (!appeared || !g) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    g.style.opacity = '0' // прячем до загрузки gsap, чтобы не было вспышки
    let cancelled = false
    // подстраховка: если чанк не загрузится — всё равно показать зону
    const safety = setTimeout(() => g && (g.style.opacity = '1'), 800)
    void import('gsap').then(({ default: gsap }) => {
      clearTimeout(safety)
      if (cancelled || !bandsRef.current) return
      bandsRef.current.style.opacity = '1'
      gsap.fromTo(
        bandsRef.current.children,
        { scale: 0, opacity: 0, svgOrigin: `${CX} ${CY}` },
        { scale: 1, opacity: 1, duration: 0.55, stagger: 0.05, ease: 'back.out(1.7)' },
      )
    })
    return () => {
      cancelled = true
      clearTimeout(safety)
    }
  }, [target])

  const posFromEvent = (clientX: number, clientY: number): number => {
    const svg = svgRef.current
    if (!svg) return needlePos
    const rect = svg.getBoundingClientRect()
    const sx = ((clientX - rect.left) / rect.width) * W
    const sy = ((clientY - rect.top) / rect.height) * H
    const theta = Math.atan2(CY - sy, sx - CX)
    const clamped = clamp(theta, 0, Math.PI)
    return clamp((1 - clamped / Math.PI) * 100, 0, 100)
  }

  const handleDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!interactive || !onChange) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onChange(posFromEvent(e.clientX, e.clientY))
  }
  const handleMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!dragging.current || !onChange) return
    onChange(posFromEvent(e.clientX, e.clientY))
  }
  const handleUp = (): void => {
    dragging.current = false
  }
  // управление с клавиатуры
  const handleKey = (e: React.KeyboardEvent<SVGSVGElement>): void => {
    if (!interactive || !onChange) return
    const step = e.shiftKey ? 5 : 1
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(clamp(needlePos - step, 0, 100))
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(clamp(needlePos + step, 0, 100))
    else if (e.key === 'Home') onChange(0)
    else if (e.key === 'End') onChange(100)
    else return
    e.preventDefault()
  }

  const bands =
    target === null
      ? []
      : [
          { lo: target - ZONE.two, hi: target - ZONE.three, color: '#ffcf5c' },
          { lo: target - ZONE.three, hi: target - ZONE.four, color: '#ff974a' },
          { lo: target - ZONE.four, hi: target + ZONE.four, color: '#ff5747' },
          { lo: target + ZONE.four, hi: target + ZONE.three, color: '#ff974a' },
          { lo: target + ZONE.three, hi: target + ZONE.two, color: '#ffcf5c' },
        ]

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: '100%',
        height: 'auto',
        touchAction: 'none',
        userSelect: 'none',
        outlineOffset: 4,
      }}
      role="slider"
      aria-label="Положение стрелки на шкале"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(needlePos)}
      tabIndex={interactive ? 0 : -1}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onKeyDown={handleKey}
    >
      <defs>
        <radialGradient id="dialface" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopColor="#222a4d" />
          <stop offset="100%" stopColor="#141937" />
        </radialGradient>
      </defs>
      <path
        d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY} Z`}
        fill="url(#dialface)"
        stroke="rgba(120,140,220,0.18)"
        strokeWidth={1}
      />
      <g ref={bandsRef} style={{ filter: 'drop-shadow(0 0 10px rgba(255,90,70,0.45))' }}>
        {bands.map((b, i) => (
          <path key={i} d={wedge(b.lo, b.hi, R)} fill={b.color} />
        ))}
      </g>
      <motion.line
        x1={CX}
        y1={CY}
        x2={nx}
        y2={ny}
        stroke="#eef1ff"
        strokeWidth={5}
        strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 6px rgba(238,241,255,0.6))' }}
      />
      <circle cx={CX} cy={CY} r={15} fill="#ff5747" stroke="#141937" strokeWidth={3} />
      <circle cx={CX} cy={CY} r={6} fill="#fff" opacity={0.9} />
    </svg>
  )
}
