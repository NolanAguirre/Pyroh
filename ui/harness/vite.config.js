import react from '@vitejs/plugin-react'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || 6001)
const KANBAN_API_URL = process.env.KANBAN_API_URL || 'http://127.0.0.1:6011'

const libRoot = realpathSync(fileURLToPath(new URL('../../component-library', import.meta.url)))
const triggersRoot = realpathSync(fileURLToPath(new URL('../../packages/prompt-triggers', import.meta.url)))
const kanbanProxy = {
  target: KANBAN_API_URL,
  changeOrigin: true,
  xfwd: true,
  rewrite: (path) => path.replace(/^\/harness\/kanban-api(?=\/|$)/, ''),
}

export default defineConfig({
  clearScreen: false,
  base: '/harness/',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^component-library$/, replacement: `${libRoot}/src/index.js` },
      { find: /^prompt-triggers$/, replacement: `${triggersRoot}/index.js` },
    ],
    dedupe: ['react', 'react-dom', 'react-virtuoso'],
  },
  server: {
    host: HOST,
    port: PORT,
    strictPort: true,
    allowedHosts: true,
    proxy: { '/harness/kanban-api/': kanbanProxy },
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), libRoot, triggersRoot],
    },
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
  preview: {
    host: HOST,
    port: PORT,
    strictPort: true,
    allowedHosts: true,
    proxy: { '/harness/kanban-api/': kanbanProxy },
  },
})
