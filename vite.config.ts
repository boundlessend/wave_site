import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
})
