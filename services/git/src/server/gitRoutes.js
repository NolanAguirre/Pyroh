const express = require('express')
const gitRepo = require('../store/gitRepo')

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

router.get('/status', route(async (req, res) => {
  noStore(res)
  res.json(await gitRepo.status({ workspace: req.query.workspace }))
}))

router.get('/branches', route(async (req, res) => {
  noStore(res)
  res.json(await gitRepo.branches({ workspace: req.query.workspace }))
}))

router.get('/diff', route(async (req, res) => {
  noStore(res)
  const { workspace, path, origPath, staged } = req.query
  res.json(await gitRepo.diff({ workspace, path, origPath, staged }))
}))

router.get('/log', route(async (req, res) => {
  noStore(res)
  res.json(await gitRepo.log({ workspace: req.query.workspace, limit: req.query.limit }))
}))

router.post('/checkout', route(async (req, res) => {
  const { workspace, branch, create, startPoint } = bodyOf(req)
  res.json(await gitRepo.checkout({ workspace, branch, create, startPoint }))
}))

router.post('/stage', route(async (req, res) => {
  const { workspace, paths } = bodyOf(req)
  res.json(await gitRepo.stage({ workspace, paths }))
}))

router.post('/unstage', route(async (req, res) => {
  const { workspace, paths } = bodyOf(req)
  res.json(await gitRepo.unstage({ workspace, paths }))
}))

router.post('/discard', route(async (req, res) => {
  const { workspace, paths } = bodyOf(req)
  res.json(await gitRepo.discard({ workspace, paths }))
}))

router.post('/commit', route(async (req, res) => {
  const { workspace, message, amend } = bodyOf(req)
  res.json(await gitRepo.commit({ workspace, message, amend }))
}))

router.post('/push', route(async (req, res) => {
  const { workspace, force } = bodyOf(req)
  res.json(await gitRepo.push({ workspace, force }))
}))

router.post('/pull', route(async (req, res) => {
  res.json(await gitRepo.pull({ workspace: bodyOf(req).workspace }))
}))

router.post('/fetch', route(async (req, res) => {
  res.json(await gitRepo.fetch({ workspace: bodyOf(req).workspace }))
}))

module.exports = router
