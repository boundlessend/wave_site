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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    // при открытии переносим фокус на выбранный пункт (клавиатура)
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (k: BgChoice): void => {
    onChange(k)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="bgpick" ref={ref}>
      {open && (
        <div className="bgpick-menu" id="bgpick-menu" role="menu" aria-label="Фон" ref={menuRef}>
          <div className="bgpick-title">Фон</div>
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitemradio"
              aria-checked={value === o.key}
              className={`bgpick-item ${value === o.key ? 'on' : ''}`}
              onClick={() => choose(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <button
        ref={triggerRef}
        className="bgpick-btn"
        type="button"
        aria-label="Выбрать фон"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="bgpick-menu"
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
