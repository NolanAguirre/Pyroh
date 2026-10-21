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

const listWorkspaceIds = () => {
  try {
    return fs.readdirSync(path.join(config.writeDir, 'workspaces')).filter((id) => WORKSPACE_ID.test(id))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// Matches by name first, then by id. Returns null when nothing matches.
const findWorkspaceId = (nameOrId) => {
  if (typeof nameOrId !== 'string' || !nameOrId.trim()) return null
  const target = nameOrId.trim()
  const ids = listWorkspaceIds()
  const readable = (id) => {
    try {
      return loadWorkspace(id)
    } catch {
      return null
    }
  }
  const byName = ids.find((id) => {
    const found = readable(id)
    return found && typeof found.name === 'string' && found.name.trim() === target
  })
  if (byName) return byName
  return ids.includes(target) && readable(target) ? target : null
}

module.exports = { resolveRoot, findWorkspaceId }
