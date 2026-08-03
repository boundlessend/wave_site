import { useEffect, useRef } from 'react'
import { animate, motion, useAnimate, useMotionValue, useTransform } from 'motion/react'
import type { GameState, TeamId } from '../game/types.ts'
import { TEAM_MARK, TEAM_NAME } from './shared.ts'

// плавный счётчик очков: значение пишется прямо в DOM через motion value,
// поэтому кадры анимации не превращаются в ререндеры React
const AnimatedNumber = ({ value }: { value: number }) => {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => String(Math.round(v)))
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.5, ease: 'easeOut' })
    return () => controls.stop()
  }, [value, mv])
  return <motion.span>{text}</motion.span>
}

// очко команды: пульс при росте
const ScoreBox = ({ value, team, active }: { value: number; team: TeamId; active: boolean }) => {
  const [scope, run] = useAnimate()
  const prev = useRef(value)
  useEffect(() => {
    if (value > prev.current) {
      void run(scope.current, { scale: [1, 1.12, 1] }, { duration: 0.4, ease: 'easeOut' })
    }
    prev.current = value
  }, [value, run, scope])
  return (
    <div
      ref={scope}
      className={`score ${team} ${active ? 'active' : ''}`}
      style={{ color: `var(--${team})` }}
    >
      <b>
        <AnimatedNumber value={value} />
      </b>
      <span className="muted">
        {TEAM_MARK[team]} {TEAM_NAME[team]}
      </span>
    </div>
  )
}

export const Scores = ({ state }: { state: GameState }) => {
  if (state.mode === 'coop') {
    return (
      <div className="scores">
        <div className="score">
          <b>
            <AnimatedNumber value={state.scores.left} />
          </b>
          очков
        </div>
        <div className="score">
          <b>
            <AnimatedNumber value={state.cardsRemaining} />
          </b>
          карт осталось
        </div>
      </div>
    )
  }
  const active = state.round?.activeTeam
  return (
    <div className="scores">
      {(['left', 'right'] as TeamId[]).map((team) => (
        <ScoreBox key={team} value={state.scores[team]} team={team} active={active === team} />
      ))}
    </div>
  )
}
