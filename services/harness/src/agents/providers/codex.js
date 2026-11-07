const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const config = require('../../config')
const { createTransport } = require('./codexTransport')
const { createCapture } = require('./codexTelemetry')
const { normalizeCodexOptions } = require('./codexOptions')
const { composePrompt } = require('../modes')
const { providerMode } = require('../providerModes')
const prompts = require('../../prompts')

// The live catalog can lag a launch. Keep GPT 6.1 Sol selectable until model/list returns it.
const GPT_61_SOL = {
  id: 'gpt-6.1-sol',
  displayName: 'GPT 6.1 Sol',
  isDefault: false,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
    { reasoningEffort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
    { reasoningEffort: 'high', description: 'Greater reasoning depth for complex problems' },
    { reasoningEffort: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
    { reasoningEffort: 'max', description: 'Maximum reasoning depth for the hardest problems' },
  ],
}

const sandboxTypes = { 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite', 'danger-full-access': 'dangerFullAccess' }
const approvalTypes = { 'on-request': 'on-request', never: 'never', untrusted: 'untrusted' }
const approvalFor = (mode, configured) => approvalTypes[providerMode('codex', mode).approvalPolicy || configured]
const ASK_TOOL_NAME = 'harness_ask_user'
const askTool = (context = {}) => ({
  name: ASK_TOOL_NAME,
  description: prompts.text('askUserCodex', 'codex', context),
  inputSchema: {
    type: 'object', properties: {
      question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } },
      allowMultiple: { type: 'boolean' },
    }, required: ['question'], additionalProperties: false,
  },
})

// Codex's output token count already includes reasoning tokens.
const normalizeUsage = (usage) => usage ? {
  inputTokens: usage.inputTokens || 0,
  outputTokens: usage.outputTokens || 0,
  cacheReadTokens: usage.cachedInputTokens || 0,
  cacheWriteTokens: usage.cacheWriteInputTokens || 0,
  reasoningTokens: usage.reasoningOutputTokens || 0,
  totalTokens: usage.totalTokens ?? ((usage.inputTokens || 0) + (usage.outputTokens || 0)),
} : null

