import { lazy, Suspense, useEffect, useState } from 'react'
import { createLocalTransport, type Transport } from './net/transport.ts'
import { createSupabaseTransport, supabaseConfigured } from './net/supabase.ts'
import { createChannelTransport } from './net/channel.ts'
import { useRoom } from './useRoom.ts'
import { Game } from './ui/Game.tsx'
import { BgPicker, type BgChoice } from './ui/BgPicker.tsx'
import { isDarkNow, loadTheme, saveTheme, type Theme } from './ui/theme.ts'
import { randomB64url } from './lib/base64.ts'

// 3D-фон тяжёлый (three.js) - грузим лениво и только после того, как
// разобрались с игрой: до этого видна бумажная подложка body
const Scene3D = lazy(() => import('./ui/Scene3D.tsx').then((m) => ({ default: m.Scene3D })))

const BG_CHOICES: BgChoice[] = ['ridge', 'dots', 'shapes', 'wire', 'contours', 'off']
const initialBg = (): BgChoice => {
  const v = localStorage.getItem('wave_bg')
  return v !== null && (BG_CHOICES as string[]).includes(v) ? (v as BgChoice) : 'ridge'
}

type RoomRef = { code: string; secret: string }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
// код комнаты (не секрет, а имя канала): CSPRNG; смещение по модулю пренебрежимо
const genCode = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('')

// извлечь код (query) и секрет (hash) из URL-строки
const parseInvite = (input: string): RoomRef | null => {
  try {
    const u = new URL(input.trim(), window.location.origin)
    const code = u.searchParams.get('room')?.toUpperCase()
    if (!code) return null
    const secret = new URLSearchParams(u.hash.replace(/^#/, '')).get('k')
    if (!secret) return null // ссылка без секрета → другой ключ, тихий рассинхрон
    return { code, secret }
  } catch {
    return null
  }
}

const setUrl = (r: RoomRef): void =>
  window.history.replaceState(null, '', `?room=${r.code}#k=${r.secret}`)

// транспорт комнаты: сеть, если Supabase настроен, иначе общий канал браузера
// (несколько вкладок одного устройства — так же гоняются многоклиентные e2e)
const createRoomTransport = (r: RoomRef): Transport =>
  supabaseConfigured() ? createSupabaseTransport(r) : createChannelTransport({ code: r.code })

// локальный режим: одна вкладка, для разработки без Supabase
function LocalRoom() {
  const [transport] = useState(createLocalTransport)
  const room = useRoom(transport, null)
  return <Game room={room} devPerspective={true} />
}

// комната, подключённая к готовому транспорту (useRoom вызывается безусловно)
function ConnectedRoom({
  transport,
  code,
  onExit,
}: {
  transport: Transport
  code: string
  onExit: () => void
}) {
  const room = useRoom(transport, `wave_me_${code}`)
  return <Game room={room} devPerspective={false} roomCode={code} onExit={onExit} />
}

// онлайн-комната: транспорт создаём в эффекте (устойчиво к StrictMode).
// код и секрет приходят отдельными пропсами — по объекту эффект пересоздавался бы
// на каждый рендер родителя
function OnlineRoom({ code, secret, onExit }: RoomRef & { onExit: () => void }) {
  const [transport, setTransport] = useState<Transport | null>(null)
  useEffect(() => {
    const t = createRoomTransport({ code, secret })
    setTransport(t)
    return () => t.dispose()
  }, [code, secret])
  if (!transport) return <div className="panel">Подключение…</div>
  return <ConnectedRoom transport={transport} code={code} onExit={onExit} />
}

// экран входа: создать комнату или войти по ссылке-приглашению
function RoomEntry({ onEnter }: { onEnter: (r: RoomRef) => void }) {
  const [link, setLink] = useState('')
  const parsed = parseInvite(link)
  return (
    <div className="panel">
      <h1>Длина волны</h1>
      <button
        className="btn wide"
        style={{ marginBottom: 16 }}
        onClick={() => {
          // секрет комнаты: 16 случайных байт, живут только в hash ссылки
          const r: RoomRef = { code: genCode(), secret: randomB64url(16) }
          setUrl(r)
          onEnter(r)
        }}
      >
        Создать комнату
      </button>
      <div className="row">
        <input
          className="field"
          placeholder="Ссылка-приглашение"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && parsed && (setUrl(parsed), onEnter(parsed))}
        />
        <button
          className="btn wide ghost"
          disabled={parsed === null}
          onClick={() => parsed && (setUrl(parsed), onEnter(parsed))}
        >
          Войти по ссылке
        </button>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
        Чтобы присоединиться, открой ссылку-приглашение от друга или вставь её сюда.
      </p>
    </div>
  )
}

function Online() {
  const [room, setRoom] = useState<RoomRef | null>(() => parseInvite(window.location.href))
  const exit = (): void => {
    window.history.replaceState(null, '', window.location.pathname)
    setRoom(null)
  }
  if (room === null) return <RoomEntry onEnter={setRoom} />
  return <OnlineRoom code={room.code} secret={room.secret} onExit={exit} />
}

// комната по ссылке работает и без Supabase (через канал браузера),
// а без ссылки и без Supabase остаётся однвкладочный режим разработки
const roomInUrl = (): boolean => parseInvite(window.location.href) !== null

export default function App() {
  const [bg, setBg] = useState<BgChoice>(initialBg)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [bgReady, setBgReady] = useState(false)
  const changeBg = (v: BgChoice): void => {
    setBg(v)
    localStorage.setItem('wave_bg', v)
  }
  const changeTheme = (v: Theme): void => {
    setTheme(v)
    saveTheme(v)
  }

  // 3D-чанк весит больше всего остального приложения: пусть игра отрисуется первой
  useEffect(() => {
    const idle = window.requestIdleCallback
    if (typeof idle === 'function') {
      const id = idle(() => setBgReady(true), { timeout: 2000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = setTimeout(() => setBgReady(true), 400)
    return () => clearTimeout(t)
  }, [])

  return (
    <>
      {bg !== 'off' && bgReady && (
        <Suspense fallback={null}>
          <Scene3D variant={bg} dark={isDarkNow(theme)} />
        </Suspense>
      )}
      <BgPicker value={bg} onChange={changeBg} theme={theme} onThemeChange={changeTheme} />
      {supabaseConfigured() || roomInUrl() ? <Online /> : <LocalRoom />}
    </>
  )
}
