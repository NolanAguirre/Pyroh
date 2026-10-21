const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const { ensureDir } = require('./jsonFile')

const WORKSPACE_HEADING = /^#\s+(.+?)\s*$/
const TERMINAL_HEADING = /^##\s+(.+?)\s*$/

const createStartup = () => {
  const parse = (text) => {
    const entries = []
    const state = Object.create(null)
    state.workspace = null
    state.entry = null
    String(text || '').split(/\r?\n/).forEach((line) => {
      const terminal = TERMINAL_HEADING.exec(line)
      if (terminal) {
        state.entry = state.workspace ? { workspace: state.workspace, name: terminal[1], lines: [] } : null
        if (state.entry) entries.push(state.entry)
        return
      }
      const workspace = WORKSPACE_HEADING.exec(line)
      if (workspace) {
        state.workspace = workspace[1]
        state.entry = null
        return
      }
      if (state.entry && line.trim()) state.entry.lines.push(line)
    })
    return entries.map(({ workspace, name, lines }) => ({ workspace, name, command: lines.join('\n') }))
  }

  const read = () => {
    try {
      return fs.readFileSync(paths.terminalStartupFile(), 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return ''
      throw err
    }
  }

  const write = (text) => {
    const file = paths.terminalStartupFile()
    const dir = path.dirname(file)
    ensureDir(dir)
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
    fs.writeFileSync(tmp, String(text || ''), { mode: 0o600 })
    fs.renameSync(tmp, file)
    return read()
  }

  return { parse, read, write }
}

module.exports = createStartup()
module.exports.createStartup = createStartup
