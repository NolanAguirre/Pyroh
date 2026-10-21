const crypto = require('crypto')
const config = require('../../config')
const { normalizeClaudeOptions } = require('./claudeOptions')
const { composePrompt } = require('../modes')

const CLIENT_APP = 'harness/0.1.0'

let sdkModule = null
const loadSdk = () => {
  sdkModule = sdkModule || import('@anthropic-ai/claude-agent-sdk').catch((err) => {
    sdkModule = null
    throw new Error(`Claude Agent SDK unavailable (${err.message}). Run npm install in services/harness.`)
  })
  return sdkModule
}

// Anthropic reports cache reads/writes separately; harness input totals include them.
const normalizeUsage = (usage) => {
  if (!usage) return null
  const cacheReadTokens = usage.cache_read_input_tokens || 0
  const cacheWriteTokens = usage.cache_creation_input_tokens || 0
  const inputTokens = (usage.input_tokens || 0) + cacheReadTokens + cacheWriteTokens
  const outputTokens = usage.output_tokens || 0
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens: inputTokens + outputTokens }
}

const contextTokens = (usage) => usage
  ? (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0)
  : 0

const blockText = (content) => {
  if (!Array.isArray(content)) return content
  const text = content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
  return text || content
}

const sessionModel = (model) => model && model !== 'default' ? model : undefined

// Streaming input keeps stdin open so interrupts and permission callbacks work mid-turn.
const createInput = () => {
  const queue = []
  const waiters = []
  let closed = false
  const flush = () => {
    while (waiters.length && (queue.length || closed)) {
      const resolve = waiters.shift()
      resolve(queue.length ? { value: queue.shift(), done: false } : { value: undefined, done: true })
    }
  }
  const push = (message) => {
    if (closed) return
    queue.push(message)
    flush()
  }
  const end = () => {
    closed = true
    flush()
  }
  const iterable = {
    next: () => new Promise((resolve) => {
      waiters.push(resolve)
      flush()
    }),
    return: () => {
      end()
      return Promise.resolve({ value: undefined, done: true })
    },
    [Symbol.asyncIterator]: () => iterable,
  }
  return { push, end, iterable }
}

const ruleString = (rule) => rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName

// Session-scoped grants live only in one Claude Code process, and each turn
// spawns a new one, so replay them as query options.
const grantedOptions = (granted) => {
  const allowedTools = []
  const additionalDirectories = []
  let mode = null
  for (const update of granted) {
    if (['addRules', 'replaceRules'].includes(update.type) && update.behavior === 'allow') {
      allowedTools.push(...(update.rules || []).map(ruleString))
    } else if (update.type === 'addDirectories') {
      additionalDirectories.push(...(update.directories || []))
    } else if (update.type === 'setMode' && update.mode === 'acceptEdits') {
      mode = update.mode
    }
  }
  return {
    mode,
    options: {
      ...(allowedTools.length ? { allowedTools: [...new Set(allowedTools)] } : {}),
      ...(additionalDirectories.length ? { additionalDirectories: [...new Set(additionalDirectories)] } : {}),
    },
  }
}

