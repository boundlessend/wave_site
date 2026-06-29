import { useEffect, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useAnimate, useMotionValue } from 'motion/react'
import './game.css'
import { Dial } from './Dial.tsx'
import { playReveal, playYourTurn } from './sound.ts'
import type { Room } from '../useRoom.ts'
import { bandPoints, coopPoints, sideOfTarget } from '../game/rules.ts'
import type { GameState, TeamId } from '../game/types.ts'

const TEAM_NAME: Record<TeamId, string> = {
  left: 'Левое полушарие',
  right: 'Правое полушарие',
}

// не-цветовой признак команды (для дальтоников)
const TEAM_MARK: Record<TeamId, string> = { left: '▲', right: '●' }

const RULES = [
  'Телепат тайно видит цветную зону на шкале.',
  'Он даёт подсказку между двумя противоположностями (без чисел и однокоренных слов).',
  'Его команда двигает стрелку к центру зоны.',
  'Вторая команда угадывает, слева или справа от стрелки центр (+1 очко).',
  'Телепат открывает экран: чем ближе к центру, тем больше очков (2-4).',
  'Побеждает команда, набравшая 10+. В коопе играете вместе против колоды.',
]

const nameOf = (state: GameState, id: string): string =>
  state.players.find((p) => p.id === id)?.name ?? '???'

const teamCount = (state: GameState, team: TeamId): number =>
  state.players.filter((p) => p.team === team).length

