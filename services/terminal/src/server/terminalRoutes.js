const express = require('express')
const terminalStore = require('../store/terminalStore')
const groupStore = require('../store/groupStore')
const startup = require('../store/startup')

const router = express.Router()

const route = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (err) {
    if (err && err.httpStatus) return res.status(err.httpStatus).json({ error: err.message })
    console.error(err)
    res.status(500).json({ error: err && err.message ? err.message : String(err) })
  }
}

const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {})

const wantsAll = (query) => query.all === '1' || query.all === 'true'

router.get('/groups', route(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ groups: groupStore.list(req.query.workspace, { all: wantsAll(req.query) }) })
}))

router.post('/groups', route(async (req, res) => {
  const { workspace, name } = bodyOf(req)
  res.status(201).json({ group: groupStore.create({ workspace, name }) })
}))

router.get('/', route(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ terminals: terminalStore.list(req.query.workspace, { all: wantsAll(req.query) }) })
}))

router.post('/', route(async (req, res) => {
  const { workspace, cols, rows, groupId } = bodyOf(req)
  if (typeof groupId === 'string' && groupId.trim()) {
    groupStore.ensure({ workspace, id: groupId })
  }
  res.status(201).json({ terminal: await terminalStore.create({ workspace, cols, rows, groupId }) })
}))

router.get('/startup', route(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ text: startup.read() })
}))

router.put('/startup', route(async (req, res) => {
  const { text } = bodyOf(req)
  if (typeof text !== 'string') {
    res.status(400).json({ error: 'text must be a string' })
    return
  }
  const saved = startup.write(text)
  const terminals = await terminalStore.runStartup()
  res.json({ text: saved, terminals })
}))

router.patch('/:id', route(async (req, res) => {
  const body = bodyOf(req)
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name')
  const hasGroup = Object.prototype.hasOwnProperty.call(body, 'groupId')
  if (!hasName && !hasGroup) {
    res.status(400).json({ error: 'name or groupId is required' })
    return
  }
  let terminal = null
  if (hasName) terminal = terminalStore.rename(req.params.id, body.name)
  if (hasGroup) {
    terminal = terminalStore.setGroup(req.params.id, body.groupId)
    if (terminal.groupId) groupStore.ensure({ workspace: terminal.workspaceId, id: terminal.groupId })
  }
  res.json({ terminal })
}))

router.post('/:id/auto-name', route(async (req, res) => {
  res.json(terminalStore.autoName(req.params.id, bodyOf(req).result))
}))

router.delete('/:id', route(async (req, res) => {
  await terminalStore.kill(req.params.id)
  res.status(204).end()
}))

module.exports = router