const createDriver = ({ tools = {}, claude = {}, permissions = [], onPermissions } = {}) => {
  const options = normalizeClaudeOptions(claude)
  let granted = Array.isArray(permissions) ? permissions : []
  let sessionId = null
  let resumable = false
  let settings = {}
  let stream = null
  let input = null
  let active = null
  let contextWindow = null
  const diagnostics = []

  const emit = (event) => active?.emit({ ...event, runId: active.id })

  const withDiagnostics = (message) => diagnostics.length
    ? `${message}\n${diagnostics.slice(-5).join('\n')}`
    : message

  const finish = (status, error = null) => {
    if (!active || active.done) return
    active.done = true
    clearTimeout(active.cancelTimer)
    input?.end()
    const result = {
      status,
      result: active.result ?? [...active.texts.values()].join('\n\n'),
      usage: active.usage,
      durationMs: Date.now() - active.startedAt,
      error,
    }
    emit({ type: 'result', ...result })
    active.resolve(result)
  }

  const closeStream = () => {
    input?.end()
    try { stream?.close() } catch { /* already closed */ }
    stream = null
  }

  const baseOptions = () => ({
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    ...(config.claudeBin ? { pathToClaudeCodeExecutable: config.claudeBin } : {}),
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP },
    stderr: (data) => {
      for (const line of String(data).split('\n')) if (line.trim()) diagnostics.push(line)
      diagnostics.splice(0, Math.max(0, diagnostics.length - 20))
    },
  })

  const ask = (question, signal) =>
    tools.askUser({ id: `q_${crypto.randomBytes(12).toString('hex')}`, ...question }, { signal })

  const canUseTool = async (toolName, toolInput = {}, context = {}) => {
    const { signal } = context
    const deny = (message) => ({ behavior: 'deny', message })
    if (!active || active.done) return { behavior: 'deny', message: 'No active harness turn', interrupt: true }
    if (toolName === 'ExitPlanMode' && active.mode === 'plan') {
      active.planToolUseId = context.toolUseID
      active.result = typeof toolInput.plan === 'string' ? toolInput.plan : JSON.stringify(toolInput)
      return deny('The harness recorded this plan. Stop now without implementing it.')
    }
    if (typeof tools.askUser !== 'function') return deny('No operator is available to answer or approve this request.')
    try {
      if (toolName === 'AskUserQuestion') {
        const answers = {}
        for (const item of toolInput.questions || []) {
          const choices = item.options || []
          const value = await ask({
            question: item.question,
            options: choices.map((choice) => choice.label),
            optionDescriptions: choices.map((choice) => choice.description || ''),
            allowMultiple: Boolean(item.multiSelect),
          }, signal)
          answers[item.question] = Array.isArray(value) ? value.join(', ') : String(value)
        }
        return { behavior: 'allow', updatedInput: { ...toolInput, answers } }
      }
      const sessionRules = context.suppressAlwaysAllowRule ? []
        : (context.suggestions || []).map((rule) => ({ ...rule, destination: 'session' }))
      const value = await ask({
        kind: 'approval',
        allowFreeText: false,
        question: context.title || `Allow ${context.displayName || toolName}?`,
        details: { tool: toolName, input: toolInput, description: context.description,
          blockedPath: context.blockedPath, reason: context.decisionReason },
        options: ['Allow once', ...(sessionRules.length ? ['Allow for session'] : []), 'Deny'],
      }, signal)
      if (value === 'Allow once') return { behavior: 'allow', updatedInput: toolInput }
      if (value === 'Allow for session') {
        granted = [...granted, ...sessionRules]
        try { onPermissions?.(granted) } catch { /* still applies to this process */ }
        return { behavior: 'allow', updatedInput: toolInput, updatedPermissions: sessionRules }
      }
      return deny('The operator denied this tool call.')
    } catch (err) {
      return { behavior: 'deny', message: err.message, interrupt: Boolean(signal?.aborted) }
    }
  }

  const onStreamEvent = (turn, event) => {
    if (event.type === 'message_start') {
      turn.seq += 1
      turn.messageId = event.message?.id || `${turn.id}:${turn.seq}`
    } else if (event.type === 'content_block_delta') {
      const itemId = `${turn.messageId}:${event.index}`
      if (event.delta?.type === 'text_delta') {
        turn.texts.set(itemId, (turn.texts.get(itemId) || '') + event.delta.text)
        emit({ type: 'text', itemId, delta: true, text: event.delta.text })
      } else if (event.delta?.type === 'thinking_delta') {
        emit({ type: 'thinking', itemId, delta: true, text: event.delta.thinking })
      }
    }
  }

  const onSystem = (turn, message) => {
    if (message.subtype === 'init') {
      turn.model = message.model
      emit({ type: 'status', status: `Claude Code ${message.claude_code_version} · ${message.model} · ${message.permissionMode}` })
    } else if (message.subtype === 'status' && message.status === 'compacting') {
      emit({ type: 'context', context: { usedTokens: null, status: 'compacting' } })
      emit({ type: 'status', status: 'Compacting context' })
    } else if (message.subtype === 'compact_boundary') {
      const post = message.compact_metadata?.post_tokens
      emit({ type: 'context', context: { usedTokens: post ?? null, maxTokens: contextWindow,
        status: post == null ? 'awaiting_update' : 'reported' } })
      emit({ type: 'status', status: 'Context compacted' })
    } else if (message.subtype === 'api_retry') {
      emit({ type: 'status', status: `Claude API retry ${message.attempt}/${message.max_retries}`
        + (message.error_status ? ` (HTTP ${message.error_status})` : '') })
    }
  }

  const onResult = (turn, message) => {
    const usage = normalizeUsage(message.usage)
    if (usage) {
      turn.usage = usage
      emit({ type: 'usage', usage })
    }
    const models = message.modelUsage || {}
    const windowSize = models[turn.model]?.contextWindow
      || Math.max(0, ...Object.values(models).map((entry) => entry.contextWindow || 0))
    if (windowSize) contextWindow = windowSize
    if (turn.lastContext) emit({ type: 'context', context: { usedTokens: turn.lastContext, maxTokens: contextWindow } })
    if (turn.result == null && message.structured_output !== undefined) turn.result = JSON.stringify(message.structured_output)
    if (turn.result == null && message.subtype === 'success' && message.result) turn.result = message.result
    if (turn.cancelRequested) return finish('cancelled')
    if (message.subtype === 'success' && !message.is_error) return finish('completed')
    finish('error', (message.errors || []).join('\n') || message.result || `Claude stopped: ${message.subtype}`)
  }

  const onMessage = (turn, message) => {
    if (message.type === 'stream_event') {
      if (!message.parent_tool_use_id) onStreamEvent(turn, message.event || {})
    } else if (message.type === 'assistant') {
      for (const block of message.message?.content || []) {
        if (!['tool_use', 'server_tool_use', 'mcp_tool_use'].includes(block.type)) continue
        emit({ type: 'tool_call', itemId: block.id, name: block.name, input: block.input, status: 'started' })
        if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
          emit({ type: 'plan', itemId: `${turn.id}:todos`,
            plan: block.input.todos.map((todo) => ({ step: todo.content, status: todo.status })) })
        }
      }
      const used = message.parent_tool_use_id ? 0 : contextTokens(message.message?.usage)
      if (used) {
        turn.lastContext = used
        emit({ type: 'context', context: { usedTokens: used, maxTokens: contextWindow } })
      }
    } else if (message.type === 'user' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result') continue
        if (block.tool_use_id && block.tool_use_id === turn.planToolUseId) {
          emit({ type: 'tool_call', itemId: block.tool_use_id, status: 'completed' })
          continue
        }
        const output = blockText(block.content)
        emit({ type: 'tool_call', itemId: block.tool_use_id, status: block.is_error ? 'error' : 'completed',
          output, ...(block.is_error ? { error: typeof output === 'string' ? output : 'Tool failed' } : {}) })
      }
    } else if (message.type === 'system') {
      onSystem(turn, message)
    } else if (message.type === 'result') {
      onResult(turn, message)
    }
  }

  const consume = async (source, turn) => {
    try {
      for await (const message of source) {
        if (turn.done) break
        onMessage(turn, message)
        if (turn.done) break
      }
      if (turn === active && !turn.done) {
        finish(turn.cancelRequested ? 'cancelled' : 'error',
          turn.cancelRequested ? null : withDiagnostics('Claude Code exited before finishing the turn'))
      }
    } catch (err) {
      if (turn === active) {
        finish(turn.cancelRequested ? 'cancelled' : 'error', turn.cancelRequested ? null : withDiagnostics(err.message))
      }
    }
  }

  const listModels = async () => {
    const { query } = await loadSdk()
    const probeInput = createInput()
    const probe = query({ prompt: probeInput.iterable, options: { ...baseOptions(), persistSession: false } })
    try {
      const models = await probe.supportedModels()
      return models.map((m) => ({
        id: m.value,
        displayName: m.displayName,
        description: m.description,
        isDefault: m.value === 'default',
        defaultReasoningEffort: null,
        supportedReasoningEfforts: (m.supportedEffortLevels || []).map((effort) => ({ reasoningEffort: effort })),
      })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    } finally {
      probeInput.end()
      try { probe.close() } catch { /* already closed */ }
    }
  }

  const openSession = async (id, next = {}) => {
    if (Array.isArray(next.tools) && next.tools.length) {
      throw new Error('Claude does not support the Cursor tools allowlist. Use plan mode for read-only work.')
    }
    settings = next
    if (!id) {
      sessionId = crypto.randomUUID()
      resumable = false
      return
    }
    sessionId = id
    // A turn that failed before Claude wrote its transcript leaves nothing to resume.
    const { getSessionInfo } = await loadSdk()
    resumable = Boolean(await getSessionInfo(id).catch(() => true))
  }

  const send = async (prompt, { mode = 'agent', onEvent, outputSchema, terse = false, instructions } = {}) => {
    if (!sessionId) throw new Error('Claude session not created')
    if (active && !active.done) throw new Error('Claude turn already running')
    const { query } = await loadSdk()
    const wait = new Promise((resolve) => {
      const id = `claude_${crypto.randomBytes(8).toString('hex')}`
      active = { id, emit: onEvent || (() => {}), resolve, mode, startedAt: Date.now(), done: false,
        texts: new Map(), messageId: `${id}:0`, seq: 0, usage: null, result: null, model: null,
        lastContext: 0, cancelRequested: false, planToolUseId: null }
    })
    const turn = active
    const grants = grantedOptions(granted)
    const configuredMode = options.permissionMode || 'bypassPermissions'
    const permissionMode = mode === 'plan' ? 'plan'
      : configuredMode === 'default' ? grants.mode || 'default' : configuredMode
    input = createInput()
    // Claude Code has no ask mode; ask is the default permission mode plus an instruction.
    const content = composePrompt(prompt, { mode, terse, instructions })
    input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null })
    const source = query({ prompt: input.iterable, options: {
      ...baseOptions(),
      ...(resumable ? { resume: sessionId } : { sessionId }),
      model: sessionModel(settings.model),
      cwd: settings.cwd,
      permissionMode,
      ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
      ...grants.options,
      ...(Array.isArray(settings.tools) ? { tools: [] } : {}),
      ...(outputSchema ? { outputFormat: { type: 'json_schema', schema: outputSchema } } : {}),
      includePartialMessages: true,
      canUseTool,
    } })
    stream = source
    resumable = true
    emit({ type: 'status', status: 'running' })
    consume(source, turn)
    const cancel = async () => {
      if (turn.done) return
      turn.cancelRequested = true
      const force = () => {
        finish('cancelled')
        closeStream()
      }
      turn.cancelTimer = setTimeout(force, 5000)
      try { await source.interrupt() } catch { force() }
    }
    return { cancel, wait: () => wait, runId: turn.id, providerRunId: turn.id }
  }

  const close = async () => {
    finish('cancelled')
    closeStream()
  }

  return { create: (next) => openSession(null, next), resume: openSession,
    send, listModels, providerAgentId: () => sessionId, close }
}

module.exports = { createDriver }
