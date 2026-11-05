const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('../config')
const { readJsonAsync, writeJson } = require('./jsonFile')

const LEGACY_CHECKPOINT = Object.freeze({
  id: 'enable-nested-subagents',
  name: 'enable nested subagents',
  at: '2026-11-05T01:23:05.658Z',
  createdAt: '2026-11-05T01:23:05.658Z',
  sessionId: 's_mw2uxesvee0352',
  legacy: true,
  default: true,
})

const checkpointDir = (writeDir = config.writeDir) => path.join(writeDir, 'analytics-checkpoints')

const create = ({ name, sessionId, at = new Date().toISOString() }, writeDir = config.writeDir) => {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw Object.assign(new Error('checkpoint name is required'), { status: 400 })
  if (trimmed.length > 200) {
    throw Object.assign(new Error('checkpoint name must be at most 200 characters'), { status: 400 })
  }
  const checkpoint = { id: crypto.randomUUID(), name: trimmed, at, createdAt: at, sessionId }
  // Independent atomic files avoid a read/append/write race between requests.
  return writeJson(path.join(checkpointDir(writeDir), `${checkpoint.id}.json`), checkpoint)
}

const list = async (writeDir = config.writeDir) => {
  let entries
  try {
    entries = await fs.promises.readdir(checkpointDir(writeDir), { withFileTypes: true })
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    entries = []
  }
  const saved = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => readJsonAsync(path.join(checkpointDir(writeDir), entry.name))))
  return [{ ...LEGACY_CHECKPOINT }, ...saved.filter(checkpoint => checkpoint && checkpoint.id !== LEGACY_CHECKPOINT.id)]
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
}

module.exports = { create, list }
