const fs = require('fs')
const path = require('path')
const config = require('../config')
const { formatError } = require('../store/formatError')
const { log } = require('./harnessApi')

// Plugins are trusted code, required straight into the harness and re-read on
// every use so edits apply at once.
//   global:    <writeDir>/plugins/<name>/harness.plugin.js
//   workspace: <cwd>/harness.plugin.js
const PLUGIN_FILE = 'harness.plugin.js'

const globalPluginsDir = () => path.join(config.writeDir, 'plugins')

const pluginFile = (cwd) => {
  if (!cwd) return null
  const file = path.join(path.resolve(cwd), PLUGIN_FILE)
  return fs.existsSync(file) ? file : null
}

const clearRequireCache = (dir) => {
  const root = `${path.resolve(dir)}${path.sep}`
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) delete require.cache[key]
  }
}

// A broken file is reported with `error` and no exports, so the rest of the
// registry keeps working.
const requirePlugin = (scope, name, file) => {
  try {
    clearRequireCache(path.dirname(file))
    const exports = require(file)
    if (!exports || typeof exports !== 'object') throw new Error('module must export an object')
    return { scope, name, file, exports, error: null }
  } catch (err) {
    log(`failed to load ${file}: ${formatError(err)}`)
    return { scope, name, file, exports: null, error: formatError(err) }
  }
}

const globalPlugins = () => {
  let entries
  try {
    entries = fs.readdirSync(globalPluginsDir(), { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ name: entry.name, file: path.join(globalPluginsDir(), entry.name, PLUGIN_FILE) }))
    .filter(({ file }) => fs.existsSync(file))
    .map(({ name, file }) => requirePlugin('global', name, file))
}

// Global first, then the workspace, so later scopes win on shared ids.
const loadPlugins = (workspace) => {
  const plugins = globalPlugins()
  const file = pluginFile(workspace?.cwd)
  if (file) plugins.push(requirePlugin('workspace', workspace.name || workspace.id, file))
  return plugins
}

module.exports = { PLUGIN_FILE, globalPluginsDir, pluginFile, loadPlugins }
