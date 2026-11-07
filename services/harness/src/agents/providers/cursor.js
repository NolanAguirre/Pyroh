const crypto = require('crypto')
const config = require('../../config')
const { errorMessage } = require('../../store/formatError')
const { composePromptWithProvenance } = require('../modes')
const { capture } = require('../../prompt/provenance')
const { providerMode } = require('../providerModes')
const prompts = require('../../prompts')

// Lazily require the SDK so that provider listing does not hard-fail when the
// dependency is not installed yet.
const loadSdk = () => require('@cursor/sdk')

const genQid = () => `q_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`

// Curated set shown in the UI model dropdown. IDs match Cursor SDK model slugs.
const CURSOR_MODELS = [
  { id: 'grok-4.7', displayName: 'Grok 4.7' },
  { id: 'grok-4.6', displayName: 'Grok 4.6' },
  { id: 'gpt-6.1-sol', displayName: 'GPT 6.1 Sol' },
  { id: 'claude-opus-4-8', displayName: 'Opus 4.8' },
  { id: 'claude-opus-5', displayName: 'Opus 5' },
  { id: 'claude-opus-5-5', displayName: 'Opus 5.5' },
  { id: 'claude-fable-5', displayName: 'Fable 5' },
  { id: 'claude-fable-5-1', displayName: 'Fable 5.1' },
  { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8' },
  { id: 'gemini-3.7-flash', displayName: 'Gemini 3.7' },
]

// The SDK only knows agent and plan. Ask runs as agent without mutating tools;
// "mcp" stays so the ask_user custom tool remains available.
const ASK_DISALLOWED_TOOLS = providerMode('cursor', 'ask').tools.disallowed
const sdkMode = (mode) => providerMode('cursor', mode).nativeMode
const modeOptions = (mode) => {
  const disallowedTools = providerMode('cursor', mode).tools.disallowed
  return disallowedTools.length ? { disallowedTools } : {}
}

// Build the local store handle for the SDK, keeping all state under the write-dir.
const buildStore = (sdk, sdkStoreDir) => {
  const Store = sdk.JsonlLocalAgentStore
  if (!Store || !sdkStoreDir) throw new Error('Cursor requires a persistent SDK store for this session')
  return new Store(sdkStoreDir)
}

// The SDK streams text and thinking as token chunks. Contiguous chunks of one
// kind share an item ID so the transcript merges them as deltas.
const segmentId = (segment, runId, kind) => {
  if (segment.kind !== kind) { segment.kind = kind; segment.seq += 1 }
  return `${runId}:${kind}:${segment.seq}`
}

// SDK inputTokens already include cache reads/writes; its totalTokens counts them twice.
const normalizeUsage = (usage) => usage ? {
  ...usage,
  totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
} : null

// Map a single SDK stream message to zero or more normalized events. Messages
// with no normalized form are kept whole as provider_message events.
const mapMessage = (message, emit, runId, segment = { kind: null, seq: 0 }) => {
  if (!message || typeof message !== 'object') return
  const type = message.type

  if (type === 'assistant' && message.message && Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text' && block.text) {
        emit({ type: 'text', itemId: segmentId(segment, runId, 'text'), delta: true, text: block.text, runId })
      } else if ((block.type === 'thinking' || block.type === 'reasoning') && (block.text || block.thinking)) {
        emit({ type: 'thinking', itemId: segmentId(segment, runId, 'thinking'), delta: true, text: block.text || block.thinking, runId })
      } else if (block.type === 'tool_use' || block.type === 'tool_call') {
        segment.kind = null
        emit({
          type: 'tool_call',
          toolUseId: block.id,
          name: block.name || 'tool',
          input: block.input || block.arguments || null,
          status: 'started',
          runId,
        })
      } else if (!block.type || !['text', 'thinking', 'reasoning'].includes(block.type)) {
        emit({ type: 'provider_message', message: block, runId })
      }
    }
    return
  }

  if (type === 'usage' && message.usage) {
    // SDK usage is per agent turn, which may contain multiple model calls.
    // Neither this notification nor the SDK request_id is a model-request ID.
    emit({ type: 'usage', usage: normalizeUsage(message.usage), runId })
    return
  }

  if (type === 'thinking') {
    if (message.text) {
      emit({ type: 'thinking', itemId: segmentId(segment, runId, 'thinking'), delta: true, text: message.text,
        thinkingDurationMs: message.thinking_duration_ms, runId })
    }
    return
  }

  if (type === 'tool_call') {
    segment.kind = null
    emit({ type: 'tool_call', itemId: message.call_id, name: message.name,
      input: message.args, output: message.result == null ? undefined : JSON.stringify(message.result), status: message.status,
      truncated: message.truncated, runId })
    return
  }

  if (type === 'result') {
    emit({ type: 'result', status: message.status, result: message.result, usage: normalizeUsage(message.usage), durationMs: message.durationMs, runId })
    return
  }

  if (message.usage) {
    emit({ type: 'usage', usage: normalizeUsage(message.usage), runId })
  }
  emit({ type: 'provider_message', message, runId })
}

