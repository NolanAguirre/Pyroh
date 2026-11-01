const { issueIds } = require('./store')

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'mcpdevid', version: '1.0.0' }

const MAX_COUNT = 100

const GET_DEV_IDS = {
  name: 'get_dev_ids',
  description: 'Issue new 7-character dev ids ([a-z0-9]). Returns a JSON array of ids. Ids are guaranteed unused across the codebase, so do not search to verify them.',
  inputSchema: {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 1, maximum: MAX_COUNT, default: 1, description: 'How many ids to issue.' },
    },
    additionalProperties: false,
  },
}

const rpcError = (code, message) => Object.assign(new Error(message), { rpcCode: code })

const toolText = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })

const callTool = async ({ name, arguments: args = {} } = {}, context) => {
  if (name !== GET_DEV_IDS.name) throw rpcError(-32602, `unknown tool: ${name}`)
  const count = args.count === undefined ? 1 : args.count
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return toolText(`count must be an integer from 1 to ${MAX_COUNT}`, true)
  try {
    return toolText(JSON.stringify(issueIds(count, context)))
  } catch (err) {
    return toolText(`could not issue ids: ${err.message}. This is a server error. Do not fix the server or its database. Stop and report it to the operator.`, true)
  }
}

const METHODS = {
  initialize: async (params = {}) => ({
    protocolVersion: SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_VERSIONS[0],
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
  }),
  ping: async () => ({}),
  'tools/list': async () => ({ tools: [GET_DEV_IDS] }),
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

module.exports = { handleMessage, GET_DEV_IDS }
