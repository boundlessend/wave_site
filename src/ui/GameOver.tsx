import { useEffect } from 'react'
import { History } from './History.tsx'
import { TEAM_NAME } from './shared.ts'
import type { Room } from '../useRoom.ts'

// оценка кооператива: колода 7 карт, максимум 3 очка за карту (плюс бонусные
// карты за центр), так что потолок партии около 21. шкала наша, не из правил
const coopVerdict = (score: number): string => {
  if (score >= 17) return 'Полная синхронизация'
  if (score >= 12) return 'Хорошая связь'
  if (score >= 7) return 'Настраиваетесь'
  return 'Разные волны'
}

export const GameOver = ({ room }: { room: Room }) => {
  const { state, actions } = room

  // празднование: салют из конфетти (ленивый импорт — не в основном бандле)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let stop = false
    void import('canvas-confetti').then(({ default: confetti }) => {
      if (stop) return
      const colors = ['#c8341f', '#2b4a8f', '#16140f', '#e8b53a']
      const end = Date.now() + 900
      const tick = (): void => {
        if (stop) return
        confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors })
        confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors })
        if (Date.now() < end) requestAnimationFrame(tick)
      }
      confetti({ particleCount: 130, spread: 100, origin: { y: 0.5 }, colors })
      tick()
    })
    return () => {
      stop = true
    }
  }, [])

  const coop = state.mode === 'coop'
  const title = coop
    ? coopVerdict(state.scores.left)
    : state.winner
      ? `Победа: ${TEAM_NAME[state.winner]}!`
      : 'Игра окончена'

  return (
    <div className="panel">
      <h1>{title}</h1>
      {coop && <p className="muted">Итог партии: {state.scores.left} очков</p>}
      <History state={state} />
      <button className="btn wide" style={{ marginTop: 16 }} onClick={actions.reset}>
        Сыграть ещё
      </button>
    </div>
  )
}