const createDriver = ({ tools = {}, codex = {}, writeDir = config.writeDir, requestEvidence } = {}) => {
  const options = normalizeCodexOptions(codex)
  const harnessMcp = Array.isArray(tools.mcpServers) ? tools.mcpServers : []
  const harnessMcpNames = harnessMcp.map((server) => server.name)
  let transport = null
  let telemetry = null
  let threadId = null
  let threadOptions = {}
  let selectedModel = null
  let selectedEffort = null
  let active = null
  let requestQueue = Promise.resolve()
  let cumulativeUsage = null
  let forking = false
  let forkAttempted = false
  const serverRequests = new Map()
  const diagnostics = []

  const emit = (event) => active?.emit({ ...event, runId: active.id })
  const clearRequests = () => {
    for (const controller of serverRequests.values()) controller.abort()
    serverRequests.clear()
  }
  const finish = (status, error = null) => {
    if (!active || active.done) return
    active.done = true
    telemetry?.endSegment(active.evidenceSegmentId, status)
    clearTimeout(active.cancelTimer)
    clearRequests()
    const messages = [...active.messages.values()]
    const finals = messages.filter((item) => item.phase === 'final_answer')
    const result = {
      status,
      result: active.plan || (finals.length ? finals : messages).map((item) => item.text).join('\n\n'),
      usage: active.usage,
      providerUsage: cumulativeUsage,
      durationMs: Date.now() - active.startedAt,
      error,
    }
    emit({ type: 'result', ...result })
    active.resolve(result)
  }

  const onNotification = (method, params) => {
    if (method === 'serverRequest/resolved') {
      serverRequests.get(params.requestId)?.abort()
      serverRequests.delete(params.requestId)
      return
    }
    if (method === 'thread/tokenUsage/updated' && (!threadId || params.threadId === threadId)) {
      if (!active && !forking) cumulativeUsage = params.tokenUsage?.total || cumulativeUsage
    }
    if (!active || active.done || (params.threadId && params.threadId !== threadId)) return
    const eventTurnId = params.turnId || params.turn?.id
    if (eventTurnId && active.id && eventTurnId !== active.id) return
    if (eventTurnId && !active.id) active.id = eventTurnId
    if (eventTurnId) telemetry?.bindTurn(active.evidenceSegmentId, eventTurnId)
    if (method === 'turn/started') emit({ type: 'status', status: 'running' })
    else if (method === 'turn/completed') {
      const status = params.turn.status
      finish(status === 'completed' ? 'completed' : status === 'interrupted' ? 'cancelled' : 'error',
        status === 'failed' ? params.turn.error?.message || 'Codex turn failed' : null)
    } else if (method === 'error') {
      emit({ type: 'error', message: params.error?.message || 'Codex error' })
    } else if (method === 'warning' || method === 'configWarning') {
      emit({ type: 'status', status: params.message || params.summary })
    } else if (method === 'thread/tokenUsage/updated') {
      // `last` measures active context; `total` accumulates billable usage.
      const snapshot = params.tokenUsage
      if (snapshot) {
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
        emit({ type: 'model_request_evidence', version: 2, provider: 'codex',
          kind: 'token_usage_snapshot', evidenceId: `${threadId}:${active.id}:${fingerprint}`,
          providerAgentId: threadId, observedAt: Date.now(), snapshot,
          provenance: 'codex app-server:thread/tokenUsage/updated',
          timingSemantics: 'snapshot_observed; not a unique request boundary' })
      }
      if (Number.isFinite(snapshot?.last?.totalTokens)) {
        emit({ type: 'context', context: {
          usedTokens: snapshot.last.totalTokens,
          maxTokens: snapshot.modelContextWindow,
        } })
      }
      // The total grows across turns within one app-server process. Subtract the
      // starting baseline. Totals from another process are not comparable: a
      // resumed thread can report a smaller total than the one saved earlier.
      const total = params.tokenUsage?.total
      if (total) {
        cumulativeUsage = total
        if (!active.baseline) {
          // Preserve the existing baseline estimate when no pre-turn total is
          // available. `last` is not evidence of a unique request boundary.
          active.baseline = {}
          for (const key of Object.keys(total)) {
            active.baseline[key] = Math.max(0, total[key] - (params.tokenUsage.last?.[key] || 0))
          }
        }
        const delta = {}
        for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'totalTokens']) {
          delta[key] = Math.max(0, (total[key] || 0) - (active.baseline?.[key] || 0))
        }
        active.usage = normalizeUsage(delta)
        emit({ type: 'usage', usage: active.usage })
      }
    } else if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
      const key = params.itemId
      const item = active.messages.get(key) || { text: '', phase: null }
      item.text += params.delta || ''
      active.messages.set(key, item)
      emit({ type: 'text', itemId: key, delta: true, text: params.delta || '' })
    } else if (method === 'item/reasoning/summaryTextDelta') {
      emit({ type: 'thinking', itemId: `${params.itemId}:${params.summaryIndex || 0}`, delta: true, text: params.delta || '' })
    } else if (method === 'item/commandExecution/outputDelta') {
      emit({ type: 'tool_call', itemId: params.itemId, outputDelta: params.delta || '' })
    } else if (method === 'turn/plan/updated') {
      emit({ type: 'plan', itemId: 'turn-plan', plan: params.plan, explanation: params.explanation })
    } else if (method === 'turn/diff/updated') {
      emit({ type: 'diff', itemId: 'turn-diff', diff: params.diff })
    } else if (method === 'model/rerouted') {
      emit({ type: 'status', status: `Model changed: ${params.fromModel} → ${params.toModel} (${params.reason})` })
    } else if (method === 'item/started' || method === 'item/completed') {
      const item = params.item
      if (!item) return
      active.items.set(item.id, item)
      const completed = method === 'item/completed'
      if (item.type === 'agentMessage' || item.type === 'plan') {
        if (!completed) return
        active.messages.set(item.id, { text: item.text || '', phase: item.phase })
        if (item.type === 'plan') active.plan = item.text
        emit({ type: 'text', itemId: item.id, replace: true, text: item.text || '' })
      } else if (item.type === 'reasoning' || item.type === 'userMessage') {
        return
      } else if (item.type === 'contextCompaction') {
        emit({ type: 'context', context: { usedTokens: null,
          status: completed ? 'awaiting_update' : 'compacting' } })
        emit({ type: 'status', status: completed ? 'Context compacted' : 'Compacting context' })
      } else {
        emit({ type: 'tool_call', itemId: item.id, name: item.tool || item.type,
          input: item.arguments || item.command || item.changes || item.query || item,
          status: item.status || (completed ? 'completed' : 'started'),
          output: item.aggregatedOutput ?? item.result ?? item.contentItems,
          error: item.error, exitCode: item.exitCode })
      }
    }
  }

  const ask = async (question, signal) => {
    if (signal.aborted) throw new Error('Codex request cancelled')
    if (typeof tools.askUser !== 'function') throw new Error('Human input is unavailable for this turn')
    return tools.askUser({ id: `q_${crypto.randomBytes(12).toString('hex')}`, ...question }, { signal })
  }

  const handleRequest = async ({ method, params }, signal) => {
    if (method === 'item/tool/requestUserInput') {
      const answers = {}
      for (const q of params.questions || []) {
        const value = await ask({ question: q.question, options: (q.options || []).map((o) => o.label),
          optionDescriptions: (q.options || []).map((o) => o.description || ''), secret: Boolean(q.isSecret) }, signal)
        answers[q.id] = { answers: (Array.isArray(value) ? value : [value]).map(String) }
      }
      return { answers }
    }
    if (method === 'item/tool/call') {
      if (params.tool !== ASK_TOOL_NAME) throw new Error(`Unsupported Codex dynamic tool: ${params.tool}`)
      const input = typeof params.arguments === 'string' ? JSON.parse(params.arguments) : params.arguments
      const value = await ask(input, signal)
      return { success: true, contentItems: [{ type: 'inputText', text: typeof value === 'string' ? value : JSON.stringify(value) }] }
    }
    const policy = providerMode('codex', active?.mode)
    const readOnly = tools.restrictedChild || policy.tools.permissions === 'deny'
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      if (tools.restrictedChild) return { decision: 'decline' }
      const command = method === 'item/commandExecution/requestApproval'
      // Codex uses commandExecution for reads too. Ask relies on its prompt
      // for command intent; restricted children still retain their sandbox.
      const action = command ? policy.tools.commands : policy.tools.fileChanges
      if (action === 'allow') return { decision: !params.availableDecisions || params.availableDecisions.includes('accept') ? 'accept' : 'decline' }
      if (action === 'deny') return { decision: 'decline' }
      const choices = (params.availableDecisions || ['accept', 'decline', 'cancel'])
        .filter((value) => typeof value === 'string' && ['accept', 'acceptForSession', 'decline', 'cancel'].includes(value))
      const labels = { accept: 'Allow once', acceptForSession: 'Allow for session', decline: 'Decline', cancel: 'Cancel turn' }
      const item = active?.items.get(params.itemId)
      const details = { command: params.command || item?.command, cwd: params.cwd,
        changes: item?.changes, grantRoot: params.grantRoot,
        network: params.networkApprovalContext, additionalPermissions: params.additionalPermissions }
      const value = await ask({ kind: 'approval', allowFreeText: false,
        question: params.reason || (params.networkApprovalContext ? 'Allow this network access?' : 'Approve this operation?'),
        details, options: choices.map((choice) => labels[choice]) }, signal)
      const decision = choices.find((choice) => labels[choice] === value)
      if (!decision) throw new Error('Invalid approval decision')
      return { decision }
    }
    if (method === 'item/permissions/requestApproval') {
      if (readOnly) return { permissions: {}, scope: 'turn' }
      const value = await ask({ kind: 'approval', allowFreeText: false, question: params.reason || 'Grant these permissions for this turn?',
        details: { cwd: params.cwd, permissions: params.permissions }, options: ['Allow for this turn', 'Decline'] }, signal)
      return { permissions: value === 'Allow for this turn' ? params.permissions : {}, scope: 'turn' }
    }
    if (method === 'mcpServer/elicitation/request') {
      if (harnessMcpNames.includes(params.serverName)) return { action: 'accept', content: params.mode === 'url' ? null : {} }
      const choice = await ask({ kind: 'approval', allowFreeText: false, question: params.message,
        details: params.mode === 'url' ? { url: params.url } : { schema: params.requestedSchema },
        options: ['Continue', 'Decline', 'Cancel'] }, signal)
      if (choice !== 'Continue') return { action: choice === 'Cancel' ? 'cancel' : 'decline', content: null }
      if (params.mode === 'url') return { action: 'accept', content: null }
      const value = await ask({ question: 'Enter the requested form values as JSON.', details: params.requestedSchema, options: [] }, signal)
      return { action: 'accept', content: typeof value === 'string' ? JSON.parse(value) : value }
    }
    throw new Error(`Unsupported Codex server request: ${method}`)
  }

  const onRequest = (message) => {
    const controller = new AbortController()
    serverRequests.set(message.id, controller)
    const task = requestQueue.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return undefined
      const p = message.params || {}
      if (!active || active.done || (p.threadId && p.threadId !== threadId) || (p.turnId && active.id && p.turnId !== active.id)) {
        throw new Error('No matching active Codex turn')
      }
      try {
        const result = await handleRequest(message, controller.signal)
        return controller.signal.aborted ? undefined : result
      } catch (err) {
        if (controller.signal.aborted) return undefined
        throw err
      } finally {
        serverRequests.delete(message.id)
      }
    })
    requestQueue = task
    return task
  }

  const connect = async (cwd) => {
    if (transport) return
    const env = { ...process.env }
    const home = config.codexHome || (config.codexApiKey ? path.join(writeDir, 'codex-api') : null)
    if (home) {
      fs.mkdirSync(home, { recursive: true, mode: 0o700 })
      env.CODEX_HOME = home
    }
    // Authenticate through app-server; don't pass an API key to agent shells.
    delete env.HARNESS_CODEX_API_KEY
    delete env.CODEX_API_KEY
    delete env.OPENAI_API_KEY
    if (config.codexRequestTelemetry && requestEvidence?.runId && requestEvidence?.sessionId) {
      telemetry = createCapture({ writeDir, ...requestEvidence })
    }
    transport = createTransport({ binary: config.codexBin, env, cwd, onNotification, onRequest, telemetry,
      onDiagnostic: (message) => {
        diagnostics.push(message)
        if (active && !active.done) emit({ type: 'status', status: `Codex diagnostic: ${message}` })
      },
      onFailure: (err) => finish('error', err.message) })
    await transport.start()
    if (config.codexApiKey) await transport.request('account/login/start', { type: 'apiKey', apiKey: config.codexApiKey })
    const account = await transport.request('account/read', { refreshToken: false })
    if (account.requiresOpenaiAuth && !account.account) {
      throw new Error('Codex is not signed in. Run codex login with the same CODEX_HOME, or configure HARNESS_CODEX_API_KEY.')
    }
  }

  const listModels = async () => {
    await connect()
    const models = []
    let cursor = null
    do {
      const page = await transport.request('model/list', { cursor, limit: 100, includeHidden: false })
      models.push(...page.data.map((m) => ({ id: m.model || m.id, displayName: m.displayName,
        isDefault: m.isDefault, defaultReasoningEffort: m.defaultReasoningEffort,
        supportedReasoningEfforts: m.supportedReasoningEfforts || [] })))
      cursor = page.nextCursor
    } while (cursor)
    if (!models.some((m) => m.id === GPT_61_SOL.id)) models.push({ ...GPT_61_SOL, supportedReasoningEfforts: GPT_61_SOL.supportedReasoningEfforts.map((effort) => ({ ...effort })) })
    return models.sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)))
  }

  const openThread = async (id, settings = {}, method = id ? 'thread/resume' : 'thread/start') => {
    if (Array.isArray(settings.tools)) {
      throw new Error('Codex does not support the Cursor tools allowlist. Use native plan mode for read-only decomposition.')
    }
    await connect(settings.cwd)
    const models = await listModels()
    const inheritModel = method === 'thread/fork' || settings.requireExisting
    const model = settings.model || (inheritModel ? undefined : models.find((m) => m.isDefault)?.id || models[0]?.id)
    if (!model && !inheritModel) throw new Error('No Codex models available')
    const entry = models.find((m) => m.id === model)
    if (model && !entry) throw new Error(`Codex model unavailable: ${model}`)
    if (options.reasoningEffort && entry && !entry.supportedReasoningEfforts.some((e) => e.reasoningEffort === options.reasoningEffort)) {
      throw new Error(`${model} does not support reasoning effort ${options.reasoningEffort}`)
    }
    selectedModel = model
    selectedEffort = options.reasoningEffort || settings.reasoningEffort || entry?.defaultReasoningEffort || null
    threadOptions = settings
    cumulativeUsage = null
    const params = { model, cwd: settings.cwd,
      sandbox: tools.restrictedChild ? 'read-only' : providerMode('codex', settings.mode).sandbox || options.sandbox,
      approvalPolicy: approvalFor(settings.mode, options.approvalPolicy),
      approvalsReviewer: 'user',
      config: {
        web_search: options.webSearch,
        ...(options.reasoningEffort || settings.reasoningEffort ? { model_reasoning_effort: options.reasoningEffort || settings.reasoningEffort } : {}),
        ...(tools.disableNativeSpawning ? { 'features.multi_agent': false } : {}),
        ...(harnessMcp.length ? { mcp_servers: Object.fromEntries(harnessMcp.map((server) => [server.name, { url: server.url }])) } : {}),
      },
      dynamicTools: typeof tools.askUser === 'function' ? [askTool({ model, mode: settings.logicalMode || settings.mode || 'agent' })] : [],
    }
    if (method === 'thread/fork') {
      // Fork inherits persisted dynamic tools; the fork RPC does not accept a
      // replacement dynamicTools list. Other provider configuration is reapplied.
      delete params.dynamicTools
      forkAttempted = true
      try {
        const response = await transport.request(method, { ...params, threadId: id, excludeTurns: true })
        const childId = response?.thread?.id
        if (typeof childId !== 'string' || !childId || childId === id) {
          throw new Error('Codex did not return an independent child thread id')
        }
        threadId = childId
        selectedModel = response.model || model
        selectedEffort = options.reasoningEffort || settings.reasoningEffort || response.reasoningEffort || null
        // Do not carry source totals into the child's first turn. The first
        // token update establishes the inherited baseline using total - last.
        cumulativeUsage = null
      } catch (cause) {
        throw Object.assign(new Error(`Codex fork outcome is unknown; do not retry automatically: ${cause.message}`, { cause }), {
          code: 'PROVIDER_FORK_OUTCOME_UNKNOWN', retryable: false, sourceProviderAgentId: id,
        })
      }
    } else {
      const response = await transport.request(method, id ? { ...params, threadId: id } : params)
      threadId = response.thread.id
      selectedModel = response.model || model
      selectedEffort = options.reasoningEffort || settings.reasoningEffort || response.reasoningEffort || selectedEffort
    }
  }

  const fork = async (sourceProviderAgentId, settings = {}) => {
    if (typeof sourceProviderAgentId !== 'string' || !sourceProviderAgentId.trim()) throw new Error('Codex fork requires a source thread id')
    if (threadId || active || forking || forkAttempted) throw new Error('Codex fork requires a fresh driver; do not retry an attempted fork')
    if (settings.childProviderAgentId != null) {
      throw Object.assign(new Error('Codex thread/fork does not support preallocated child ids'), { code: 'PROVIDER_FORK_ID_UNSUPPORTED' })
    }
    forking = true
    try {
      await openThread(sourceProviderAgentId, settings, 'thread/fork')
      return threadId
    } catch (err) {
      if (!forkAttempted) err.forkOutcome = 'not_created'
      throw err
    } finally {
      forking = false
    }
  }

  const send = async (prompt, { mode = 'agent', logicalMode = mode, onEvent, outputSchema, terse = false, instructions, evidenceSegmentId = crypto.randomUUID() } = {}) => {
    if (!threadId) throw new Error('Codex thread not created')
    if (active && !active.done) throw new Error('Codex turn already running')
    const wait = new Promise((resolve) => {
      active = { id: null, emit: onEvent || (() => {}), resolve, mode, evidenceSegmentId, startedAt: Date.now(), done: false,
        messages: new Map(), items: new Map(), plan: '', usage: null, baseline: cumulativeUsage }
    })
    telemetry?.startSegment({ segmentId: evidenceSegmentId, threadId, startedAt: active.startedAt })
    emit({ type: 'model_request_evidence', version: 2, provider: 'codex', kind: 'telemetry_capture',
      evidenceId: `${evidenceSegmentId}:telemetry`, captureId: telemetry?.id || null,
      providerAgentId: threadId, observedAt: Date.now(),
      captureStatus: telemetry ? 'configured' : 'disabled',
      provenance: 'codex OTLP JSON logs; existing harness API receiver',
      limitation: 'Exporter configuration is not proof of delivery or complete request coverage.' })
    const policy = providerMode('codex', mode)
    const sandbox = tools.restrictedChild ? 'read-only' : policy.sandbox || options.sandbox
    // Ask keeps shell reads available and injects the provider's no-change prompt.
    const text = composePrompt(prompt, { mode, logicalMode, model: selectedModel, terse, instructions, provider: 'codex' })
    for (const message of diagnostics) emit({ type: 'status', status: `Codex diagnostic: ${message}` })
    try {
      const response = await transport.request('turn/start', {
        threadId, input: [{ type: 'text', text, text_elements: [] }],
        model: selectedModel, cwd: threadOptions.cwd,
        effort: selectedEffort,
        approvalPolicy: approvalFor(mode, options.approvalPolicy),
        sandboxPolicy: sandbox === 'workspace-write'
          ? { type: 'workspaceWrite', writableRoots: [threadOptions.cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
          : { type: sandboxTypes[sandbox] },
        collaborationMode: { mode: policy.nativeMode, settings: {
          model: selectedModel, reasoning_effort: selectedEffort, developer_instructions: null,
        } },
        ...(outputSchema ? { outputSchema } : {}),
      })
      active.id = response.turn.id
      telemetry?.bindTurn(evidenceSegmentId, active.id)
    } catch (err) { finish('error', err.message) }
    const cancel = async () => {
      if (active.done) return
      clearRequests()
      active.cancelTimer = setTimeout(() => {
        finish('cancelled')
        transport.close().catch(() => {})
      }, 5000)
      try { await transport.request('turn/interrupt', { threadId, turnId: active.id }) }
      catch (err) { finish('error', err.message) }
    }
    return { cancel, wait: () => wait, runId: active.id, providerRunId: active.id }
  }

  const close = async () => {
    finish('cancelled')
    clearRequests()
    await transport?.close()
    transport = null
  }
  return { create: (settings) => openThread(null, settings), resume: openThread, fork,
    resolvedSettings: () => ({ model: selectedModel, reasoningEffort: selectedEffort }),
    send, listModels, providerAgentId: () => threadId, close }
}

module.exports = { createDriver }
