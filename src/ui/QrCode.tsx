import { useEffect, useState } from 'react'

// QR-код ссылки-приглашения: открыть комнату с телефона, не пересылая ссылку.
// кодер грузится лениво — он нужен ровно на одном экране
export const QrCode = ({ text, size = 168 }: { text: string; size?: number }) => {
  const [path, setPath] = useState<{ d: string; cells: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('qrcode-generator').then(({ default: qrcode }) => {
      if (cancelled) return
      const qr = qrcode(0, 'M') // версия по размеру данных, средняя коррекция
      qr.addData(text)
      qr.make()
      const cells = qr.getModuleCount()
      let d = ''
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
        }
      }
      setPath({ d, cells })
    })
    return () => {
      cancelled = true
    }
  }, [text])

  if (path === null) return <div className="qr-box" style={{ width: size, height: size }} />
  return (
    <svg
      className="qr-box"
      width={size}
      height={size}
      viewBox={`-1 -1 ${path.cells + 2} ${path.cells + 2}`}
      role="img"
      aria-label="QR-код ссылки-приглашения"
    >
      <rect x={-1} y={-1} width={path.cells + 2} height={path.cells + 2} fill="#fffdf8" />
      <path d={path.d} fill="#16140f" />
    </svg>
  )
}
