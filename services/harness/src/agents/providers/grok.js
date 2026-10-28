const crypto = require('crypto')
const config = require('../../config')
const { createGrokClient } = require('../grok')
const { normalizeGrokOptions } = require('./grokOptions')
const { composePrompt } = require('../modes')

const CANCELLED = { outcome: { outcome: 'cancelled' } }

// Grok's input count includes cached tokens and its output count includes reasoning.
const normalizeUsage = (usage) => usage ? {
  inputTokens: usage.inputTokens || 0,
  outputTokens: usage.outputTokens || 0,
  cacheReadTokens: usage.cachedReadTokens || 0,
  cacheWriteTokens: usage.cacheCreationTokens || 0,
  reasoningTokens: usage.reasoningTokens || 0,
  totalTokens: usage.totalTokens ?? ((usage.inputTokens || 0) + (usage.outputTokens || 0)),
} : null

// Grok has no ask mode. Ask runs in default mode, which runs read-only tools
// without asking, and onPermission rejects everything else. If the user's Grok
// config always approves or has allow rules covering edits, no request arrives.
const grokMode = (mode) => mode === 'plan' ? 'plan' : 'default'

const stopStatus = (reason) => reason === 'end_turn' ? 'completed' : reason === 'cancelled' ? 'cancelled' : 'error'

const toolOutput = (update) => {
  const content = Array.isArray(update.content) ? update.content : []
  const text = content
    .filter((item) => item.type === 'content' && item.content?.type === 'text')
    .map((item) => item.content.text)
    .join('\n')
  if (text) return text
  return update.rawOutput ?? (content.length ? content : undefined)
}