const normalizeResult = (result) => {
  const failed = result?.status === 'error'
  const error = failed ? errorMessage(result?.error || result?.result || 'run failed') : null
  return {
    status: result?.status || 'unknown',
    result: result?.result ?? null,
    usage: normalizeUsage(result?.usage),
    durationMs: result?.durationMs ?? null,
    error,
    ...(result?.errorStack ? { errorStack: result.errorStack } : {}),
    id: result?.id ?? null,
    requestId: result?.requestId ?? null,
    model: result?.model ?? null,
    git: result?.git ?? null,
  }
}

const mcpOptions = (servers) => Array.isArray(servers) && servers.length
  ? { mcpServers: Object.fromEntries(servers.map((server) => [server.name, { type: 'http', url: server.url }])) }
  : {}

const createDriver = ({ apiKey = config.cursorApiKey, tools = {}, sdkStoreDir } = {}) => {
  const harnessMcp = mcpOptions(tools.mcpServers)
  const nativeOptions = (mode) => ({
    ...(tools.disableNativeSpawning ? {} : { agents: subagents() }),
    ...modeOptions(mode),
    ...(tools.disableNativeSpawning || tools.restrictedChild ? { disallowedTools: [...new Set([
      ...providerMode('cursor', mode).tools.disallowed, ...(tools.restrictedChild ? ASK_DISALLOWED_TOOLS : []), 'task',
    ])] } : {}),
  })
  let agent = null
  let sdk = null
  let selectedModel = null
  let selectedLogicalMode = 'agent'
  let resumed = false

  const ensureSdk = () => {
    if (!sdk) sdk = loadSdk()
    return sdk
  }

  // Compose the ask_user custom tool from a daemon-provided callback.
  const buildCustomTools = () => {
    if (typeof tools.askUser !== 'function') return undefined
    return {
      ask_user: {
        description: prompts.text('askUserCursor', 'cursor', { model: selectedModel, mode: selectedLogicalMode }),
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question to ask the operator.' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of suggested answers.',
            },
            allowMultiple: {
              type: 'boolean',
              description: 'Whether multiple options may be selected.',
            },
          },
          required: ['question'],
        },
        execute: async (input) => {
          const answer = await tools.askUser({
            id: genQid(),
            question: input.question,
            options: input.options || [],
            allowMultiple: Boolean(input.allowMultiple),
          })
          return typeof answer === 'string' ? answer : JSON.stringify(answer)
        },
      },
    }
  }

  const localOptions = ({ includeCustom = true } = {}) => {
    // "project" loads the workspace .cursor/rules. An empty list skips them.
    const opts = { settingSources: ['project'] }
    const store = buildStore(ensureSdk(), sdkStoreDir)
    if (store) opts.store = store
    if (includeCustom) {
      const customTools = buildCustomTools()
      if (customTools) opts.customTools = customTools
    }
    return opts
  }

  const resolveModel = (model) => model || CURSOR_MODELS[0].id

  // Custom definitions keyed by Task subagent_type. Built-in types otherwise
  // fall back to Cursor's runtime default model, not the parent's.
  // Names must not match Cursor's built-in subagent types (explore,
  // generalPurpose, etc.): the built-in wins and ignores our model.
  const subagents = () => ({
    generalPurpose: {
      description: prompts.text('subagentGeneralPurposeDescription', 'cursor', { model: selectedModel, mode: selectedLogicalMode }),
      prompt: prompts.text('subagentGeneralPurpose', 'cursor', { model: selectedModel, mode: selectedLogicalMode }),
      model: { id: selectedModel },
    },
    harnessExplore: {
      description: prompts.text('subagentExploreDescription', 'cursor', { model: selectedModel, mode: selectedLogicalMode }),
      prompt: prompts.text('subagentExplore', 'cursor', { model: 'grok-4.7', mode: selectedLogicalMode }),
      model: { id: 'grok-4.7' },
    },
  })

  const create = async ({ model, cwd, mode, logicalMode = mode || 'agent', tools, name } = {}) => {
    selectedModel = resolveModel(model)
    selectedLogicalMode = logicalMode
    const { Agent } = ensureSdk()
    const includeCustom = !(Array.isArray(tools) && tools.length === 0)
    const local = { cwd: cwd || process.cwd(), ...localOptions({ includeCustom }) }
    const opts = {
      model: { id: selectedModel },
      mode: sdkMode(mode),
      local,
      ...nativeOptions(mode),
      ...harnessMcp,
    }
    if (name) opts.name = name
    if (apiKey) opts.apiKey = apiKey
    if (tools !== undefined) opts.tools = tools
    agent = await Agent.create(opts)
    return agent
  }

  const resume = async (providerAgentId, { model, cwd, mode, logicalMode = mode || 'agent', tools } = {}) => {
    resumed = true
    selectedModel = resolveModel(model)
    selectedLogicalMode = logicalMode
    const { Agent } = ensureSdk()
    const includeCustom = !(Array.isArray(tools) && tools.length === 0)
    const opts = { local: { ...localOptions({ includeCustom }), ...(cwd ? { cwd } : {}) }, mode: sdkMode(mode), ...nativeOptions(mode), ...harnessMcp }
    if (tools !== undefined) opts.tools = tools
    if (apiKey) opts.apiKey = apiKey
    agent = await Agent.resume(providerAgentId, opts)
    return agent
  }

  const send = async (prompt, { mode, logicalMode = mode || selectedLogicalMode, onEvent, terse = false, instructions, promptProvenance } = {}) => {
    if (!agent) throw new Error('cursor driver: agent not created')
    const emit = typeof onEvent === 'function' ? onEvent : () => {}
    // The caller holds the session lock. Any persisted active run belongs to a
    // dead prior daemon; force expires it without discarding its checkpoint.
    const options = { ...(mode ? { mode: sdkMode(mode) } : {}), ...(selectedModel ? { model: { id: selectedModel } } : {}),
      ...(resumed ? { local: { force: true } } : {}) }
    const composed = composePromptWithProvenance(prompt, { mode, logicalMode, model: selectedModel, terse, instructions, provider: 'cursor', promptProvenance })
    const text = composed.text
    let streamError = null
    const notify = (event) => {
      try { emit(event) } catch (err) { streamError = streamError || errorMessage(err) }
    }
    // Callbacks may precede send() resolving. Keep one stable identity scope
    // rather than changing dedupe keys when the SDK run ID becomes available.
    const evidenceScopeId = crypto.randomUUID()
    let evidenceRunId = null
    let evidenceSequence = 0
    const seenEvidence = new Set()
    const evidence = (event) => notify({ version: 2, provider: 'cursor', evidenceScopeId,
      providerAgentId: providerAgentId(), providerRunId: evidenceRunId,
      observedAt: Date.now(), ...event })
    evidence({ type: 'model_request_evidence', kind: 'capture_started',
      evidenceId: `${evidenceScopeId}:capture`, provenance: '@cursor/sdk:onDelta' })
    options.onDelta = ({ update }) => {
      if (!update || typeof update !== 'object') return
      const { type, modelCallId, callId, stepId, stepDurationMs } = update
      if (['tool-call-started', 'tool-call-completed', 'partial-tool-call', 'tool-call-delta'].includes(type)) {
        if (typeof modelCallId !== 'string' || !modelCallId) return
        const key = JSON.stringify([type, modelCallId, callId])
        if (seenEvidence.has(key)) return
        seenEvidence.add(key)
        // Only the outer envelope belongs to this agent. taskUpdate contains
        // native subagent evidence and is deliberately not traversed.
        evidence({ type: 'model_request', requestId: modelCallId, status: 'observed',
          eventType: type, toolCallId: callId, usage: null,
          provenance: '@cursor/sdk:onDelta.modelCallId',
          timingSemantics: 'tool_event_observed; not model start/completion' })
      } else if (type === 'step-started' || type === 'step-completed') {
        if (!Number.isSafeInteger(stepId) || stepId < 0) return
        const key = `${type}:${stepId}`
        if (seenEvidence.has(key)) return
        seenEvidence.add(key)
        evidence({ type: 'model_request_evidence', kind: 'step', eventType: type, stepId,
          evidenceId: `${evidenceScopeId}:${key}`,
          durationMs: Number.isFinite(stepDurationMs) && stepDurationMs >= 0 ? stepDurationMs : null,
          provenance: '@cursor/sdk:onDelta', timingSemantics: 'conversation_step; not model request latency' })
      } else if (type === 'turn-ended') {
        evidence({ type: 'model_request_evidence', kind: 'turn_usage', eventType: type,
          evidenceId: `${evidenceScopeId}:turn:${++evidenceSequence}`,
          usage: update.usage || null, provenance: '@cursor/sdk:onDelta',
          timingSemantics: 'agent_turn_observed; may contain multiple model calls' })
      }
    }
    notify(capture(composed, { provider: 'cursor', options: { ...options, onDelta: undefined }, providerAgentId: providerAgentId() }))
    const run = await agent.send(text, options)
    const runId = run.id || null
    evidenceRunId = runId
    evidence({ type: 'model_request_evidence', kind: 'provider_run',
      evidenceId: `${evidenceScopeId}:run`, provenance: '@cursor/sdk:Run.id' })
    notify({ type: 'status', status: 'running', runId })

    const segment = { kind: null, seq: 0 }
    const streaming = (async () => {
      try {
        for await (const message of run.stream()) {
          mapMessage(message, notify, runId, segment)
        }
      } catch (err) {
        streamError = streamError || errorMessage(err)
        notify({ type: 'error', message: errorMessage(err), stack: err?.stack, runId })
      }
    })()

    const wait = async () => {
      await streaming
      let result
      try {
        result = await run.wait()
      } catch (err) {
        result = { status: 'error', error: errorMessage(err), errorStack: err?.stack, usage: run.usage || null, id: runId }
      }
      const normalized = normalizeResult({ ...result, usage: result?.usage || run.usage })
      normalized.providerRunId = runId
      normalized.transcriptStatus = streamError ? 'incomplete' : 'complete'
      normalized.transcriptError = streamError
      if (streamError) {
        normalized.status = 'error'
        normalized.error = `Cursor events incomplete: ${streamError}`
      }
      notify({ type: 'result', ...normalized, runId })
      if (streamError && !normalized.transcriptError) {
        normalized.transcriptStatus = 'incomplete'
        normalized.transcriptError = streamError
        normalized.status = 'error'
        normalized.error = `Cursor events incomplete: ${streamError}`
      }
      return normalized
    }

    const cancel = async () => {
      try {
        if (typeof run.supports === 'function' && !run.supports('cancel')) return
        await run.cancel()
      } catch {
        // best effort
      }
    }

    return { cancel, wait, runId, providerRunId: runId }
  }

  const listModels = async () => CURSOR_MODELS.map((m) => ({ ...m }))

  const providerAgentId = () => (agent ? agent.agentId || agent.agent_id || null : null)

  const close = async () => {
    if (!agent) return
    try {
      if (typeof agent[Symbol.asyncDispose] === 'function') {
        await agent[Symbol.asyncDispose]()
      } else if (typeof agent.close === 'function') {
        await agent.close()
      }
    } catch {
      // best effort
    }
    agent = null
  }

  const fork = async () => {
    throw Object.assign(new Error('Cursor native conversation fork is not supported by this driver'), { code: 'PROVIDER_FORK_UNSUPPORTED' })
  }

  return { create, resume, fork, send, listModels, providerAgentId, close,
    resolvedSettings: () => ({ model: selectedModel }) }
}

module.exports = { createDriver }
