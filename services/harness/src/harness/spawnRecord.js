const path = require('node:path')
const config = require('../config')
const paths = require('../store/paths')
const fileLock = require('../store/fileLock')
const { readJson, writeJson } = require('../store/jsonFile')
const { validateRequest } = require('./spawnProtocol')

// A single receipt per session fences late requests and resolves lost replies.
const withRecord = (request, callback) => {
  validateRequest(request)
  const file = path.join(paths.sessionDir(request.sessionId, config.writeDir), 'spawn-request.json')
  const lock = fileLock.acquire(`${file}.lock`, { timeout: 5000 })
  try {
    return callback(readJson(file), record => writeJson(file, record))
  } finally { lock.release() }
}

module.exports = { withRecord }
