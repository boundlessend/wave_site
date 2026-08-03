import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { clamp, ZONE } from '../game/rules.ts'

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

type DialProps = {
  needlePos: number
  target: number | null
  interactive: boolean
  onChange: ((p: number) => void) | null
}

export const Dial = ({ needlePos, target, interactive, onChange }: DialProps) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const posMV = useMotionValue(needlePos)
  const spring = useSpring(posMV, { stiffness: 280, damping: 30 })
  useEffect(() => {
    posMV.set(needlePos)
  }, [needlePos, posMV])
  const nx = useTransform(spring, (p) => pointAt(p, R - 12).x)
  const ny = useTransform(spring, (p) => pointAt(p, R - 12).y)

  // указатель шлёт события чаще, чем экран рисует кадры: коалесцируем до одного
  // на кадр, иначе каждое движение мыши перерисовывает всё дерево комнаты
  const queued = useRef<number | null>(null)
  const raf = useRef(0)
  const emitPos = (p: number): void => {
    queued.current = p
    if (raf.current !== 0) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const next = queued.current
      queued.current = null
      if (next !== null) onChange?.(next)
    })
  }
  useEffect(
    () => () => {
      if (raf.current !== 0) cancelAnimationFrame(raf.current)
    },
    [],
  )

  const posFromEvent = (clientX: number, clientY: number): number => {
    const svg = svgRef.current
    if (!svg) return needlePos
    const rect = svg.getBoundingClientRect()
    const sx = ((clientX - rect.left) / rect.width) * W
    const sy = ((clientY - rect.top) / rect.height) * H
    const theta = Math.atan2(CY - sy, sx - CX)
    return clamp((1 - clamp(theta, 0, Math.PI) / Math.PI) * 100, 0, 100)
  }

  const handleDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!interactive || !onChange) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    emitPos(posFromEvent(e.clientX, e.clientY))
  }
  const handleMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!dragging.current || !onChange) return
    emitPos(posFromEvent(e.clientX, e.clientY))
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
          { lo: target - ZONE.two, hi: target - ZONE.three, color: 'var(--zone-far)' },
          { lo: target - ZONE.three, hi: target - ZONE.four, color: 'var(--zone-near)' },
          { lo: target - ZONE.four, hi: target + ZONE.four, color: 'var(--accent)' },
          { lo: target + ZONE.four, hi: target + ZONE.three, color: 'var(--zone-near)' },
          { lo: target + ZONE.three, hi: target + ZONE.two, color: 'var(--zone-far)' },
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
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(needlePos)}
      aria-valuetext={`${Math.round(needlePos)} из 100`}
      aria-disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onKeyDown={handleKey}
    >
      <path
        d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY} Z`}
        fill="var(--dial-face)"
        stroke="var(--border)"
        strokeWidth={2}
      />
      {/* зоны раскрываются от центра циферблата; MotionConfig гасит анимацию
          при prefers-reduced-motion, отдельная проверка не нужна */}
      <g style={{ transformBox: 'view-box', transformOrigin: `${CX}px ${CY}px` }}>
        {bands.map((b, i) => (
          <motion.path
            key={`${b.lo}-${b.hi}`}
            d={wedge(b.lo, b.hi, R)}
            fill={b.color}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14, delay: i * 0.05 }}
            style={{ transformBox: 'view-box', transformOrigin: `${CX}px ${CY}px` }}
          />
        ))}
      </g>
      <motion.line
        x1={CX}
        y1={CY}
        x2={nx}
        y2={ny}
        stroke="var(--needle)"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r={15} fill="var(--needle)" stroke="var(--paper)" strokeWidth={3} />
      <circle cx={CX} cy={CY} r={6} fill="var(--accent)" />
    </svg>
  )
}
