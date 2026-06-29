import { useEffect, useMemo, useState } from 'react'
import { createLocalTransport, type Transport } from './net/transport.ts'
import { createSupabaseTransport, supabaseConfigured } from './net/supabase.ts'
import { useRoom } from './useRoom.ts'
import { Game } from './ui/Game.tsx'
import { Starfield } from './ui/Starfield.tsx'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const genCode = (): string =>
  Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

// локальный режим: одна вкладка, для разработки без Supabase
function LocalRoom() {
  const transport = useMemo(() => createLocalTransport(), [])
  const room = useRoom(transport)
  return <Game room={room} devPerspective={true} />
}

// комната, подключённая к готовому транспорту (useRoom вызывается безусловно)
function ConnectedRoom({ transport, code }: { transport: Transport; code: string }) {
  const room = useRoom(transport)
  return <Game room={room} devPerspective={false} roomCode={code} />
}

// онлайн-комната: транспорт создаём в эффекте (корректный жизненный цикл,
// устойчиво к двойному монтированию StrictMode)
function OnlineRoom({ code }: { code: string }) {
  const [transport, setTransport] = useState<Transport | null>(null)
  useEffect(() => {
    const t = createSupabaseTransport({ code })
    setTransport(t)
    return () => t.dispose()
  }, [code])
  if (!transport) return <div className="panel">Подключение…</div>
  return <ConnectedRoom transport={transport} code={code} />
}

// экран входа: создать комнату или войти по коду
function RoomEntry({ onEnter }: { onEnter: (code: string) => void }) {
  const [code, setCode] = useState('')
  return (
    <div className="panel">
      <h1>Длина волны</h1>
      <button
        className="btn wide"
        style={{ marginBottom: 16 }}
        onClick={() => {
          const c = genCode()
          window.history.replaceState(null, '', `?room=${c}`)
          onEnter(c)
        }}
      >
        Создать комнату
      </button>
      <div className="row">
        <input
          className="field"
          placeholder="Код комнаты"
          value={code}
          maxLength={4}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button
          className="btn wide ghost"
          disabled={code.length !== 4}
          onClick={() => onEnter(code)}
        >
          Войти по коду
        </button>
      </div>
    </div>
  )
}

function Online() {
  const [code, setCode] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? null,
  )
  if (code === null) return <RoomEntry onEnter={setCode} />
  return <OnlineRoom code={code} />
}

export default function App() {
  return (
    <>
      <Starfield />
      {supabaseConfigured() ? <Online /> : <LocalRoom />}
    </>
  )
}
