const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const config = require('../../config')
const { errorMessage } = require('../../store/formatError')
const { composePrompt } = require('../modes')

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
const ASK_DISALLOWED_TOOLS = ['edit', 'delete', 'shell', 'applyAgentDiff', 'task', 'generateImage']
const sdkMode = (mode) => mode === 'ask' ? 'agent' : mode
const modeOptions = (mode) => mode === 'ask' ? { disallowedTools: ASK_DISALLOWED_TOOLS } : {}

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

// Map a single SDK stream message to zero or more normalized events.
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
          name: block.name || 'tool',
          input: block.input || block.arguments || null,
          status: 'started',
          runId,
        })
      }
    }
    return
  }

  if (type === 'usage' && message.usage) {
    emit({ type: 'usage', usage: normalizeUsage(message.usage), runId })
    return
  }

  if (type === 'thinking') {
    if (message.text) emit({ type: 'thinking', itemId: segmentId(segment, runId, 'thinking'), delta: true, text: message.text, runId })
    return
  }

  if (type === 'tool_call') {
    segment.kind = null
    emit({ type: 'tool_call', itemId: message.call_id, name: message.name,
      input: message.args, output: message.result == null ? undefined : JSON.stringify(message.result), status: message.status, runId })
    return
  }

  if (type === 'result') {
    emit({ type: 'result', status: message.status, result: message.result, usage: normalizeUsage(message.usage), durationMs: message.durationMs, runId })
    return
  }

  if (message.usage) {
    emit({ type: 'usage', usage: normalizeUsage(message.usage), runId })
  }
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
    id: result?.id ?? null,
  }
}

const createDriver = ({ apiKey = config.cursorApiKey, tools = {}, transcriptFile, sdkStoreDir } = {}) => {
  let agent = null
  let sdk = null
  let selectedModel = null
  let resumed = false
  let transcriptError = null

  // Keep the unmodified SDK payload before normalization, including tool results
  // and thinking deltas. Append immediately so interrupted runs remain auditable.
  const record = (kind, payload) => {
    if (!transcriptFile) return
    try {
      fs.mkdirSync(path.dirname(transcriptFile), { recursive: true })
      const fd = fs.openSync(transcriptFile, 'a', 0o600)
      try {
        fs.writeFileSync(fd, `${JSON.stringify({ ts: Date.now(), kind, payload })}\n`)
        fs.fsyncSync(fd)
      } finally { fs.closeSync(fd) }
    } catch (err) {
      transcriptError = transcriptError || errorMessage(err)
    }
  }

  const ensureSdk = () => {
    if (!sdk) sdk = loadSdk()
    return sdk
  }

  // Compose the ask_user custom tool from a daemon-provided callback.
  const buildCustomTools = () => {
    if (typeof tools.askUser !== 'function') return undefined
    return {
      ask_user: {
        description:
          'Ask the human operator a question and wait for their answer. Use when you need a decision, clarification, or missing information.',
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
  const SUBAGENT_MODEL = { id: 'grok-4.7' }
  const subagents = () => ({
    generalPurpose: {
      description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
      prompt: 'You are a general-purpose coding agent. Complete the delegated task autonomously and report back concisely.',
      model: SUBAGENT_MODEL,
    },
    explore: {
      description: 'Fast agent for exploring codebases: finding files, searching code, and answering questions about the codebase.',
      prompt: 'You are a codebase exploration agent. Search and read code to answer the question. Do not edit files. Report findings concisely with file paths.',
      model: SUBAGENT_MODEL,
    },
  })

  const create = async ({ model, cwd, mode, tools, name } = {}) => {
    selectedModel = resolveModel(model)
    const { Agent } = ensureSdk()
    const includeCustom = !(Array.isArray(tools) && tools.length === 0)
    const local = { cwd: cwd || process.cwd(), ...localOptions({ includeCustom }) }
    const opts = {
      model: { id: selectedModel },
      mode: sdkMode(mode),
      local,
      agents: subagents(),
      ...modeOptions(mode),
    }
    if (name) opts.name = name
    if (apiKey) opts.apiKey = apiKey
    if (tools !== undefined) opts.tools = tools
    agent = await Agent.create(opts)
    return agent
  }

  const resume = async (providerAgentId, { model, cwd, mode, tools } = {}) => {
    resumed = true
    selectedModel = resolveModel(model)
    const { Agent } = ensureSdk()
    const includeCustom = !(Array.isArray(tools) && tools.length === 0)
    const opts = { local: { ...localOptions({ includeCustom }), ...(cwd ? { cwd } : {}) }, mode: sdkMode(mode), agents: subagents(), ...modeOptions(mode) }
    if (tools !== undefined) opts.tools = tools
    if (apiKey) opts.apiKey = apiKey
    agent = await Agent.resume(providerAgentId, opts)
    return agent
  }

  const send = async (prompt, { mode, onEvent, terse = false, instructions } = {}) => {
    if (!agent) throw new Error('cursor driver: agent not created')
    const emit = typeof onEvent === 'function' ? onEvent : () => {}
    // The caller holds the session lock. Any persisted active run belongs to a
    // dead prior daemon; force expires it without discarding its checkpoint.
    const options = { ...(mode ? { mode: sdkMode(mode) } : {}), ...(selectedModel ? { model: { id: selectedModel } } : {}),
      ...(resumed ? { local: { force: true } } : {}) }
    const text = composePrompt(prompt, { mode, terse, instructions })
    record('prompt', { prompt: text, options, providerAgentId: providerAgentId() })
    if (transcriptError) throw new Error(`Cannot start Cursor without an audit transcript: ${transcriptError}`)
    let run
    try {
      run = await agent.send(text, options)
    } catch (err) {
      record('error', { message: errorMessage(err), stack: err?.stack })
      throw err
    }
    const runId = run.id || null
    record('run', { runId, providerAgentId: providerAgentId() })
    let streamError = null
    const notify = (event) => {
      try { emit(event) } catch (err) { streamError = streamError || errorMessage(err) }
    }
    notify({ type: 'status', status: 'running', runId })

    const segment = { kind: null, seq: 0 }
    const streaming = (async () => {
      try {
        for await (const message of run.stream()) {
          record('message', message)
          mapMessage(message, notify, runId, segment)
        }
      } catch (err) {
        streamError = streamError || errorMessage(err)
        record('error', { runId, message: errorMessage(err), stack: err?.stack })
        notify({ type: 'error', message: errorMessage(err), runId })
      }
    })()

    const wait = async () => {
      await streaming
      let result
      try {
        result = await run.wait()
      } catch (err) {
        record('error', { runId, message: errorMessage(err), stack: err?.stack })
        result = { status: 'error', error: errorMessage(err), usage: run.usage || null, id: runId }
      }
      record('result', result)
      const normalized = normalizeResult(result)
      normalized.providerRunId = runId
      normalized.transcriptStatus = transcriptError || streamError ? 'incomplete' : 'complete'
      normalized.transcriptError = transcriptError || streamError
      if (normalized.transcriptError) {
        normalized.status = 'error'
        normalized.error = `Cursor audit incomplete: ${normalized.transcriptError}`
      }
      notify({ type: 'result', ...normalized, runId })
      if (streamError && !normalized.transcriptError) {
        normalized.transcriptStatus = 'incomplete'
        normalized.transcriptError = streamError
        normalized.status = 'error'
        normalized.error = `Cursor audit incomplete: ${streamError}`
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

  return { create, resume, send, listModels, providerAgentId, close }
}

module.exports = { createDriver }
