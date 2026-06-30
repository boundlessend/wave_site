import { useEffect, useRef, useState } from 'react'
import type { BgVariant } from './Scene3D.tsx'

export type BgChoice = BgVariant | 'off'

const OPTIONS: { key: BgChoice; label: string }[] = [
  { key: 'ridge', label: 'Ридж-волны' },
  { key: 'dots', label: 'Полутон' },
  { key: 'shapes', label: 'Фигуры' },
  { key: 'wire', label: 'Каркас' },
  { key: 'contours', label: 'Рябь' },
  { key: 'off', label: 'Без фона' },
]

// полузаметный переключатель фоновой 3D-сцены в углу экрана
export const BgPicker = ({ value, onChange }: { value: BgChoice; onChange: (v: BgChoice) => void }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])

  return (
    <div className="bgpick" ref={ref}>
      {open && (
        <div className="bgpick-menu">
          <div className="bgpick-title">Фон</div>
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`bgpick-item ${value === o.key ? 'on' : ''}`}
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <button
        className="bgpick-btn"
        aria-label="Выбрать фон"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M3 8 q3 -3 6 0 t6 0 t6 0" />
          <path d="M3 13 q3 -3 6 0 t6 0 t6 0" />
          <path d="M3 18 q3 -3 6 0 t6 0 t6 0" />
        </svg>
      </button>
    </div>
  )
}
