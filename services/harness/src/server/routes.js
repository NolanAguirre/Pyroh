const fs = require('fs')
const path = require('path')
const express = require('express')
const config = require('../config')
const paths = require('../store/paths')
const Harness = require('../harness/Harness')
const sessionStore = require('../store/sessionStore')
const uiSettings = require('../store/uiSettings')
const { resolveWorkDir, listWorkDirs, renameWorkDir } = require('../store/workDir')
const { streamSession } = require('./sse')
const { readJsonAsync } = require('../store/jsonFile')
const { listProviders } = require('../agents/driver')
const registry = require('../registry')
const prompts = require('../prompts')

const router = express.Router()

const sendSessionList = async (req, res, workspaceId) => {
  const { orderBy = 'createdAt', order = 'desc', limit, active } = req.query
  if (active !== undefined && !['true', 'false'].includes(active)) {
    return res.status(400).json({ error: 'active must be true or false' })
  }
  if (!['createdAt', 'updatedAt'].includes(orderBy)) {
    return res.status(400).json({ error: 'orderBy must be createdAt or updatedAt' })
  }
  if (!['asc', 'desc'].includes(order)) {
    return res.status(400).json({ error: 'order must be asc or desc' })
  }
  if (limit !== undefined && (
    typeof limit !== 'string' || !/^[1-9]\d*$/.test(limit) || !Number.isSafeInteger(Number(limit))
  )) {
    return res.status(400).json({ error: 'limit must be a positive integer' })
  }
  res.json({ sessions: await Harness.list(workspaceId, {
    includeArchived: req.query.includeArchived === 'true',
    active: active === undefined ? undefined : active === 'true',
    orderBy,
    order,
    limit: limit === undefined ? undefined : Number(limit),
    fields: 'list',
  }) })
}

const MODELS_FILE = path.join(__dirname, '..', 'agents', 'models.json')

// Providers and their models from models.json, written at startup by
// scripts/refresh-models.js. Unimplemented providers are reported as disabled.
router.get('/providers', async (_req, res) => {
  const models = await readJsonAsync(MODELS_FILE, {})
  res.json({ providers: listProviders().map((id) => {
    const implemented = require(`../agents/providers/${id}`).implemented !== false
    const list = models[id] || []
    return {
      id,
      implemented,
      models: list,
      error: implemented && !list.length ? 'No models listed; run make services.harness.models.refresh' : null,
    }
  }) })
})

// List directories under the configured base path so the UI can pick a work
// dir. `path` (default = base) must resolve inside the base.
router.get('/workdir', (req, res) => {
  try {
    res.json(listWorkDirs(req.query.path))
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : String(err) })
  }
})

router.get('/workspaces', async (_req, res) => {
  const workspaces = (await Harness.listWorkspaces()).filter((workspace) => !workspace.deleted)
  res.json({ workspaces })
})

router.post('/workspaces', (req, res) => {
  const { name, cwd } = req.body || {}
  let resolvedCwd
  try {
    resolvedCwd = resolveWorkDir(cwd)
  } catch (err) {
    return res.status(400).json({ error: err && err.message ? err.message : String(err) })
  }
  const workspace = Harness.createWorkspace({ name, cwd: resolvedCwd })
  res.status(201).json({ workspace })
})

router.get('/workspaces/:id', async (req, res) => {
  const workspace = await Harness.getWorkspace(req.params.id)
  if (!workspace) return res.status(404).json({ error: 'workspace not found' })
  res.json({ workspace })
})

