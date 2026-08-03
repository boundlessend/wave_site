import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import { applyTheme, loadTheme } from './ui/theme.ts'

// тему ставим до первого рендера: иначе выбранная вручную мигнёт системной
applyTheme(loadTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
)
