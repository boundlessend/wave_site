import { bandPoints } from '../game/rules.ts'
import type { GameState } from '../game/types.ts'
import { TEAM_MARK, nameOf } from './shared.ts'

// таблица сыгранных раундов партии: подсказка, кто был телепатом,
// насколько промахнулись и сколько за это дали
export const History = ({ state }: { state: GameState }) => {
  if (state.history.length === 0) return <p className="muted">Раунды ещё не сыграны.</p>
  const coop = state.mode === 'coop'
  return (
    <div className="history-scroll">
      <table className="history">
        <thead>
          <tr>
            <th>№</th>
            <th>Карточка</th>
            <th>Подсказка</th>
            <th>Телепат</th>
            <th>Промах</th>
            <th>Очки</th>
          </tr>
        </thead>
        <tbody>
          {state.history.map((h) => {
            const miss = Math.abs(h.target - h.needlePos)
            const pts = bandPoints(h.target, h.needlePos)
            return (
              <tr key={h.roundNo}>
                <td>{h.roundNo}</td>
                <td className="muted wrap">
                  {h.card[0]} / {h.card[1]}
                </td>
                <td className="wrap">«{h.clue}»</td>
                <td>{nameOf(state, h.psychicId)}</td>
                <td className={pts === 0 ? 'miss' : ''}>{miss.toFixed(1)}</td>
                <td>
                  {coop
                    ? `+${h.gained.left}`
                    : `${TEAM_MARK.left} +${h.gained.left} · ${TEAM_MARK.right} +${h.gained.right}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
