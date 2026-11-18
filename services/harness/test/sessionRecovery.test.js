const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const config = require('../src/config')
const workspaces = require('../src/store/workspaceStore')
const sessions = require('../src/store/sessionStore')
const paths = require('../src/store/paths')
const sessionIndex = require('../src/store/sessionIndex')
const { writeJson } = require('../src/store/jsonFile')

const startupError = "Cannot find module 'nats'"
const genericError = 'Worker exited before the agent started. Check the daemon log for startup errors.'

for (const scenario of [
  { name: 'cancelled transport request', state: 'cancelled', expected: `Agent spawn failed: ${startupError}` },
  { name: 'worker rejection', state: 'failed', expected: `Agent spawn failed: ${startupError}` },
  { name: 'receipt for another run', state: 'failed', otherRun: true, expected: genericError },
  { name: 'reply for another request', state: 'failed', otherRequest: true, expected: genericError },
  { name: 'successful spawn', state: 'launched', expected: genericError },
  { name: 'legacy run without receipt', expected: genericError },
  { name: 'agent already started', state: 'failed', pid: 123, expected: 'Daemon stopped before this run completed. Check the daemon log for details.' },
]) {
  test(`recovery reports the correct error for ${scenario.name}`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-recovery-'))
    const previous = config.writeDir
    config.writeDir = dir
    // Keep the production SQLite mirror untouched; exercise real session/run files.
    t.mock.method(sessionIndex, 'upsert', () => {})
    try {
      const workspace = workspaces.createWorkspace({ name: 'recovery', cwd: dir }, dir)
      const session = sessions.createSession({ workspaceId: workspace.id, provider: 'cursor' }, dir)
      const run = sessions.createRun(session.id, { mode: 'agent', prompt: 'test' }, dir)
      sessions.updateSession(session.id, { status: 'running' }, dir)
      if (scenario.pid) sessions.updateRun(session.id, run.id, { pid: scenario.pid }, dir)
      if (scenario.state) writeJson(path.join(paths.sessionDir(session.id, dir), 'spawn-request.json'), {
        version: 1, requestId: 'request', sessionId: session.id, state: scenario.state,
        args: ['run', session.id, '--run-id', scenario.otherRun ? 'another_run' : run.id],
        reply: {
          version: 1, requestId: scenario.otherRequest ? 'another_request' : 'request', sessionId: session.id,
          ok: scenario.state === 'launched', error: { message: startupError },
        },
      })
      const lock = require('../src/store/sessionLock').acquire(session.id, dir)
      try { sessions.recoverSession(session.id, dir) }
      finally { lock.release() }
      assert.equal(sessions.loadRun(session.id, run.id, dir).error, scenario.expected)
      assert.equal(sessions.loadSession(session.id, dir).lastError.message, scenario.expected)
      const events = fs.readFileSync(paths.eventsFile(session.id, dir), 'utf8').trim().split('\n').map(JSON.parse)
      assert.equal(events.at(-1).message, scenario.expected)
    } finally {
      config.writeDir = previous
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}