// A new cwd renames the repo folder, then stores the new path. A name-only
// patch leaves the folder where it is.
const saveWorkspacePatch = async (id, patch) => {
  if (patch.cwd === undefined) return Harness.updateWorkspace(id, patch)
  const current = await Harness.getWorkspace(id)
  if (!current) throw Object.assign(new Error('workspace not found'), { status: 404 })
  if (path.resolve(current.cwd) === patch.cwd) return Harness.updateWorkspace(id, patch)
  const active = await Harness.list(id, { includeArchived: true, active: true, fields: 'list' })
  if (active.length) {
    throw Object.assign(new Error('Stop running sessions before renaming this directory'), { status: 409 })
  }
  const moved = renameWorkDir(current.cwd, patch.cwd)
  try {
    return Harness.updateWorkspace(id, patch)
  } catch (err) {
    if (moved) {
      try { renameWorkDir(patch.cwd, current.cwd) } catch { /* keep the original error */ }
    }
    throw err
  }
}

router.patch('/workspaces/:id', async (req, res) => {
  const { name, cwd, deleted } = req.body || {}
  const patch = {}
  if (name !== undefined) {
    const trimmed = String(name).trim()
    if (!trimmed) return res.status(400).json({ error: 'name is required' })
    patch.name = trimmed
  }
  if (deleted !== undefined) {
    if (typeof deleted !== 'boolean') return res.status(400).json({ error: 'deleted must be a boolean' })
    patch.deleted = deleted
  }
  if (cwd !== undefined) {
    try {
      patch.cwd = resolveWorkDir(cwd)
    } catch (err) {
      return res.status(400).json({ error: err && err.message ? err.message : String(err) })
    }
  }
  try {
    res.json({ workspace: await saveWorkspacePatch(req.params.id, patch) })
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    const code = err.status || (message.includes('not found') ? 404 : 400)
    res.status(code).json({ error: message })
  }
})

// Allowed modes for the workspace, built-ins included.
router.get('/workspaces/:id/modes', async (req, res) => {
  const workspace = await Harness.getWorkspace(req.params.id)
  if (!workspace) return res.status(404).json({ error: 'workspace not found' })
  res.json({ modes: registry.listAllowed(workspace, { provider: req.query.provider }).modes })
})

// Registry: `GET` lists allowed modes and panels; `/explain` returns every
// entry with its decision and the mode × tool matrix; `/rules` reads or
// replaces the rule list. Without a workspace these use global scope.
const providerQuery = (req) => (typeof req.query.provider === 'string' && req.query.provider) || undefined

const sendError = (res, err) => res.status(err.status || 400).json({ error: err && err.message ? err.message : String(err) })

router.get('/registry', (req, res) => {
  res.json(registry.listAllowed(null, { provider: providerQuery(req) }))
})

router.get('/registry/explain', (req, res) => {
  res.json(registry.explain(null, { provider: providerQuery(req) }))
})

router.get('/prompts', (req, res) => {
  res.json({ prompts: prompts.list() })
})

router.get('/registry/rules', (_req, res) => {
  res.json(registry.readRules(null))
})

