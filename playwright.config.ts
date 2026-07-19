import { defineConfig } from '@playwright/test'

// смоук гоняется на локальном транспорте: env Supabase пустые,
// чтобы тест не зависел от сети и чужого проекта
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5199' },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_KEY: '' },
  },
})
