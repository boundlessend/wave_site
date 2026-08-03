import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import './game.css'
import { Lobby } from './Lobby.tsx'
import { Table } from './Table.tsx'
import { GameOver } from './GameOver.tsx'
import type { Room } from '../useRoom.ts'

// панель смены перспективы (только для локальной отладки)
const DevBar = ({ room }: { room: Room }) => {
  const { state, me, setMeId } = room
  if (state.players.length === 0) return null
  return (
    <div className="devbar">
      <span>вид как:</span>
      {state.players.map((p) => (
        <button
          key={p.id}
          className={`chip ${me?.id === p.id ? 'on' : ''}`}
          onClick={() => setMeId(p.id)}
        >
          {p.name}
        </button>
      ))}
    </div>
  )
}

export const Game = ({
  room,
  devPerspective,
  roomCode = null,
  onExit = null,
}: {
  room: Room
  devPerspective: boolean
  roomCode?: string | null
  onExit?: (() => void) | null
}) => {
  const { state, conn } = room
  const [muted, setMuted] = useState(() => localStorage.getItem('wave_muted') === '1')
  const toggleMute = (): void => {
    setMuted((m) => {
      const next = !m
      localStorage.setItem('wave_muted', next ? '1' : '0')
      return next
    })
  }
  const screen =
    state.phase === 'lobby' ? 'lobby' : state.phase === 'gameover' ? 'over' : 'table'
  return (
    <main>
      {conn !== 'online' && (
        <div className={`conn ${conn}`} role="status">
          {conn === 'connecting' ? (
            'Подключение…'
          ) : conn === 'outdated' ? (
            <>
              Вышла новая версия игры{' '}
              <button className="chip" onClick={() => window.location.reload()}>
                Обновить страницу
              </button>
            </>
          ) : (
            'Связь потеряна - переподключаемся…'
          )}
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -14 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          {screen === 'lobby' && (
            <Lobby room={room} dev={devPerspective} roomCode={roomCode} onExit={onExit} />
          )}
          {screen === 'over' && <GameOver room={room} />}
          {screen === 'table' && <Table room={room} muted={muted} />}
        </motion.div>
      </AnimatePresence>
      {import.meta.env.DEV && devPerspective && <DevBar room={room} />}
      <div className="footer">
        <button className="chip" onClick={toggleMute}>
          {muted ? 'Звук выкл' : 'Звук вкл'}
        </button>
      </div>
    </main>
  )
}