router.put('/registry/rules', (req, res) => {
  try {
    res.json(registry.writeRules(null, (req.body || {}).rules))
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/workspaces/:id/registry', async (req, res) => {
  const workspace = await Harness.getWorkspace(req.params.id)
  if (!workspace) return res.status(404).json({ error: 'workspace not found' })
  res.json(registry.listAllowed(workspace, { provider: providerQuery(req) }))
})

router.get('/workspaces/:id/registry/explain', async (req, res) => {
  const workspace = await Harness.getWorkspace(req.params.id)
  if (!workspace) return res.status(404).json({ error: 'workspace not found' })
  res.json(registry.explain(workspace, { provider: providerQuery(req) }))
})

router.get('/workspaces/:id/registry/rules', async (req, res) => {
  const workspace = await Harness.getWorkspace(req.params.id)
  if (!workspace) return res.status(404).json({ error: 'workspace not found' })
  res.json(registry.readRules(workspace))
})

router.put('/workspaces/:id/registry/rules', async (req, res) => {
  const workspace = await Harness.getWorkspace(req.params.id)
  if (!workspace) return res.status(404).json({ error: 'workspace not found' })
  try {
    res.json(registry.writeRules(workspace, (req.body || {}).rules))
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/workspaces/:id/sessions', async (req, res) => {
  if (!(await Harness.getWorkspace(req.params.id))) {
    return res.status(404).json({ error: 'workspace not found' })
  }
  await sendSessionList(req, res, req.params.id)
})

router.post('/workspaces/:id/sessions', (req, res) => {
  const { provider = 'cursor', model = null, codex, grok, claude } = req.body || {}
  try {
    const session = Harness.createSession({
      workspaceId: req.params.id,
      provider,
      model,
      codex,
      grok,
      claude,
    })
    res.status(201).json({ session })
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    const code = message.includes('not found') ? 404 : 400
    res.status(code).json({ error: message })
  }
})

router.get('/sessions', async (req, res) => {
  await sendSessionList(req, res, req.query.workspaceId)
})

router.post('/sessions', (req, res) => {
  const { workspaceId, provider = 'cursor', model = null, codex, grok, claude } = req.body || {}
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' })
  try {
    const session = Harness.createSession({ workspaceId, provider, model, codex, grok, claude })
    res.status(201).json({ session })
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    const code = message.includes('not found') ? 404 : 400
    res.status(code).json({ error: message })
  }
})

// Archiving only changes list visibility; runs and logs remain available.
// Name is optional and can be added later; an empty name clears it.
// Pinning is list metadata and does not change session contents.
router.patch('/sessions/:id', (req, res) => {
  const body = req.body || {}
  const hasArchived = Object.prototype.hasOwnProperty.call(body, 'archived')
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name')
  const hasPinned = Object.prototype.hasOwnProperty.call(body, 'pinned')
  if (!hasArchived && !hasName && !hasPinned) {
    return res.status(400).json({ error: 'archived, name, or pinned is required' })
  }
  const patch = {}
  if (hasArchived) {
    if (typeof body.archived !== 'boolean') {
      return res.status(400).json({ error: 'archived must be a boolean' })
    }
    patch.archived = body.archived
  }
  if (hasPinned) {
    if (typeof body.pinned !== 'boolean') {
      return res.status(400).json({ error: 'pinned must be a boolean' })
    }
    patch.pinned = body.pinned
  }
  if (hasName) {
    if (typeof body.name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' })
    }
    const name = body.name.trim()
    if (name.length > 120) {
      return res.status(400).json({ error: 'name must be at most 120 characters' })
    }
    patch.name = name || null
  }
  if (!sessionStore.loadSession(req.params.id, config.writeDir)) {
    return res.status(404).json({ error: 'session not found' })
  }
  const session = sessionStore.updateSession(req.params.id, patch, config.writeDir)
  res.json({ session })
})

// Categorizer callback. Only fills a still-null name so manual renames win.
router.post('/sessions/:id/auto-name', (req, res) => {
  const { result } = req.body || {}
  if (typeof result !== 'string') return res.status(400).json({ error: 'result must be a string' })
  const name = result.trim()
  if (!name) return res.status(400).json({ error: 'result is empty' })
  if (name.length > 120) return res.status(400).json({ error: 'result must be at most 120 characters' })
  const session = sessionStore.loadSession(req.params.id, config.writeDir)
  if (!session) return res.status(404).json({ error: 'session not found' })
  if (session.name != null) return res.json({ session, applied: false })
  res.json({ session: sessionStore.updateSession(req.params.id, { name }, config.writeDir), applied: true })
})

router.get('/sessions/:id', async (req, res) => {
  const status = await Harness.status(req.params.id)
  if (!status) return res.status(404).json({ error: 'session not found' })
  res.json(status)
})

// Validates the mode against the registry before running, so prompt rules and
// deny decisions come from one place.
const startRun = async (req, res, requested, { prompt, provider, model, targetMode }) => {
  const session = sessionStore.loadSession(req.params.id, config.writeDir)
  if (!session) return res.status(404).json({ error: 'session not found' })
  const mode = requested || Harness.replyMode(session)
  let entry
  try {
    entry = registry.requireMode(registry.sessionWorkspace(session), mode, { provider: session.provider })
  } catch (err) {
    return sendError(res, err)
  }
  const inPlace = Harness.repliesInPlace(session, entry)
  if (!prompt && (inPlace || !entry.promptOptional)) return res.status(400).json({ error: 'prompt is required' })
  try {
    const run = await Harness.run(req.params.id, { prompt, mode, provider, model, targetMode })
    if (entry.kind === 'decompose') return res.status(202).json(run)
    res.status(202).json({ run, ...(entry.newSession && !inPlace
      ? { session: sessionStore.loadSession(run.sessionId, config.writeDir) } : {}) })
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    res.status(err.status || (message.includes('not found') ? 404 : 400)).json({ error: message })
  }
}

router.post('/sessions/:id/plan', (req, res) => startRun(req, res, 'plan', req.body || {}))

router.post('/sessions/:id/run', (req, res) => {
  const { mode, ...body } = req.body || {}
  return startRun(req, res, mode, body)
})

router.post('/sessions/:id/decompose', (req, res) => startRun(req, res, 'decompose', req.body || {}))

router.post('/sessions/:id/resume', (req, res) => {
  const { prompt, mode } = req.body || {}
  const result = Harness.resume(req.params.id, { prompt, mode })
  if (result && result.mode === 'decompose') return res.status(202).json(result)
  res.status(202).json({ run: result })
})

router.post('/sessions/:id/pause', (req, res) => {
  res.json(Harness.pause(req.params.id))
})

router.post('/sessions/:id/stop', (req, res) => {
  res.json(Harness.stop(req.params.id))
})

router.post('/sessions/:id/steer', (req, res) => {
  const { prompt } = req.body || {}
  if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'prompt is required' })
  try {
    res.status(202).json({ steer: Harness.steer(req.params.id, prompt) })
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
  }
})

