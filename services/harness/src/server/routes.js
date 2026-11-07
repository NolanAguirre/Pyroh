const fs = require('fs')
const path = require('path')
const express = require('express')
const config = require('../config')
const paths = require('../store/paths')
const Harness = require('../harness/Harness')
const sessionStore = require('../store/sessionStore')
const { readForkHistory } = require('../harness/fork')
const uiSettings = require('../store/uiSettings')
const { resolveWorkDir, listWorkDirs, renameWorkDir } = require('../store/workDir')
const { streamSession } = require('./sse')
const { readJsonAsync } = require('../store/jsonFile')
const { listProviders } = require('../agents/driver')
const registry = require('../registry')
const prompts = require('../prompts')
const { TRIGGERS } = require('../prompt/triggers')
const composerActions = require('./composerActions')
const submissionStore = require('../store/submissionStore')
const { rewritePrompt } = require('../prompt/rewrite')
const { sessionContext } = require('../prompt/context')
const { correctText } = require('../spellcheck')
const { userPrompt } = require('../prompt/provenance')
const questionStore = require('../store/questionStore')
const workspaceStore = require('../store/workspaceStore')
const checkpointStore = require('../store/checkpointStore')

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
  const { name, cwd, deleted, favorite } = req.body || {}
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
  if (favorite !== undefined) {
    if (typeof favorite !== 'boolean') return res.status(400).json({ error: 'favorite must be a boolean' })
    patch.favorite = favorite
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

// RegExps become { source, flags } so clients can rebuild them.
router.get('/prompt-triggers', (_req, res) => {
  res.json({
    triggers: TRIGGERS.map(({ id, label, description, scope, patterns }) => ({
      id,
      label,
      description,
      scope,
      patterns: patterns.map(({ source, flags }) => ({ source, flags })),
    })),
  })
})

const promptQuery = (req) => {
  const selected = {}
  for (const name of ['provider', 'model', 'mode', 'workspaceId']) {
    const value = req.query[name]
    if (value === undefined) continue
    if (typeof value !== 'string' || !value.trim()) {
      throw Object.assign(new Error(`${name} must be a non-empty string`), { status: 400 })
    }
    selected[name] = value
  }
  return selected
}

router.get('/prompts', async (req, res) => {
  try {
    const { provider, model, mode, workspaceId } = promptQuery(req)
    const entries = prompts.list(provider, { model, mode })
    const workspace = workspaceId ? await Harness.getWorkspace(workspaceId) : null
    if (workspaceId && !workspace) return res.status(404).json({ error: 'workspace not found' })
    const modes = new Map(registry.resolve(workspace).modes.map(({ id, label }) => [id, { id, label }]))
    for (const id of prompts.savedModes()) if (!modes.has(id)) modes.set(id, { id, label: id })
    res.json({
      prompts: entries,
      models: prompts.modelScopes(await readJsonAsync(MODELS_FILE, {})),
      modes: [...modes.values()],
    })
  } catch (err) {
    sendError(res, err)
  }
})

// Model versions replace text across providers; provider selects the preview
// fallback. An optional mode narrows a model edit. Null resets only that scope.
router.put('/prompts/:id', (req, res) => {
  try {
    const { provider, model, mode } = promptQuery(req)
    const { template, messageTypes } = req.body || {}
    res.json({ prompt: prompts.setOverride(req.params.id, template, provider, { model, mode }, messageTypes) })
  } catch (err) {
    sendError(res, err)
  }
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

router.post('/sessions/:id/recover-usage', async (req, res) => {
  if (!sessionStore.loadSession(req.params.id, config.writeDir)) return res.status(404).json({ error: 'session not found' })
  try {
    res.json(await require('../store/cursorUsageRecovery').recoverMissingUsage(req.params.id))
  } catch (err) { sendError(res, err) }
})

router.get('/sessions/:id', async (req, res) => {
  const status = await Harness.status(req.params.id)
  if (!status) return res.status(404).json({ error: 'session not found' })
  res.json(status)
})

// Input commands are independent of model, mode, and spellcheck.
// Return true even on command errors so invalid commands never reach an agent.
const handleInputCommand = (req, res) => {
  try {
    const outcome = composerActions.inputCommand(req.params.id, req.body || {})
    if (!outcome) return false
    res.status(outcome.status).json(outcome.body)
  } catch (err) {
    res.status(err.status || 500).json({ error: err && err.message ? err.message : String(err) })
  }
  return true
}

const sendComposerAction = (action) => async (req, res) => {
  try {
    const outcome = await composerActions.execute(req.params.id, action, req.body || {})
    res.status(outcome.status).json(outcome.body)
  } catch (err) {
    sendError(res, err)
  }
}

// Defer all action preparation until after the receipt has been durably saved
// and the HTTP response has been sent. Disconnects never cancel accepted work.
const executeSubmission = async (sessionId, { id, action, ...body }, writeDir) => {
  let terminal
  try {
    const outcome = await composerActions.execute(sessionId, action, body)
    terminal = { status: 'succeeded', result: outcome.body }
  } catch (err) {
    terminal = { status: 'failed', error: err && err.message ? err.message : String(err) }
  }
  try {
    submissionStore.finish(sessionId, id, terminal, writeDir)
  } finally {
    // If persisting the outcome failed, the next receipt read recovers it as
    // uncertain instead of leaving a live-process receipt locked indefinitely.
    submissionStore.release(sessionId, id, writeDir)
  }
}

router.post('/sessions/:id/submissions', (req, res) => {
  const sessionId = req.params.id
  const writeDir = config.writeDir
  try {
    if (!sessionStore.loadSession(sessionId, writeDir)) return res.status(404).json({ error: 'session not found' })
    const { submission, created } = submissionStore.receive(sessionId, req.body, writeDir)
    if (created) {
      setImmediate(() => {
        executeSubmission(sessionId, req.body, writeDir).catch(err => {
          process.stderr.write(`submission ${submission.id}: ${err.message || String(err)}\n`)
        })
      })
    }
    res.status(202).json({ submission })
  } catch (err) { sendError(res, err) }
})

router.get('/sessions/:id/submissions/:submissionId', (req, res) => {
  try {
    if (!sessionStore.loadSession(req.params.id, config.writeDir)) return res.status(404).json({ error: 'session not found' })
    const submission = submissionStore.get(req.params.id, req.params.submissionId, config.writeDir)
    if (!submission) return res.status(404).json({ error: 'submission not found' })
    res.json({ submission })
  } catch (err) { sendError(res, err) }
})

router.post('/sessions/:id/commands', sendComposerAction('commands'))
router.post('/sessions/:id/plan', sendComposerAction('plan'))
router.post('/sessions/:id/run', sendComposerAction('run'))
router.post('/sessions/:id/decompose', sendComposerAction('decompose'))

router.post('/sessions/:id/resume', async (req, res) => {
  if (handleInputCommand(req, res)) return
  const { prompt, mode } = req.body || {}
  const corrected = await correctText(prompt)
  const result = Harness.resume(req.params.id, { prompt: corrected, mode,
    promptProvenance: typeof prompt === 'string' ? userPrompt(corrected, prompt) : undefined })
  if (result && result.mode === 'decompose') return res.status(202).json(result)
  res.status(202).json({ run: result })
})

router.post('/sessions/:id/pause', (req, res) => {
  res.json(Harness.pause(req.params.id))
})

router.post('/sessions/:id/stop', (req, res) => {
  res.json(Harness.stop(req.params.id))
})

router.post('/sessions/:id/steer', sendComposerAction('steer'))
router.post('/sessions/:id/queue', sendComposerAction('queue'))

router.post('/sessions/:id/queue/:messageId/send', async (req, res) => {
  try {
    res.status(202).json(await Harness.sendQueuedMessage(req.params.id, req.params.messageId))
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
  }
})

router.delete('/sessions/:id/queue/:messageId', (req, res) => {
  try {
    Harness.cancelQueuedMessage(req.params.id, req.params.messageId)
    res.status(204).end()
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
  }
})

// Only free text is spellchecked and rewritten; secrets, an answer that picks an
// offered option, or any answer to an options-only question must reach the store unchanged.
const correctAnswer = async (sessionId, qid, answer) => {
  if (typeof answer !== 'string') return answer
  const question = questionStore.loadQuestion(sessionId, qid, config.writeDir)
  if (!question || question.secret || question.allowFreeText === false || question.options.includes(answer)) return answer
  const corrected = await correctText(answer, { first: false })
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  const run = question.runId ? sessionStore.loadRun(sessionId, question.runId, config.writeDir) : null
  return rewritePrompt(corrected, {
    cwd: workspaceStore.resolveSessionCwd(session, config.writeDir),
    first: false,
    provider: session?.provider,
    ...sessionContext(session, run?.mode ?? session?.mode),
  })
}

router.post('/sessions/:id/questions/:qid/answer', async (req, res) => {
  const { answer } = req.body || {}
  if (answer === undefined) return res.status(400).json({ error: 'answer is required' })
  const corrected = await correctAnswer(req.params.id, req.params.qid, answer)
  try {
    res.json({ answer: Harness.answer(req.params.id, req.params.qid, corrected) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get('/sessions/:id/runs', async (req, res) => {
  const inherited = readForkHistory(req.params.id, config.writeDir)
  const runs = await sessionStore.listRunsAsync(req.params.id, config.writeDir)
  res.json({ runs: [...(inherited?.runs || []), ...runs] })
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
  try {
    res.json({
      settings: uiSettings.updateUiSettings(body, config.writeDir),
    })
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    res.status(err.status || 400).json({ error: message })
  }
})

router.get('/config', (_req, res) => {
  res.json({ spellcheck: Boolean(config.spellcheckUrl), sessionNaming: Boolean(config.categorizerUrl) })
})

module.exports = router
