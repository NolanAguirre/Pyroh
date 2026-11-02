const express = require('express')
const delegation = require('../harness/delegation')

const { tools } = require('../harness/delegationTools')

const router = express.Router()
router.use('/:token', (req, res, next) => {
  try { req.delegation = delegation.authenticate(req.params.token); next() }
  catch (err) { res.status(403).json({ error: err.message }) }
})
router.get('/:token', (_req, res) => res.status(405).end())
router.delete('/:token', (_req, res) => res.status(405).end())
router.post('/:token', async (req, res) => {
  const message = req.body
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return res.status(400).json({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } })
  }
  if (message.id == null) return res.status(202).end()
  const reply = (result) => res.json({ jsonrpc: '2.0', id: message.id, result })
  if (message.method === 'initialize') {
    const versions = ['2025-06-18', '2025-03-26', '2024-11-05']
    return reply({ protocolVersion: versions.includes(message.params?.protocolVersion) ? message.params.protocolVersion : versions[0],
      capabilities: { tools: {} }, serverInfo: { name: 'harness-agents', version: '1.0.0' } })
  }
  if (message.method === 'ping') return reply({})
  if (message.method === 'tools/list') return reply({ tools })
  if (message.method !== 'tools/call') return res.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
  try {
    const { name, arguments: args = {} } = message.params || {}
    const tool = tools.find(item => item.name === name)
    if (!tool) throw new Error('Unknown tool')
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object')
    for (const key of Object.keys(args)) if (!Object.hasOwn(tool.inputSchema.properties, key)) throw new Error(`Unknown argument: ${key}`)
    for (const key of tool.inputSchema.required) if (typeof args[key] !== 'string' || !args[key]) throw new Error(`${key} is required`)
    for (const [key, value] of Object.entries(args)) {
      const schema = tool.inputSchema.properties[key]
      if (typeof value !== schema.type || (schema.enum && !schema.enum.includes(value))) throw new Error(`Invalid ${key}`)
    }
    const result = await delegation[name](req.delegation, args)
    return reply({ content: [{ type: 'text', text: JSON.stringify(result) }] })
  } catch (err) {
    return reply({ isError: true, content: [{ type: 'text', text: err.message }] })
  }
})
module.exports = router
