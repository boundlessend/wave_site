import { useRef } from 'react'
import { ZONE } from '../game/rules.ts'

// геометрия viewBox
const W = 400
const H = 216
const CX = 200
const CY = 200
const R = 184

// позиция p (0..100) → угол θ в радианах (p=0 слева=π, p=100 справа=0)
const angleOf = (p: number): number => Math.PI * (1 - p / 100)

const pointAt = (p: number, r: number): { x: number; y: number } => {
  const t = angleOf(p)
  return { x: CX + r * Math.cos(t), y: CY - r * Math.sin(t) }
}

// сектор-клин от центра до обода между позициями pLo..pHi
const wedge = (pLo: number, pHi: number, r: number): string => {
  const a = pointAt(pLo, r)
  const b = pointAt(pHi, r)
  // sweep-flag 1: по часовой (слева направо над верхом)
  return `M ${CX} ${CY} L ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n))

type DialProps = {
  needlePos: number
  target: number | null // мишень рисуется только когда задана
  interactive: boolean
  onChange: ((p: number) => void) | null
}

export const Dial = ({ needlePos, target, interactive, onChange }: DialProps) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const posFromEvent = (clientX: number, clientY: number): number => {
    const svg = svgRef.current
    if (!svg) return needlePos
    const rect = svg.getBoundingClientRect()
    const sx = ((clientX - rect.left) / rect.width) * W
    const sy = ((clientY - rect.top) / rect.height) * H
    const theta = Math.atan2(CY - sy, sx - CX) // y вниз → инвертируем
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

  const needle = pointAt(needlePos, R - 10)

  // полосы мишени от центра наружу: 2-3-4-3-2
  const bands =
    target === null
      ? []
      : [
          { lo: target - ZONE.two, hi: target - ZONE.three, color: '#f6c945' },
          { lo: target - ZONE.three, hi: target - ZONE.four, color: '#f08a24' },
          { lo: target - ZONE.four, hi: target + ZONE.four, color: '#e23b2e' },
          { lo: target + ZONE.four, hi: target + ZONE.three, color: '#f08a24' },
          { lo: target + ZONE.three, hi: target + ZONE.two, color: '#f6c945' },
        ]

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      {/* фон-полукруг */}
      <path
        d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY} Z`}
        fill="#1f2540"
      />
      {/* зона мишени */}
      {bands.map((b, i) => (
        <path key={i} d={wedge(b.lo, b.hi, R)} fill={b.color} />
      ))}
      {/* стрелка */}
      <line
        x1={CX}
        y1={CY}
        x2={needle.x}
        y2={needle.y}
        stroke="#e8ecff"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r={14} fill="#e23b2e" stroke="#1f2540" strokeWidth={3} />
    </svg>
  )
}
