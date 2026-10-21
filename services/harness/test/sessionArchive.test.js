const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const config = require('../src/config')
const workspaces = require('../src/store/workspaceStore')
const sessions = require('../src/store/sessionStore')
const paths = require('../src/store/paths')
const { createApp } = require('../src/server')

test('archive persists, filters both list routes, and restores without deleting logs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-archive-'))
  const previous = config.writeDir
  config.writeDir = dir
  const server = createApp().listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  try {
    const workspace = workspaces.createWorkspace({ name: 'vpr', cwd: dir }, dir)
    const session = sessions.createSession({ workspaceId: workspace.id, provider: 'cursor' }, dir)
    const logFile = paths.daemonLog(session.id, dir)
    fs.writeFileSync(logFile, 'preserved log')
    const patch = archived => fetch(`${base}/sessions/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }),
    })
    assert.equal((await patch('true')).status, 400)
    assert.equal((await patch(true)).status, 200)
    assert.equal(sessions.loadSession(session.id, dir).archived, true)
    sessions.updateSession(session.id, { status: 'finished' }, dir)
    for (const route of ['/sessions', `/workspaces/${workspace.id}/sessions`]) {
      assert.equal((await (await fetch(base + route)).json()).sessions.length, 0)
      assert.equal((await (await fetch(base + route + '?includeArchived=true')).json()).sessions[0].id, session.id)
    }
    assert.equal((await fetch(`${base}/sessions/${session.id}`)).status, 200)
    assert.equal(fs.readFileSync(logFile, 'utf8'), 'preserved log')
    await patch(false)
    const named = await fetch(`${base}/sessions/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '  Plan review  ' }),
    })
    assert.equal(named.status, 200)
    assert.equal((await named.json()).session.name, 'Plan review')
    assert.equal(sessions.loadSession(session.id, dir).name, 'Plan review')
    const cleared = await fetch(`${base}/sessions/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '   ' }),
    })
    assert.equal((await cleared.json()).session.name, null)
    assert.equal((await fetch(`${base}/sessions/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 4 }),
    })).status, 400)
    assert.equal((await (await fetch(base + '/sessions')).json()).sessions.length, 1)
    assert.equal(sessions.loadSession(session.id, dir).status, 'finished')
    assert.equal((await fetch(`${base}/sessions/missing`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"archived":true}',
    })).status, 404)
  } finally {
    await new Promise(resolve => server.close(resolve))
    config.writeDir = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
