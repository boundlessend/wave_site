import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Dial } from './Dial.tsx'
import { History } from './History.tsx'
import { Scores } from './Scores.tsx'
import { TEAM_NAME, nameOf } from './shared.ts'
import { ConfirmButton } from './ConfirmButton.tsx'
import { playReveal, playYourTurn } from './sound.ts'
import type { Room } from '../useRoom.ts'
import { bandPoints, coopPoints, sideOfTarget } from '../game/rules.ts'
import type { TeamId } from '../game/types.ts'

// ——— панель действий по фазе ———
const PhasePanel = ({ room }: { room: Room }) => {
  const { state, me, actions } = room
  const round = state.round
  const [clue, setClue] = useState('')
  if (!round || !me) return null

  const isPsychic = me.id === round.psychicId
  const onActiveTeam = me.team === round.activeTeam
  const onSecondTeam = state.mode === 'versus' && me.team !== round.activeTeam

  switch (state.phase) {
    case 'psychic':
      return isPsychic ? (
        <div className="panel">
          <p className="tag">Ты телепат — мишень видна только тебе</p>
          <p className="muted">
            Дай подсказку: что-то одно, без чисел и однокоренных слов с карточки.
          </p>
          <div className="row">
            <input
              className="field"
              placeholder="Подсказка"
              value={clue}
              maxLength={60}
              onChange={(e) => setClue(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && clue.trim().length > 0 && actions.submitClue(clue.trim())
              }
            />
            <button
              className="btn wide"
              disabled={clue.trim().length === 0}
              onClick={() => actions.submitClue(clue.trim())}
            >
              Дать подсказку
            </button>
          </div>
        </div>
      ) : (
        <p className="panel muted">
          Телепат {nameOf(state, round.psychicId)} придумывает подсказку…
        </p>
      )

    case 'team':
      return (
        <div className="panel">
          <p className="clue">«{round.clue}»</p>
          {onActiveTeam ? (
            <>
              <p className="muted">Двигайте стрелку к центру цветной зоны.</p>
              <button className="btn wide" onClick={actions.lockNeedle}>
                Стрелка установлена
              </button>
            </>
          ) : (
            <p className="muted">{TEAM_NAME[round.activeTeam]} двигает стрелку…</p>
          )}
        </div>
      )

    case 'leftright':
      return (
        <div className="panel">
          <p className="clue">«{round.clue}»</p>
          {onSecondTeam ? (
            <>
              <p className="muted">С какой стороны от стрелки центр цветной зоны?</p>
              <div className="row">
                <button
                  className="btn ghost"
                  style={{ flex: 1 }}
                  onClick={() => actions.submitSide('LEFT')}
                >
                  ← Левее
                </button>
                <button
                  className="btn ghost"
                  style={{ flex: 1 }}
                  onClick={() => actions.submitSide('RIGHT')}
                >
                  Правее →
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Соперники выбирают сторону…</p>
          )}
        </div>
      )

    case 'await_reveal':
      return (
        <div className="panel">
          {isPsychic ? (
            <button className="btn wide" onClick={actions.reveal}>
              Открыть экран
            </button>
          ) : (
            <p className="muted">Телепат открывает экран…</p>
          )}
        </div>
      )

    case 'reveal':
      return <RevealPanel room={room} />

    default:
      return null
  }
}

const RevealPanel = ({ room }: { room: Room }) => {
  const { state, actions } = room
  const round = state.round
  if (!round || round.target === null) return null
  const target = round.target
  const pts = bandPoints(target, round.needlePos)
  const verdict = pts === 4 ? 'В самый центр!' : pts > 0 ? 'Попадание в зону' : 'Мимо зоны'

  return (
    <div className="panel">
      <p className="clue">{verdict}</p>
      {state.mode === 'coop' ? (
        <p style={{ textAlign: 'center' }}>
          <b style={{ fontSize: 22 }}>+{coopPoints(target, round.needlePos)}</b> очк. · осталось
          карт: {state.cardsRemaining}
        </p>
      ) : (
        <div className="scores" style={{ marginBottom: 12 }}>
          {(['left', 'right'] as TeamId[]).map((team) => {
            const gain =
              team === round.activeTeam
                ? pts
                : pts !== 4 && round.leftRightGuess === sideOfTarget(target, round.needlePos)
                  ? 1
                  : 0
            return (
              <div key={team} className={`score ${team}`} style={{ color: `var(--${team})` }}>
                <b>+{gain}</b>
                <span className="muted">{TEAM_NAME[team]}</span>
              </div>
            )
          })}
        </div>
      )}
      <button className="btn wide" onClick={actions.nextRound}>
        Следующий раунд
      </button>
    </div>
  )
}

// ——— игровой стол ———
export const Table = ({ room, muted }: { room: Room; muted: boolean }) => {
  const { state, me, secret, actions } = room
  const [showHistory, setShowHistory] = useState(false)
  const round = state.round
  const phase = state.phase

  const isPsychic = !!round && !!me && me.id === round.psychicId
  const onActiveTeam = !!round && !!me && me.team === round.activeTeam
  const onSecondTeam = !!round && !!me && state.mode === 'versus' && me.team !== round.activeTeam

  // ход текущего зрителя?
  const myTurn =
    (phase === 'psychic' && isPsychic) ||
    (phase === 'team' && onActiveTeam) ||
    (phase === 'leftright' && onSecondTeam) ||
    (phase === 'await_reveal' && isPsychic)

  // звуки: сигнал на старте своего хода и аккорд на раскрытии
  const prevTurn = useRef(false)
  const prevPhase = useRef(phase)
  useEffect(() => {
    if (!muted && myTurn && !prevTurn.current) playYourTurn()
    prevTurn.current = myTurn
  }, [myTurn, muted])
  useEffect(() => {
    if (!muted && phase === 'reveal' && prevPhase.current !== 'reveal') playReveal()
    prevPhase.current = phase
  }, [phase, muted])

  if (!round || !me) return null
  const revealed = phase === 'reveal' || phase === 'gameover'

  // мишень видна телепату в его фазу и всем при раскрытии
  const shownTarget = revealed
    ? round.target
    : phase === 'psychic' && isPsychic
      ? (secret?.target ?? null)
      : null

  return (
    <div>
      {/* aria-live на постоянном контейнере: скринридер объявляет появление хода */}
      <div aria-live="polite">
        <AnimatePresence>
          {myTurn && (
            <motion.div
              className="turn-banner"
              initial={{ opacity: 0, scale: 0.92, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -8 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            >
              Твой ход
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Scores state={state} />
      <div className="dial-wrap">
        <Dial
          needlePos={round.needlePos}
          target={shownTarget}
          interactive={state.phase === 'team' && onActiveTeam}
          onChange={actions.moveNeedle}
        />
        <div className="poles">
          <div className="pole l">{round.card[0]}</div>
          <div className="pole r">{round.card[1]}</div>
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={phase}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <PhasePanel room={room} />
        </motion.div>
      </AnimatePresence>
      <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
        <button className="chip" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? 'Скрыть итоги' : 'Итоги раундов'}
        </button>
        {phase !== 'reveal' && (
          <>
            <ConfirmButton
              className="chip"
              label="Пропустить раунд"
              confirm="Точно пропустить?"
              onConfirm={actions.skipRound}
            />
            <ConfirmButton
              className="chip"
              label="В лобби"
              confirm="Точно в лобби?"
              onConfirm={actions.toLobby}
            />
          </>
        )}
      </div>
      {showHistory && (
        <div className="panel" style={{ marginTop: 12 }}>
          <History state={state} />
        </div>
      )}
    </div>
  )
}
