const { createTransport } = require('./transport')

const AUTH_REQUIRED = -32000
const METHOD_NOT_FOUND = -32601
const CANCELLED = { outcome: { outcome: 'cancelled' } }

// Agent Client Protocol (ACP) client for `grok agent stdio`. Model and
// reasoning effort are fixed when the process is spawned; sessions can still
// change them through setConfigOption.
const createGrokClient = ({ bin, model, reasoningEffort, env = process.env, onPermission, onFailure, timeoutMs } = {}) => {
  const listeners = new Map()
  const loading = new Set()
  const permissions = new Set()
  let init = null
  let authenticated = false

  const onNotification = (method, params) => {
    if (method !== 'session/update' || params._meta?.isReplay || loading.has(params.sessionId)) return
    listeners.get(params.sessionId)?.(params.update || {}, params._meta || {})
  }

  const onRequest = async ({ method, params }) => {
    if (method !== 'session/request_permission') {
      throw Object.assign(new Error(`Unsupported Grok agent request: ${method}`), { code: METHOD_NOT_FOUND })
    }
    if (typeof onPermission !== 'function') return CANCELLED
    const controller = new AbortController()
    permissions.add(controller)
    try {
      const result = await onPermission(params, controller.signal)
      return controller.signal.aborted ? CANCELLED : result
    } catch (err) {
      if (controller.signal.aborted) return CANCELLED
      throw err
    } finally {
      permissions.delete(controller)
    }
  }

  const transport = createTransport({
    bin, env, onNotification, onRequest, onFailure, timeoutMs,
    args: ['agent', '--no-leader',
      ...(model ? ['--model', model] : []),
      ...(reasoningEffort ? ['--reasoning-effort', reasoningEffort] : []),
      'stdio'],
  })

  const initialize = async () => {
    if (init) return init
    transport.start()
    init = await transport.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'local_harness', title: 'Harness', version: '0.1.0' },
    })
    return init
  }

  const authenticate = async (methodId = 'cached_token') => {
    try {
      await transport.request('authenticate', { methodId })
      authenticated = true
    } catch (err) {
      throw new Error(`Grok is not signed in (${err.message}). Run grok login.`, { cause: err })
    }
  }

  const withAuth = async (call) => {
    try {
      return await call()
    } catch (err) {
      const needsAuth = err.code === AUTH_REQUIRED || /auth\w* required|unauthori[sz]ed|not (signed|logged) in/i.test(err.message)
      if (authenticated || !needsAuth) throw err
      await authenticate('cached_token')
      return call()
    }
  }

  const models = async () => {
    await initialize()
    const state = init._meta?.modelState || {}
    return { currentModelId: state.currentModelId || null, availableModels: state.availableModels || [] }
  }

  const newSession = async ({ cwd, mcpServers = [] }) => {
    await initialize()
    return withAuth(() => transport.request('session/new', { cwd, mcpServers }))
  }

  const loadSession = async (sessionId, { cwd, mcpServers = [] }) => {
    loading.add(sessionId)
    try {
      return await withAuth(() => transport.request('session/load', { sessionId, cwd, mcpServers }))
    } finally {
      loading.delete(sessionId)
    }
  }

  const resumeSession = async (sessionId, { cwd, mcpServers = [] }) => {
    await initialize()
    const caps = init.agentCapabilities || {}
    if (!caps.sessionCapabilities?.resume) {
      if (!caps.loadSession) throw new Error('Grok agent cannot resume sessions')
      return loadSession(sessionId, { cwd, mcpServers })
    }
    try {
      return await withAuth(() => transport.request('session/resume', { sessionId, cwd, mcpServers }))
    } catch (err) {
      if (err.code !== METHOD_NOT_FOUND || !caps.loadSession) throw err
      return loadSession(sessionId, { cwd, mcpServers })
    }
  }

  const setMode = (sessionId, modeId) => transport.request('session/set_mode', { sessionId, modeId })

  const setConfigOption = (sessionId, configId, value) =>
    transport.request('session/set_config_option', { sessionId, configId, value })

  const prompt = async (sessionId, text, onUpdate) => {
    if (listeners.has(sessionId)) throw new Error('Grok prompt already running')
    listeners.set(sessionId, onUpdate || (() => {}))
    try {
      return await transport.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, { timeoutMs: 0 })
    } finally {
      listeners.delete(sessionId)
    }
  }

  // ACP requires pending permission requests to resolve as cancelled.
  const cancel = (sessionId) => {
    for (const controller of permissions) controller.abort()
    transport.notify('session/cancel', { sessionId })
  }

  const close = () => {
    for (const controller of permissions) controller.abort()
    listeners.clear()
    return transport.close()
  }

  return {
    initialize, authenticate, models, newSession, resumeSession,
    setMode, setConfigOption, prompt, cancel, close,
    agentInfo: () => init,
  }
}

module.exports = { createGrokClient }
