import { useState } from 'react'
import { CARDS, CARD_SEPARATOR, deckToText, loadCustomCards, parseDeckText, saveCustomCards } from '../cards.ts'

// редактор своих карточек: пары хранятся в localStorage вкладки и подмешиваются
// к встроенному набору. карту раунда выбирает тот, кто его запускает, поэтому
// свои пары попадают в игру без синхронизации по сети
export const DeckEditor = () => {
  const [text, setText] = useState(() => deckToText(loadCustomCards()))
  const [saved, setSaved] = useState(false)
  const parsed = parseDeckText(text)

  const save = (): void => {
    saveCustomCards(parsed)
    setText(deckToText(parsed))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="deck-editor">
      <p className="muted" style={{ marginTop: 0 }}>
        Одна пара на строку, стороны через «{CARD_SEPARATOR}». Свои пары добавляются к встроенным
        ({CARDS.length} шт.) и хранятся только в этом браузере.
      </p>
      <textarea
        className="field deck-text"
        rows={6}
        value={text}
        spellCheck={false}
        placeholder={`Тёплое ${CARD_SEPARATOR} Холодное`}
        aria-label="Свои карточки, по одной паре на строку"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
        <button className="chip" onClick={save}>
          {saved ? 'Сохранено' : 'Сохранить'}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          распознано пар: {parsed.length}
        </span>
      </div>
    </div>
  )
}
