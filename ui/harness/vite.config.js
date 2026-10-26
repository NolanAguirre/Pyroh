import react from '@vitejs/plugin-react'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 6001)

const libRoot = realpathSync(fileURLToPath(new URL('../../component-library', import.meta.url)))

export default defineConfig({
  base: '/harness/',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^component-library$/, replacement: `${libRoot}/src/index.js` },
    ],
    dedupe: ['react', 'react-dom', 'react-virtuoso'],
  },
  server: {
    host,
    port,
    strictPort: true,
    allowedHosts: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), libRoot],
    },
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
  preview: {
    host,
    port,
    strictPort: true,
    allowedHosts: true,
  },
})
