import componentLibrary from './component-library.js'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// s6-envdir (make start) or explicit environment values override these defaults.
const HOST = process.env.HOST || readFileSync(new URL('./env-dir/default/HOST', import.meta.url), 'utf8').trim()
const PORT = process.env.PORT || readFileSync(new URL('./env-dir/default/PORT', import.meta.url), 'utf8').trim()

export default defineConfig({
  base: '/analytics/',
  clearScreen: false,
  plugins: [componentLibrary(), react()],
  server: {
    host: HOST,
    port: Number(PORT),
    strictPort: true,
    proxy: { '/analytics/api': { target: 'http://localhost:6006', changeOrigin: true } },
  },
})
