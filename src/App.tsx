import { useEffect, useState } from 'react'
import { createLocalTransport, type Transport } from './net/transport.ts'
import { createSupabaseTransport, supabaseConfigured } from './net/supabase.ts'
import { useRoom } from './useRoom.ts'
import { Game } from './ui/Game.tsx'

type RoomRef = { code: string; secret: string }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const genCode = (): string =>
  Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

// секрет комнаты: 16 случайных байт в base64url, живёт только в hash ссылки
const genSecret = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// извлечь код (query) и секрет (hash) из URL-строки
const parseInvite = (input: string): RoomRef | null => {
  try {
    const u = new URL(input.trim(), window.location.origin)
    const code = u.searchParams.get('room')?.toUpperCase()
    if (!code) return null
    const secret = new URLSearchParams(u.hash.replace(/^#/, '')).get('k') ?? ''
    return { code, secret }
  } catch {
    return null
  }
}

const setUrl = (r: RoomRef): void =>
  window.history.replaceState(null, '', `?room=${r.code}#k=${r.secret}`)

// локальный режим: одна вкладка, для разработки без Supabase
function LocalRoom() {
  const [transport] = useState(createLocalTransport)
  const room = useRoom(transport)
  return <Game room={room} devPerspective={true} />
}

// комната, подключённая к готовому транспорту (useRoom вызывается безусловно)
function ConnectedRoom({ transport, code }: { transport: Transport; code: string }) {
  const room = useRoom(transport)
  return <Game room={room} devPerspective={false} roomCode={code} />
}

// онлайн-комната: транспорт создаём в эффекте (устойчиво к StrictMode)
function OnlineRoom({ room }: { room: RoomRef }) {
  const [transport, setTransport] = useState<Transport | null>(null)
  useEffect(() => {
    const t = createSupabaseTransport({ code: room.code, secret: room.secret })
    setTransport(t)
    return () => t.dispose()
  }, [room.code, room.secret])
  if (!transport) return <div className="panel">Подключение…</div>
  return <ConnectedRoom transport={transport} code={room.code} />
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
          const r: RoomRef = { code: genCode(), secret: genSecret() }
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
  if (room === null) return <RoomEntry onEnter={setRoom} />
  return <OnlineRoom room={room} />
}

export default function App() {
  return supabaseConfigured() ? <Online /> : <LocalRoom />
}
