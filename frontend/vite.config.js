import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      // Proxy all /api calls to the Express backend during local dev
      // This avoids CORS issues and lets both run on different ports
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Also proxy Socket.io for Prompt 2
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,         // ← enable WebSocket proxying
        changeOrigin: true,
      },
    },
  },
})