const createDriver = ({ tools = {}, grok = {}, bin = config.grokBin } = {}) => {
  const options = normalizeGrokOptions(grok)
  let client = null
  let sessionId = null
  let currentMode = null
  let active = null

  const emit = (event) => active?.emit({ ...event, runId: active.id })

  const finish = (status, error = null) => {
    if (!active || active.done) return
    active.done = true
    clearTimeout(active.cancelTimer)
    const result = {
      status,
      result: active.messages.filter(Boolean).join('\n\n'),
      usage: active.usage,
      durationMs: Date.now() - active.startedAt,
      error,
    }
    emit({ type: 'result', ...result })
    active.resolve(result)
  }

  const onPermission = async (params, signal) => {
    if (!active || active.done || params.sessionId !== sessionId) return CANCELLED
    const choices = params.options || []
    const selected = (choice) => ({ outcome: { outcome: 'selected', optionId: choice.optionId } })
    if (active.mode === 'ask' || typeof tools.askUser !== 'function') {
      const reject = choices.find((choice) => String(choice.kind || '').startsWith('reject'))
      return reject ? selected(reject) : CANCELLED
    }
    const call = params.toolCall || {}
    const value = await tools.askUser({
      id: `q_${crypto.randomBytes(12).toString('hex')}`,
      kind: 'approval',
      allowFreeText: false,
      question: call.title || 'Approve this operation?',
      details: { kind: call.kind, input: call.rawInput, locations: call.locations },
      options: choices.map((choice) => choice.name),
    }, { signal })
    const choice = choices.find((entry) => entry.name === value)
    if (!choice) throw new Error('Invalid approval decision')
    return selected(choice)
  }

  const onUpdate = (update) => {
    if (!active || active.done) return
    const kind = update.sessionUpdate
    const text = update.content?.type === 'text' ? update.content.text || '' : ''
    if (kind === 'agent_message_chunk') {
      if (active.last !== 'message') active.message += 1
      active.last = 'message'
      active.messages[active.message] = (active.messages[active.message] || '') + text
      emit({ type: 'text', itemId: `${active.id}:message:${active.message}`, delta: true, text })
    } else if (kind === 'agent_thought_chunk') {
      if (active.last !== 'thought') active.thought += 1
      active.last = 'thought'
      emit({ type: 'thinking', itemId: `${active.id}:thought:${active.thought}`, delta: true, text })
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      active.last = 'tool'
      emit({ type: 'tool_call', itemId: update.toolCallId, name: update.title || update.kind,
        input: update.rawInput, status: update.status, output: toolOutput(update) })
    } else if (kind === 'plan') {
      active.last = 'plan'
      emit({ type: 'plan', itemId: `${active.id}:plan`,
        plan: (update.entries || []).map((entry) => ({ step: entry.content, status: entry.status })) })
    } else if (kind === 'usage_update') {
      emit({ type: 'context', context: { usedTokens: update.used, maxTokens: update.size } })
    } else if (kind === 'current_mode_update') {
      currentMode = update.currentModeId
      emit({ type: 'status', status: `Mode: ${update.currentModeId}` })
    }
  }

  const connect = async (model = null) => {
    if (client) return
    client = createGrokClient({
      bin, model, reasoningEffort: options.reasoningEffort, onPermission,
      onFailure: (err) => finish('error', err.message),
    })
    await client.initialize()
  }

  const listModels = async () => {
    await connect()
    const { currentModelId, availableModels } = await client.models()
    return availableModels.map((m) => {
      const efforts = m._meta?.reasoningEfforts || []
      return {
        id: m.modelId,
        displayName: m.name,
        isDefault: m.modelId === currentModelId,
        defaultReasoningEffort: efforts.find((effort) => effort.default)?.value || null,
        supportedReasoningEfforts: efforts.map((effort) => ({ reasoningEffort: effort.value, description: effort.description })),
      }
    }).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
  }

  const applyMode = async (mode) => {
    const next = grokMode(mode)
    if (next === currentMode) return
    await client.setMode(sessionId, next)
    currentMode = next
  }

  const openSession = async (id, settings = {}) => {
    if (Array.isArray(settings.tools) && settings.tools.length) {
      throw new Error('Grok does not support the Cursor tools allowlist. Use native plan mode for read-only decomposition.')
    }
    await connect(settings.model)
    const models = await listModels()
    const model = settings.model || models.find((m) => m.isDefault)?.id || models[0]?.id
    if (!model) throw new Error('No Grok models available')
    const entry = models.find((m) => m.id === model)
    if (!entry) throw new Error(`Grok model unavailable: ${model}`)
    if (options.reasoningEffort && !entry.supportedReasoningEfforts.some((e) => e.reasoningEffort === options.reasoningEffort)) {
      throw new Error(`${model} does not support reasoning effort ${options.reasoningEffort}`)
    }
    const response = id
      ? await client.resumeSession(id, { cwd: settings.cwd })
      : await client.newSession({ cwd: settings.cwd })
    sessionId = id || response.sessionId
    // Resumed sessions keep their stored model and effort; spawn flags only seed new sessions.
    if (settings.model && response?.models?.currentModelId !== settings.model) {
      await client.setConfigOption(sessionId, 'model', settings.model)
    }
    if (id && options.reasoningEffort) await client.setConfigOption(sessionId, 'reasoning_effort', options.reasoningEffort)
    currentMode = null
    await applyMode(settings.mode)
  }

  const send = async (prompt, { mode = 'agent', onEvent, terse = false, instructions } = {}) => {
    if (!sessionId) throw new Error('Grok session not created')
    if (active && !active.done) throw new Error('Grok turn already running')
    await applyMode(mode)
    const wait = new Promise((resolve) => {
      active = { id: `grok_${crypto.randomBytes(8).toString('hex')}`, emit: onEvent || (() => {}), resolve, mode,
        startedAt: Date.now(), done: false, messages: [], message: -1, thought: -1, last: null, usage: null }
    })
    const turn = active
    emit({ type: 'status', status: 'running' })
    client.prompt(sessionId, composePrompt(prompt, { mode, terse, instructions }), onUpdate).then((response) => {
      if (turn !== active) return
      const usage = normalizeUsage(response?._meta?.usage)
      if (usage) {
        turn.usage = usage
        emit({ type: 'usage', usage })
      }
      const reason = response?.stopReason
      finish(stopStatus(reason), stopStatus(reason) === 'error' ? `Grok stopped: ${reason || 'unknown reason'}` : null)
    }, (err) => {
      if (turn === active) finish('error', err.message)
    })
    const cancel = async () => {
      if (turn.done) return
      turn.cancelTimer = setTimeout(() => {
        finish('cancelled')
        client?.close().catch(() => {})
      }, 5000)
      try { client.cancel(sessionId) } catch (err) { finish('error', err.message) }
    }
    return { cancel, wait: () => wait, runId: turn.id, providerRunId: turn.id }
  }

  const close = async () => {
    finish('cancelled')
    await client?.close()
    client = null
  }

  return { create: (settings) => openSession(null, settings), resume: openSession,
    send, listModels, providerAgentId: () => sessionId, close }
}

module.exports = { createDriver }
