import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// адрес прод-сборки: подставляется в OG-теги (краулеры читают HTML без JS,
// и относительный путь к картинке понимают не все). меняется через VITE_SITE_URL
const DEFAULT_SITE = 'https://wavesite-rho.vercel.app'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const site = (env.VITE_SITE_URL ?? '').replace(/\/$/, '') || DEFAULT_SITE
  return {
    plugins: [
      react(),
      {
        name: 'wave-site-url',
        transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', site),
      },
    ],
    build: {
      rollupOptions: {
        output: {
          // стабильный кэш: тяжёлые вендоры в отдельных чанках, правки кода их не инвалидируют
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return
            if (id.includes('react')) return 'react'
            if (id.includes('@supabase') || id.includes('phoenix')) return 'supabase'
            if (id.includes('/motion') || id.includes('framer')) return 'motion'
          },
        },
      },
    },
  }
})
