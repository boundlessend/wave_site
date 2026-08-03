// типы состояния игры "длина волны"

export type Side = 'LEFT' | 'RIGHT'

// команды-полушария; в кооперативе все игроки в 'left'
export type TeamId = 'left' | 'right'

export type GameMode = 'versus' | 'coop'

export type Phase =
  | 'lobby'
  | 'psychic' // телепат смотрит мишень, тянет карточку, даёт подсказку
  | 'team' // команда двигает стрелку
  | 'leftright' // вторая команда угадывает сторону (только versus)
  | 'await_reveal' // ждём, пока телепат "откроет экран"
  | 'reveal' // мишень раскрыта, очки начислены
  | 'gameover'

// карточка: пара противоположностей [левое понятие, правое понятие]
export type Card = readonly [string, string]

export type Player = {
  readonly id: string
  readonly name: string
  readonly team: TeamId
}

export type Round = {
  readonly activeTeam: TeamId
  readonly psychicId: string
  readonly card: Card
  readonly clue: string
  // хеш-обязательство телепата на мишень (commit-reveal): без него reveal не принимается
  readonly commit: string | null
  // центр мишени 0..100. null пока телепат не "открыл экран":
  // секрет живёт только на устройстве телепата и уходит в сеть лишь при reveal
  readonly target: number | null
  readonly needlePos: number // позиция стрелки команды 0..100
  readonly leftRightGuess: Side | null
}

export type Scores = {
  readonly left: number
  readonly right: number
}

// итог сыгранного раунда для истории партии. имя телепата резолвится из players
// на момент показа: игрок мог выйти, тогда покажем прочерк
export type RoundResult = {
  readonly roundNo: number
  readonly card: Card
  readonly clue: string
  readonly target: number
  readonly needlePos: number
  readonly activeTeam: TeamId
  readonly psychicId: string
  readonly gained: Scores
}

export type GameState = {
  readonly mode: GameMode
  readonly phase: Phase
  readonly players: readonly Player[]
  // последние кикнутые id: кикнутый клиент видит себя здесь и не пере-заходит
  // автоматически (в отличие от выпавшего из-за обрыва связи)
  readonly kicked: readonly string[]
  readonly scores: Scores
  readonly round: Round | null
  readonly roundNo: number // номер раунда; телепат генерирует мишень раз на раунд
  readonly cardsRemaining: number // используется в коопе
  readonly winner: TeamId | null
  // сыгранные раунды текущей партии (последние HISTORY_MAX): таблица итогов
  // и источник недавних карт, чтобы не повторяться
  readonly history: readonly RoundResult[]
}
