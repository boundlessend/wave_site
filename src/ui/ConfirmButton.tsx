import { useEffect, useState } from 'react'

const ARMED_MS = 4000

// кнопка с подтверждением на месте: первый клик взводит, второй выполняет.
// нужна там, где промах ломает игру остальным (кик, пропуск раунда, выход в лобби)
export const ConfirmButton = ({
  label,
  confirm,
  className,
  ariaLabel,
  title,
  onConfirm,
}: {
  label: string
  confirm: string
  className: string
  ariaLabel?: string
  title?: string
  onConfirm: () => void
}) => {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), ARMED_MS)
    return () => clearTimeout(t)
  }, [armed])

  if (!armed) {
    return (
      <button className={className} aria-label={ariaLabel} title={title} onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="confirm">
      <button
        className={className}
        aria-label={ariaLabel === undefined ? undefined : `${confirm}: ${ariaLabel}`}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        {confirm}
      </button>
      <button className="chip ghost-mini" onClick={() => setArmed(false)}>
        Отмена
      </button>
    </span>
  )
}
