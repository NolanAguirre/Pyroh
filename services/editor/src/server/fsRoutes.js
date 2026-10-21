const express = require('express')
const fileSystem = require('../store/fileSystem')

const router = express.Router()

router.use(express.json({ limit: '16mb' }))

const CODE_ERRORS = {
  ENOENT: [404, 'Not found'],
  ENOTDIR: [404, 'Not found'],
  EEXIST: [409, 'Already exists'],
  ENOTEMPTY: [409, 'Already exists'],
  EISDIR: [400, 'Not a file'],
  EINVAL: [400, 'Invalid path'],
  ENAMETOOLONG: [400, 'Name too long'],
  EACCES: [403, 'Permission denied'],
  EPERM: [403, 'Permission denied'],
}

const sendError = (res, err) => {
  if (err && err.httpStatus) {
    return res.status(err.httpStatus).json({ error: err.message, ...err.extra })
  }
  const mapped = err && CODE_ERRORS[err.code]
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] })
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

router.get('/search', route(async (req, res) => {
  noStore(res)
  res.json(await fileSystem.search({ workspace: req.query.workspace, query: req.query.q }))
}))

router.get('/list', route(async (req, res) => {
  noStore(res)
  res.json(await fileSystem.listDir({ workspace: req.query.workspace, path: req.query.path }))
}))

router.get('/file', route(async (req, res) => {
  noStore(res)
  res.json(await fileSystem.readFile({ workspace: req.query.workspace, path: req.query.path }))
}))

router.get('/raw', route(async (req, res) => {
  const filePath = await fileSystem.mediaPath({ workspace: req.query.workspace, path: req.query.path })
  noStore(res)
  res.sendFile(filePath, { dotfiles: 'allow' }, (err) => {
    if (!err) return
    if (res.headersSent) console.error(err)
    else sendError(res, err)
  })
}))

router.put('/file', route(async (req, res) => {
  const { workspace, path, content, mtime } = bodyOf(req)
  res.json(await fileSystem.writeFile({ workspace, path, content, mtime }))
}))

router.post('/file', route(async (req, res) => {
  const { workspace, path } = bodyOf(req)
  res.status(201).json(await fileSystem.createFile({ workspace, path }))
}))

router.post('/dir', route(async (req, res) => {
  const { workspace, path } = bodyOf(req)
  res.status(201).json(await fileSystem.createDir({ workspace, path }))
}))

router.post('/rename', route(async (req, res) => {
  const { workspace, from, to } = bodyOf(req)
  res.json(await fileSystem.rename({ workspace, from, to }))
}))

router.delete('/', route(async (req, res) => {
  await fileSystem.remove({ workspace: req.query.workspace, path: req.query.path })
  res.status(204).end()
}))

module.exports = router
