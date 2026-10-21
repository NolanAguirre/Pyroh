const crypto = require('crypto')
const paths = require('./paths')
const { readJson, writeJson } = require('./jsonFile')

const MAX_NAME = 100
const MAX_ID = 64
const COLORS = [
  '#f59e0b',
  '#34d399',
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#facc15',
]

const httpError = (httpStatus, message) => Object.assign(new Error(message), { httpStatus })

const workspaceKey = (workspace) =>
  workspace === undefined || workspace === null || workspace === '' ? null : String(workspace)

const createGroupStore = () => {
  const readAll = () => {
    const raw = readJson(paths.terminalGroupsFile(), { groups: [] })
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.groups)) return []
    return raw.groups.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string')
  }

  const writeAll = (groups) => {
    writeJson(paths.terminalGroupsFile(), { groups })
  }

  const normalizeId = (value) => {
    if (typeof value !== 'string') throw httpError(400, 'group id must be a string')
    const next = value.trim().slice(0, MAX_ID)
    if (!next) throw httpError(400, 'group id is required')
    return next
  }

  const toJSON = (entry) => ({
    id: entry.id,
    workspaceId: entry.workspaceId ?? null,
    name: entry.name,
    color: entry.color,
    createdAt: entry.createdAt,
  })

  const inWorkspace = (groups, workspaceId) =>
    groups.filter((entry) => (entry.workspaceId ?? null) === workspaceId)

  const nextName = (groups, workspaceId) => {
    const used = new Set(inWorkspace(groups, workspaceId).map((entry) => entry.name))
    let n = used.size + 1
    let name = `Group ${n}`
    while (used.has(name)) {
      n += 1
      name = `Group ${n}`
    }
    return name
  }

  const nextColor = (groups, workspaceId) =>
    COLORS[inWorkspace(groups, workspaceId).length % COLORS.length]

  const list = (workspace, options = {}) => {
    const all = options.all === true
    const workspaceId = workspaceKey(workspace)
    const groups = readAll()
    const matched = all ? groups : inWorkspace(groups, workspaceId)
    return matched
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .map(toJSON)
  }

  const create = ({ workspace, name } = {}) => {
    if (name != null && typeof name !== 'string') throw httpError(400, 'name must be a string')
    const workspaceId = workspaceKey(workspace)
    const groups = readAll()
    const trimmed = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : ''
    const entry = {
      id: crypto.randomUUID(),
      workspaceId,
      name: trimmed || nextName(groups, workspaceId),
      color: nextColor(groups, workspaceId),
      createdAt: Date.now(),
    }
    groups.push(entry)
    writeAll(groups)
    return toJSON(entry)
  }

  const ensure = ({ workspace, id }) => {
    const groupId = normalizeId(id)
    const groups = readAll()
    const found = groups.find((entry) => entry.id === groupId)
    if (found) return toJSON(found)
    const workspaceId = workspaceKey(workspace)
    const entry = {
      id: groupId,
      workspaceId,
      name: nextName(groups, workspaceId),
      color: nextColor(groups, workspaceId),
      createdAt: Date.now(),
    }
    groups.push(entry)
    writeAll(groups)
    return toJSON(entry)
  }

  return { list, create, ensure }
}

module.exports = createGroupStore()
module.exports.createGroupStore = createGroupStore
