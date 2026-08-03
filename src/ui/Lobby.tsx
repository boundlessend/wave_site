import { useState } from 'react'
import type { Room } from '../useRoom.ts'
import type { TeamId } from '../game/types.ts'
import { TEAM_MARK, TEAM_NAME, teamCount } from './shared.ts'
import { ConfirmButton } from './ConfirmButton.tsx'
import { DeckEditor } from './DeckEditor.tsx'
import { QrCode } from './QrCode.tsx'

const RULES = [
  'Телепат тайно видит цветную зону на шкале.',
  'Он даёт подсказку между двумя противоположностями (без чисел и однокоренных слов).',
  'Его команда двигает стрелку к центру зоны.',
  'Вторая команда угадывает, слева или справа от стрелки центр (+1 очко).',
  'Телепат открывает экран: чем ближе к центру, тем больше очков (2-4).',
  'Побеждает команда, набравшая 10+ и обошедшая соперника. В коопе играете вместе против колоды.',
]

// строка игрока в лобби: имя + «выгнать» с подтверждением (промах бьёт по другому человеку)
const PlayerRow = ({ room, player }: { room: Room; player: { id: string; name: string } }) => {
  const { me, actions } = room
  return (
    <div className="player-row">
      <span>
        {player.name}
        {me?.id === player.id ? ' (ты)' : ''}
      </span>
      {me !== null && me.id !== player.id && (
        <ConfirmButton
          className="kick"
          label="✕"
          confirm="Точно?"
          ariaLabel={`Выгнать ${player.name}`}
          title="Выгнать"
          onConfirm={() => actions.kick(player.id)}
        />
      )}
    </div>
  )
}

export const Lobby = ({
  room,
  dev,
  roomCode,
  onExit,
}: {
  room: Room
  dev: boolean
  roomCode: string | null
  onExit: (() => void) | null
}) => {
  const { state, me, actions } = room
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [showDeck, setShowDeck] = useState(false)
  const coop = state.mode === 'coop'
  const canStart = coop
    ? state.players.length >= 1
    : teamCount(state, 'left') >= 1 && teamCount(state, 'right') >= 1

  const shareLink = (): void => {
    navigator.clipboard.writeText(window.location.href).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => undefined, // нет разрешения/insecure context: не показываем «скопировано»
    )
  }
  const tryJoin = (): void => {
    if (name.trim().length === 0) return
    // автобаланс: новичок попадает в меньшую команду (при равенстве — в левую)
    const team: TeamId = teamCount(state, 'left') <= teamCount(state, 'right') ? 'left' : 'right'
    actions.join(name.trim(), team)
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
          <button className="chip" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
            {showQr ? 'Скрыть QR' : 'QR-код'}
          </button>
        </div>
      )}
      {showQr && (
        <div className="qr-wrap">
          <QrCode text={window.location.href} />
          <p className="muted" style={{ fontSize: 13 }}>
            Наведи камеру телефона, чтобы войти в эту комнату.
          </p>
        </div>
      )}
      <div className="row" style={{ marginBottom: 16 }}>
        <button className={`chip ${!coop ? 'on' : ''}`} onClick={() => actions.setMode('versus')}>
          Соревнование
        </button>
        <button className={`chip ${coop ? 'on' : ''}`} onClick={() => actions.setMode('coop')}>
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

      <div className="row" style={{ marginTop: 8 }}>
        <button className="chip" aria-expanded={showRules} onClick={() => setShowRules((v) => !v)}>
          {showRules ? 'Скрыть правила' : 'Как играть'}
        </button>
        <button className="chip" aria-expanded={showDeck} onClick={() => setShowDeck((v) => !v)}>
          {showDeck ? 'Скрыть карточки' : 'Свои карточки'}
        </button>
      </div>
      {showRules && (
        <ol className="rules">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      )}
      {showDeck && <DeckEditor />}

      {coop ? (
        <div className="panel" style={{ background: 'var(--panel-2)' }}>
          <h3 style={{ margin: '0 0 8px' }}>Игроки</h3>
          {state.players.map((p) => (
            <PlayerRow key={p.id} room={room} player={p} />
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
                  <PlayerRow key={p.id} room={room} player={p} />
                ))}
              {me !== null && me.team !== team && (
                <button
                  className="chip"
                  style={{ marginTop: 8 }}
                  onClick={() => actions.setTeam(team)}
                >
                  Перейти сюда
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <button className="btn wide" disabled={!canStart || me === null} onClick={actions.startGame}>
        Начать игру
      </button>
      {!canStart && (
        <p className="muted" style={{ marginTop: 8 }}>
          {coop ? 'Нужен хотя бы один игрок' : 'Нужно по игроку в каждой команде'}
        </p>
      )}
      {onExit !== null && (
        <div style={{ marginTop: 12 }}>
          <ConfirmButton
            className="chip"
            label="Выйти из комнаты"
            confirm="Точно выйти?"
            onConfirm={() => {
              actions.leaveRoom()
              onExit()
            }}
          />
        </div>
      )}

      {import.meta.env.DEV && dev && (
        <div className="devbar" style={{ marginTop: 16 }}>
          <span>добавить игрока:</span>
          <button
            className="chip"
            onClick={() => actions.addPlayer('Игрок ' + (state.players.length + 1), 'left')}
          >
            + в Левое
          </button>
          <button
            className="chip"
            onClick={() => actions.addPlayer('Игрок ' + (state.players.length + 1), 'right')}
          >
            + в Правое
          </button>
        </div>
      )}
    </div>
  )
}
