import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 7002,
    open: false,
    proxy: {
      '/server': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
