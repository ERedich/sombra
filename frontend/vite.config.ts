import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@sombra/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
  server: {
    proxy: {
      /** WebSocket (work order live updates) — must be before generic `/api`. */
      '/api/ws': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      /** Same-origin in dev: browser → Vite → API (no CORS / preflight). */
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
