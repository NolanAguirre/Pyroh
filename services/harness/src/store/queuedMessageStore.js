const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('../config')
const paths = require('./paths')
const { readJson, readJsonAsync, writeJson } = require('./jsonFile')

const fileFor = (sessionId, writeDir = config.writeDir) =>
  path.join(paths.sessionDir(sessionId, writeDir), 'queued-messages.json')
const pendingDir = (writeDir = config.writeDir) => path.join(writeDir, 'queued-message-sessions')
const markerFor = (sessionId, writeDir) => path.join(pendingDir(writeDir), `${sessionId}.json`)
const read = (sessionId, writeDir = config.writeDir) => readJson(fileFor(sessionId, writeDir), { messages: [] })
const publicMessage = ({ id, text, mode, createdAt }) => ({ id, text, mode, createdAt })
const pending = (state) => state.messages.filter(message => !message.runId).map(publicMessage)
const list = (sessionId, writeDir = config.writeDir) => pending(read(sessionId, writeDir))
const listAsync = async (sessionId, writeDir = config.writeDir) =>
  pending(await readJsonAsync(fileFor(sessionId, writeDir), { messages: [] }))
const hasWork = (sessionId, writeDir = config.writeDir) => read(sessionId, writeDir).messages.length > 0
const hasReadyWork = (sessionId, writeDir = config.writeDir) => {
  const head = read(sessionId, writeDir).messages[0]
  return Boolean(head && (!head.retryAt || head.retryAt <= Date.now()))
}

// All mutations hold the delegation delivery lock, also used by Stop/Pause.
// Write the sweep marker first so a crash cannot hide newly queued work.
const save = (sessionId, state, writeDir = config.writeDir) => {
  const marker = markerFor(sessionId, writeDir)
  if (state.messages.length && !fs.existsSync(marker)) writeJson(marker, { sessionId })
  writeJson(fileFor(sessionId, writeDir), state)
  if (!state.messages.length) fs.rmSync(marker, { force: true })
}

const enqueue = (sessionId, text, mode, writeDir = config.writeDir, promptProvenance) => {
  const state = read(sessionId, writeDir)
  const message = { id: `q_${crypto.randomUUID()}`, text, mode, createdAt: Date.now(),
    ...(promptProvenance ? { promptProvenance: require('../prompt/provenance').supplied(text, promptProvenance) } : {}) }
  state.messages.push(message)
  save(sessionId, state, writeDir)
  return publicMessage(message)
}

const clear = (sessionId, writeDir = config.writeDir) => {
  if (hasWork(sessionId, writeDir)) save(sessionId, { messages: [] }, writeDir)
}

const sessions = async (writeDir = config.writeDir) => {
  try {
    return (await fs.promises.readdir(pendingDir(writeDir)))
      .filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))
  } catch (err) { if (err.code === 'ENOENT') return []; throw err }
}

module.exports = { fileFor, read, save, enqueue, clear, list, listAsync, hasWork, hasReadyWork, sessions, publicMessage }