router.post('/sessions/:id/questions/:qid/answer', (req, res) => {
  const { answer } = req.body || {}
  if (answer === undefined) return res.status(400).json({ error: 'answer is required' })
  try {
    res.json({ answer: Harness.answer(req.params.id, req.params.qid, answer) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get('/sessions/:id/runs', async (req, res) => {
  res.json({ runs: await sessionStore.listRunsAsync(req.params.id, config.writeDir) })
})

router.get('/sessions/:id/runs/:runId/plan', async (req, res) => {
  const file = paths.planFile(req.params.id, req.params.runId, config.writeDir)
  try {
    const text = await fs.promises.readFile(file, 'utf8')
    res.type('text/markdown').send(text)
  } catch {
    res.status(404).json({ error: 'plan not found' })
  }
})

router.get('/sessions/:id/log', async (req, res) => {
  if (!(await sessionStore.loadSessionAsync(req.params.id, config.writeDir))) {
    return res.status(404).json({ error: 'session not found' })
  }
  const file = paths.daemonLog(req.params.id, config.writeDir)
  try {
    const text = await fs.promises.readFile(file, 'utf8')
    res.type('text/plain').send(text)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    res.type('text/plain').send('')
  }
})

// Headers are already sent once streaming starts, so failures just end it.
router.get('/sessions/:id/events', (req, res) => {
  streamSession(req, res, req.params.id).catch(() => res.end())
})

router.get('/ui', (_req, res) => {
  res.json({ settings: uiSettings.getUiSettings(config.writeDir) })
})

router.patch('/ui', (req, res) => {
  const body = req.body || {}
  if (!Object.prototype.hasOwnProperty.call(body, 'transcriptFontSize')) {
    return res.status(400).json({ error: 'transcriptFontSize is required' })
  }
  try {
    res.json({
      settings: uiSettings.updateUiSettings({ transcriptFontSize: body.transcriptFontSize }, config.writeDir),
    })
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    res.status(err.status || 400).json({ error: message })
  }
})

module.exports = router
