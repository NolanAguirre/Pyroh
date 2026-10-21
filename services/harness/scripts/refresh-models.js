#!/usr/bin/env node
// Query each provider for its models and write src/agents/models.json, which
// GET /api/providers serves. A provider that fails keeps its previous list.
const fs = require('fs')
const path = require('path')
const { createDriver, listProviders } = require('../src/agents/driver')

const FILE = path.join(__dirname, '..', 'src', 'agents', 'models.json')

const readCurrent = () => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return {}
  }
}

const listModels = async (name) => {
  if (require(`../src/agents/providers/${name}`).implemented === false) return []
  const driver = createDriver({ provider: name })
  try {
    return await driver.listModels()
  } finally {
    try { await driver.close() } catch { /* already closed */ }
  }
}

const main = async () => {
  const current = readCurrent()
  const next = {}
  await Promise.all(listProviders().map(async (name) => {
    try {
      next[name] = await listModels(name)
      process.stdout.write(`${name}: ${next[name].length} models\n`)
    } catch (err) {
      next[name] = current[name] || []
      process.stderr.write(`${name}: ${err && err.message ? err.message : err} (kept ${next[name].length} cached)\n`)
    }
  }))
  const ordered = Object.fromEntries(listProviders().map((name) => [name, next[name]]))
  fs.writeFileSync(FILE, `${JSON.stringify(ordered, null, 2)}\n`)
}

main().then(() => process.exit(0), (err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`)
  process.exit(1)
})
