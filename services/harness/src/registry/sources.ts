import fs from 'node:fs'
import path from 'node:path'
import type { PluginDefinition, Workspace } from '../sdk'
import { validatePlugin } from '../sdk'
import type { Scope } from './schema'

const config: { writeDir: string } = require('../config')
const { formatError }: { formatError(error: unknown): string } = require('../store/formatError')
// Keep loading independent from Harness so legacy builtin lookups cannot cycle.
const log = (message: string): void => { process.stdout.write(`[${new Date().toISOString()}] [plugins] ${message}\n`) }
export const PLUGIN_FILE = 'harness.plugin.js'
export const PLUGIN_FILES = ['harness.plugin.ts', PLUGIN_FILE] as const
export const BUNDLED_PLUGINS = ['decompose', 'token-waste', 'memory-extract', 'fork', 'new-chat'] as const
export interface PluginSource {
  scope: Scope
  name: string
  file: string | null
  exports: PluginDefinition | null
  error: string | null
}
export const globalPluginsDir = (): string => path.join(config.writeDir, 'plugins')
export const pluginFile = (cwd?: string | null): string | null => {
  if (!cwd) return null
  const files = PLUGIN_FILES.map(name => path.join(path.resolve(cwd), name)).filter(file => fs.existsSync(file))
  if (files.length > 1) throw new Error(`ambiguous plugin: both ${PLUGIN_FILES.join(' and ')} exist in ${cwd}`)
  return files[0] || null
}
const clearRequireCache = (dir: string): void => {
  const root = `${path.resolve(dir)}${path.sep}`
  for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key]
}
const failure = (scope: Scope, name: string, file: string | null, error: unknown): PluginSource => {
  const message = formatError(error)
  log(`failed to load ${file || name}: ${message}`)
  return { scope, name, file, exports: null, error: message }
}
export const requirePlugin = (scope: Scope, name: string, file: string): PluginSource => {
  try {
    clearRequireCache(path.dirname(file))
    const loaded: unknown = require(file)
    const value = loaded && typeof loaded === 'object' && 'default' in loaded ? loaded.default : loaded
    return { scope, name, file, exports: validatePlugin(value), error: null }
  } catch (error) { return failure(scope, name, file, error) }
}
const fromDirectory = (scope: Scope, name: string, directory: string): PluginSource | null => {
  try {
    const file = pluginFile(directory)
    return file ? requirePlugin(scope, name, file) : null
  } catch (error) { return failure(scope, name, directory, error) }
}
export const bundledPlugins = (): PluginSource[] => BUNDLED_PLUGINS.map(name =>
  requirePlugin('bundled', name, path.join(__dirname, '..', 'plugins', name, 'harness.plugin.ts')))
const globalPlugins = (): PluginSource[] => {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(globalPluginsDir(), { withFileTypes: true }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => fromDirectory('global', entry.name, path.join(globalPluginsDir(), entry.name)))
    .filter((entry): entry is PluginSource => entry !== null)
}
export const loadPlugins = (workspace?: Workspace | null): PluginSource[] => {
  const plugins = [...bundledPlugins(), ...globalPlugins()]
  if (workspace) {
    const plugin = fromDirectory('workspace', workspace.name || workspace.id, workspace.cwd)
    if (plugin) plugins.push(plugin)
  }
  return plugins
}
