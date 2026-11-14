import api from '../../api'

const descriptor = (value, depth = 0) => {
  if (depth > 6 || value == null) return null
  if (typeof value === 'string') {
    try {
      return descriptor(JSON.parse(value), depth + 1)
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const view = descriptor(item, depth + 1)
      if (view) return view
    }
    return null
  }
  if (typeof value !== 'object' || value.isError) return null
  if (value.type === 'harness_view' && value.version === 1 && value.view === 'terminal'
    && typeof value.resourceId === 'string' && value.resourceId
    && typeof value.workspaceId === 'string' && typeof value.sessionId === 'string'
    && typeof value.command === 'string' && typeof value.cwd === 'string') return value
  for (const key of ['structuredContent', 'content', 'result', 'text']) {
    const view = descriptor(value[key], depth + 1)
    if (view) return view
  }
  return null
}

export const terminalView = (event, sessionId, workspaceId) => {
  const name = String(event.name || '')
  if (!/(^|__|[./])terminal_prepare$/.test(name) || event.error
    || ['started', 'in_progress', 'error', 'failed'].includes(event.status)) return null
  const view = descriptor(event.output)
  return view ? api.adoptTerminalView(view, sessionId, workspaceId) : null
}
