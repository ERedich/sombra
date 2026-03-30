import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
