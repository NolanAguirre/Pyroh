const fs = require('fs')
const path = require('path')
const config = require('../config')

const WORKSPACE_ID = /^[A-Za-z0-9_-]+$/
const httpError = (httpStatus, message) => Object.assign(new Error(message), { httpStatus })

const loadWorkspace = (id) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.writeDir, 'workspaces', id, 'workspace.json'), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

const isAbsent = (value) => value === undefined || value === null || value === ''

const resolveRoot = async (workspace) => {
  if (isAbsent(workspace)) return fs.promises.realpath(config.workBase)
  if (typeof workspace !== 'string') throw httpError(400, 'workspace must be a string')
  const found = WORKSPACE_ID.test(workspace)
    ? loadWorkspace(workspace)
    : null
  if (!found || !found.cwd) throw httpError(404, 'Workspace not found')
  return fs.promises.realpath(found.cwd)
}

module.exports = { resolveRoot }
