const { writeMemory } = require('./store')

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'mcp-memory', version: '1.0.0' }

const CREATE_MEMORY = {
  name: 'create_memory',
  description: 'Record one proposed memory extracted from the transcript. Call once per durable memory.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short name for the memory.' },
      content: { type: 'string', description: 'The memory itself, written so it stands on its own.' },
      evidence: { type: 'string', description: 'Optional transcript reference or quote supporting the memory.' },
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
}

const rpcError = (code, message) => Object.assign(new Error(message), { rpcCode: code })

const toolText = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })

const callTool = async ({ name, arguments: args = {} }, context) => {
  if (name !== CREATE_MEMORY.name) throw rpcError(-32602, `unknown tool: ${name}`)
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  const content = typeof args.content === 'string' ? args.content.trim() : ''
  if (!title || !content) return toolText('title and content are required', true)
  const evidence = typeof args.evidence === 'string' && args.evidence.trim() ? args.evidence.trim() : null
  try {
    return toolText(JSON.stringify(await writeMemory({ ...context, title, content, evidence })))
  } catch (err) {
    return toolText(`could not write memory: ${err.message}`, true)
  }
}

const METHODS = {
  initialize: async (params = {}) => ({
    protocolVersion: SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_VERSIONS[0],
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
  }),
  ping: async () => ({}),
  'tools/list': async () => ({ tools: [CREATE_MEMORY] }),
  'tools/call': callTool,
}

// One JSON-RPC message in, one response out. Notifications get no response.
const handleMessage = async (message, context) => {
  const isRequest = message && message.id !== undefined && message.id !== null
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return isRequest ? { jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'invalid request' } } : null
  }
  if (!isRequest) return null
  const method = METHODS[message.method]
  if (!method) return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } }
  try {
    return { jsonrpc: '2.0', id: message.id, result: await method(message.params, context) }
  } catch (err) {
    return { jsonrpc: '2.0', id: message.id, error: { code: err.rpcCode || -32603, message: err.message } }
  }
}

module.exports = { handleMessage, CREATE_MEMORY }