// ——— лобби ———
const Lobby = ({ room, dev, roomCode }: { room: Room; dev: boolean; roomCode: string | null }) => {
  const { state, me, actions } = room
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const coop = state.mode === 'coop'
  const canStart = coop
    ? state.players.length >= 1
    : teamCount(state, 'left') >= 1 && teamCount(state, 'right') >= 1

  const shareLink = (): void => {
    void navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const tryJoin = (): void => {
    if (name.trim().length > 0) actions.join(name.trim(), 'left')
  }

  return (
    <div className="panel">
      <h1>Длина волны</h1>
      {roomCode !== null && (
        <div className="row" style={{ marginBottom: 16, alignItems: 'center' }}>
          <span className="tag">
            Комната <b>{roomCode}</b>
          </span>
          <button className="chip" onClick={shareLink}>
            {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
          </button>
        </div>
      )}
      <div className="row" style={{ marginBottom: 16 }}>
        <button
          className={`chip ${!coop ? 'on' : ''}`}
          onClick={() => actions.setMode('versus')}
        >
          Соревнование
        </button>
        <button
          className={`chip ${coop ? 'on' : ''}`}
          onClick={() => actions.setMode('coop')}
        >
          Кооператив
        </button>
      </div>

      {me === null ? (
        <div className="row">
          <input
            className="field"
            placeholder="Твоё имя"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && tryJoin()}
            maxLength={20}
          />
          <button className="btn wide" disabled={name.trim().length === 0} onClick={tryJoin}>
            Войти
          </button>
        </div>
      ) : (
        <p className="muted">Ты: {me.name}</p>
      )}

      <button className="chip" style={{ marginTop: 8 }} onClick={() => setShowRules((v) => !v)}>
        {showRules ? 'Скрыть правила' : 'Как играть'}
      </button>
      {showRules && (
        <ol className="rules">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      )}

      {coop ? (
        <div className="panel" style={{ background: 'var(--panel-2)' }}>
          <h3 style={{ margin: '0 0 8px' }}>Игроки</h3>
          {state.players.map((p) => (
            <div key={p.id}>{p.name}</div>
          ))}
        </div>
      ) : (
        <div className="players">
          {(['left', 'right'] as TeamId[]).map((team) => (
            <div className="col" key={team}>
              <h3 style={{ color: `var(--${team})` }}>
                {TEAM_MARK[team]} {TEAM_NAME[team]}
              </h3>
              {state.players
                .filter((p) => p.team === team)
                .map((p) => (
                  <div key={p.id}>
                    {p.name}
                    {me?.id === p.id ? ' (ты)' : ''}
                  </div>
                ))}
              {me !== null && me.team !== team && (
                <button
                  className="chip"
                  style={{ marginTop: 8 }}
                  onClick={() => actions.setTeam(me.id, team)}
                >
                  Перейти сюда
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        className="btn wide"
        disabled={!canStart || me === null}
        onClick={actions.startGame}
      >
        Начать игру
      </button>
      {!canStart && (
        <p className="muted" style={{ marginTop: 8 }}>
          {coop ? 'Нужен хотя бы один игрок' : 'Нужно по игроку в каждой команде'}
        </p>
      )}

      {import.meta.env.DEV && dev && (
        <div className="devbar" style={{ marginTop: 16 }}>
          <span>добавить игрока:</span>
          <button className="chip" onClick={() => actions.addPlayer('Игрок ' + (state.players.length + 1), 'left')}>
            + в Левое
          </button>
          <button className="chip" onClick={() => actions.addPlayer('Игрок ' + (state.players.length + 1), 'right')}>
            + в Правое
          </button>
        </div>
      )}
    </div>
  )
}

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
              onKeyDown={(e) => e.key === 'Enter' && clue.trim().length > 0 && actions.submitClue(clue.trim())}
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
        <p className="panel muted">Телепат {nameOf(state, round.psychicId)} придумывает подсказку…</p>
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
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => actions.submitSide('LEFT')}>
                  ← Левее
                </button>
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => actions.submitSide('RIGHT')}>
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
  const pts = bandPoints(round.target, round.needlePos)
  const verdict = pts === 4 ? 'В самый центр!' : pts > 0 ? 'Попадание в зону' : 'Мимо зоны'

  return (
    <div className="panel">
      <p className="clue">{verdict}</p>
      {state.mode === 'coop' ? (
        <p style={{ textAlign: 'center' }}>
          <b style={{ fontSize: 22 }}>+{coopPoints(round.target, round.needlePos)}</b> очк. · осталось
          карт: {state.cardsRemaining}
        </p>
      ) : (
        <div className="scores" style={{ marginBottom: 12 }}>
          {(['left', 'right'] as TeamId[]).map((team) => {
            const gain =
              team === round.activeTeam
                ? pts
                : pts !== 4 && round.leftRightGuess === sideOfTarget(round.target!, round.needlePos)
                  ? 1
                  : 0
            return (
              <div key={team} className={`score ${team}`} style={{ color: `var(--${team})` }}>
                <b>+{gain}</b>
                <span className="muted">{TEAM_MARK[team]} {TEAM_NAME[team]}</span>
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

// плавный счётчик очков
const AnimatedNumber = ({ value }: { value: number }) => {
  const mv = useMotionValue(value)
  const [display, setDisplay] = useState(value)
  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.5,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    return () => controls.stop()
  }, [value, mv])
  return <>{display}</>
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
      <span className="muted">{TEAM_MARK[team]} {TEAM_NAME[team]}</span>
    </div>
  )
}

// ——— табло ———
const Scores = ({ state }: { state: GameState }) => {
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

// ——— игровой стол ———
const Table = ({ room, muted }: { room: Room; muted: boolean }) => {
  const { state, me, secret, actions } = room
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
  const shownTarget =
    revealed ? round.target : phase === 'psychic' && isPsychic ? secret : null

  return (
    <div>
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
      {phase !== 'reveal' && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
          <button className="chip" onClick={actions.skipRound}>
            Пропустить раунд
          </button>
          <button className="chip" onClick={actions.toLobby}>
            В лобби
          </button>
        </div>
      )}
    </div>
  )
}

const GameOver = ({ room }: { room: Room }) => {
  const { state, actions } = room

  // празднование: салют из конфетти (ленивый импорт — не в основном бандле)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let stop = false
    void import('canvas-confetti').then(({ default: confetti }) => {
      if (stop) return
      const colors = ['#5bd6f5', '#ffb05c', '#ff5747', '#ffffff']
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

  let text: string
  if (state.mode === 'coop') {
    text = `Игра окончена. Итог: ${state.scores.left} очков`
  } else if (state.winner === 'tie') {
    text = 'Ничья!'
  } else if (state.winner) {
    text = `Победа: ${TEAM_NAME[state.winner]}!`
  } else {
    text = 'Игра окончена'
  }
  return (
    <div className="panel">
      <h1>{text}</h1>
      <button className="btn wide" onClick={actions.reset}>
        Сыграть ещё
      </button>
    </div>
  )
}

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
}: {
  room: Room
  devPerspective: boolean
  roomCode?: string | null
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
    <div>
      {conn !== 'online' && (
        <div className={`conn ${conn}`}>
          {conn === 'connecting' ? 'Подключение…' : 'Связь потеряна - переподключаемся…'}
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
            <Lobby room={room} dev={devPerspective} roomCode={roomCode} />
          )}
          {screen === 'over' && <GameOver room={room} />}
          {screen === 'table' && <Table room={room} muted={muted} />}
        </motion.div>
      </AnimatePresence>
      {devPerspective && <DevBar room={room} />}
      <div className="footer">
        <button className="chip" onClick={toggleMute}>
          {muted ? 'Звук выкл' : 'Звук вкл'}
        </button>
      </div>
    </div>
  )
}
