const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const config = require('../config')
const store = require('../store/sessionStore')
const fileLock = require('../store/fileLock')
const { readJson, writeJson } = require('../store/jsonFile')

const HARNESS_TERMINAL_URL = process.env.HARNESS_TERMINAL_URL
const terminalUrl = (HARNESS_TERMINAL_URL || 'http://127.0.0.1:6003').replace(/\/+$/, '')
const hashOf = (value) => crypto.createHash('sha256').update(value).digest('hex')

const prepare = async (context, args) => {
  if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 65536 || /[\x00-\x08\x0b-\x1f\x7f]/.test(args.command)) {
    throw new Error('command must contain 1–65536 characters without terminal control characters')
  }
  if (typeof args.retryKey !== 'string' || !args.retryKey.trim() || args.retryKey.length > 256) throw new Error('retryKey must contain 1–256 characters')
  if (args.cwd !== undefined && (typeof args.cwd !== 'string' || !args.cwd || path.isAbsolute(args.cwd))) throw new Error('cwd must be a workspace-relative directory')
  if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 100)) throw new Error('name must contain 1–100 characters')
  const session = store.loadSession(context.sessionId, config.writeDir)
  if (!session?.workspaceId) throw new Error('terminal_prepare requires a session linked to a workspace')
  const request = { workspaceId: session.workspaceId, sessionId: session.id, command: args.command, cwd: args.cwd || '.', name: args.name?.trim() || 'Terminal' }
  const requestHash = hashOf(JSON.stringify(request))
  const key = hashOf(JSON.stringify([session.workspaceId, session.id, args.retryKey]))
  const directory = path.join(config.writeDir, 'terminal', 'preparations')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${key}.json`)
  const lock = fileLock.acquire(`${file}.lock`, { nonblock: true })
  try {
    const previous = readJson(file)
    if (previous && previous.requestHash !== requestHash) throw new Error('retryKey was already used for a different terminal request')
    if (!previous) writeJson(file, { ...request, requestHash, id: crypto.randomUUID() })
  } finally {
    lock.release()
  }
  // Only persisted, authenticated requests can be prepared by the terminal API.
  const response = await fetch(`${terminalUrl}/api/terminal/prepare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: key }), signal: AbortSignal.timeout(15000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Terminal service returned ${response.status}`)
  const terminal = result.terminal
  if (!terminal?.id || terminal.workspaceId !== session.workspaceId || terminal.sessionId !== session.id) throw new Error('Terminal service returned a mismatched terminal')
  return { type: 'harness_view', version: 1, view: 'terminal', resourceId: terminal.id,
    workspaceId: session.workspaceId, sessionId: session.id, command: request.command, cwd: terminal.cwd, name: terminal.name }
}

module.exports = { prepare }
