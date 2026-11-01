const express = require('express')
const store = require('../store')

const router = express.Router()

router.use(express.json({ limit: '1mb' }))

const sendError = (res, err) => {
  if (err && err.httpStatus) return res.status(err.httpStatus).json({ error: err.message })
  console.error(err)
  res.status(500).json({ error: err && err.message ? err.message : String(err) })
}

const route = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (err) {
    sendError(res, err)
  }
}

const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {})

const noStore = (res) => res.set('Cache-Control', 'no-store')

const queryId = (value) => (typeof value === 'string' && value ? value : undefined)

router.get('/memories', route(async (req, res) => {
  noStore(res)
  const memories = await store.listMemories({
    sourceSessionId: queryId(req.query.sourceSessionId),
    memorySessionId: queryId(req.query.memorySessionId),
  })
  res.json({ memories })
}))

router.get('/memories/:id', route(async (req, res) => {
  noStore(res)
  res.json(await store.findMemory(req.params.id))
}))

router.post('/memories', route(async (req, res) => {
  const { title, content, evidence, sourceSessionId, memorySessionId } = bodyOf(req)
  res.status(201).json(await store.createMemory({ title, content, evidence, sourceSessionId, memorySessionId }))
}))

router.patch('/memories/:id', route(async (req, res) => {
  const { title, content, evidence } = bodyOf(req)
  res.json(await store.updateMemory(req.params.id, { title, content, evidence }))
}))

router.delete('/memories/:id', route(async (req, res) => {
  await store.deleteMemory(req.params.id)
  res.status(204).end()
}))

module.exports = router
