import { Component, type ReactNode } from 'react'
import './game.css'

type Props = { children: ReactNode }
type State = { error: Error | null }

// единственный класс в проекте: error boundary возможен только классом (ограничение React).
// ловит краши рендера, чтобы игрок видел понятное сообщение, а не белый экран
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('Игра упала:', error)
  }

  render(): ReactNode {
    if (this.state.error) {
      // текст ошибки только в консоль: в нём бывают внутренние детали,
      // игроку он всё равно ничего не объясняет
      return (
        <div className="panel" style={{ margin: 16 }}>
          <h1>Что-то сломалось</h1>
          <p className="muted">Перезагрузи страницу — комната и место в партии сохранятся.</p>
          <button className="btn wide" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
