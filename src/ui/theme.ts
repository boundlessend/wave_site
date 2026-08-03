// тема оформления: auto следует системной настройке, светлая и тёмная фиксируют её.
// выбор пишется в data-theme на <html>, чтобы CSS решал всё сам, без пересчёта в React
export type Theme = 'auto' | 'light' | 'dark'

const KEY = 'wave_theme'
const THEMES: readonly Theme[] = ['auto', 'light', 'dark']

export const loadTheme = (): Theme => {
  const v = localStorage.getItem(KEY)
  return THEMES.includes(v as Theme) ? (v as Theme) : 'auto'
}

export const applyTheme = (theme: Theme): void => {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export const saveTheme = (theme: Theme): void => {
  localStorage.setItem(KEY, theme)
  applyTheme(theme)
}

// текущая тема в терминах палитры: нужна 3D-фону, у него цвета не из CSS
export const isDarkNow = (theme: Theme): boolean =>
  theme === 'dark' ||
  (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
