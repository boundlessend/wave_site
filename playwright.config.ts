import { defineConfig } from '@playwright/test'

// сценарии гоняются без Supabase: env пустые, поэтому комната по ссылке идёт
// через BroadcastChannel (несколько вкладок одного браузера), а без ссылки —
// однвкладочный локальный транспорт. сеть и чужой проект тестам не нужны
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_KEY: '' },
  },
})
