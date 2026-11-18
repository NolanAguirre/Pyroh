import componentLibrary from './component-library.js'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// envdir (make start) or explicit environment values override these defaults.
const env = (name) => process.env[name] || readFileSync(new URL(`./env-dir/default/${name}`, import.meta.url), 'utf8').trim()

export default defineConfig({
  base: '/analytics/',
  clearScreen: false,
  plugins: [componentLibrary(), react()],
  server: { host: env('HOST'), port: Number(env('PORT')), strictPort: true },
})
