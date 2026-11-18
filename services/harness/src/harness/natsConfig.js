const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const HARNESS_NATS_URL = process.env.HARNESS_NATS_URL
const HARNESS_SPAWN_TIMEOUT_MS = process.env.HARNESS_SPAWN_TIMEOUT_MS
const ENV_USER = process.env.ENV_USER
const USER = process.env.USER

const readNatsSetting = (name) => {
  const root = path.resolve(__dirname, '../../../nats/env-dir')
  const user = ENV_USER || USER || 'default'
  const directories = user === 'default' ? ['default'] : [user, 'default']
  for (const directory of directories) {
    try {
      return fs.readFileSync(path.join(root, directory, name), 'utf8').trim()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`Missing NATS ${name} in ${root}`)
}

const natsConfig = ({ writeDir, dbPath }) => {
  const servers = HARNESS_NATS_URL || `nats://${readNatsSetting('HOST')}:${readNatsSetting('PORT')}`
  const timeout = Number(HARNESS_SPAWN_TIMEOUT_MS || 30000)
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 300000) {
    throw new Error('HARNESS_SPAWN_TIMEOUT_MS must be between 1000 and 300000')
  }
  const storageKey = createHash('sha256').update(`${writeDir}\n${dbPath}`).digest('hex').slice(0, 24)
  return { servers, timeout, storageKey,
    subject: `harness.agent-spawn.${storageKey}.v1`,
    promptSubject: `harness.agent-prompt.${storageKey}.v1`,
    lifecycleSubject: `harness.run-lifecycle.${storageKey}.v1` }
}

module.exports = { natsConfig }
