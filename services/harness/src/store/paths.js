const fs = require('fs')
const path = require('path')
const config = require('../config')

const uiSettingsFile = (writeDir = config.writeDir) => path.join(writeDir, 'ui.json')

const tokenWasteIndexDir = (writeDir = config.writeDir) => path.join(writeDir, 'token-waste-runs')
const runIndexDir = (writeDir = config.writeDir) => path.join(writeDir, 'run-index')

const workspacesDir = (writeDir = config.writeDir) => path.join(writeDir, 'workspaces')

const workspaceDir = (workspaceId, writeDir = config.writeDir) =>
  path.join(workspacesDir(writeDir), workspaceId)

const workspaceFile = (workspaceId, writeDir = config.writeDir) =>
  path.join(workspaceDir(workspaceId, writeDir), 'workspace.json')

const sessionsDir = (workspaceId, writeDir = config.writeDir) =>
  path.join(workspaceDir(workspaceId, writeDir), 'sessions')

const legacySessionsDir = (writeDir = config.writeDir) => path.join(writeDir, 'sessions')

const indexKey = (writeDir, sessionId) => `${writeDir}\0${sessionId}`

const sessionIndex = new Map()

const rememberSession = (sessionId, workspaceId, writeDir = config.writeDir) => {
  const dir = path.join(sessionsDir(workspaceId, writeDir), sessionId)
  sessionIndex.set(indexKey(writeDir, sessionId), { workspaceId, dir })
  return dir
}

const rememberLegacySession = (sessionId, writeDir = config.writeDir) => {
  const dir = path.join(legacySessionsDir(writeDir), sessionId)
  sessionIndex.set(indexKey(writeDir, sessionId), { workspaceId: null, dir })
  return dir
}

const clearSessionIndex = () => sessionIndex.clear()

const hasSessionJson = (dir) => {
  try {
    return fs.statSync(path.join(dir, 'session.json')).isFile()
  } catch {
    return false
  }
}

const readWorkspaceNames = (writeDir) => {
  try {
    return fs.readdirSync(workspacesDir(writeDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const locateSession = (sessionId, writeDir = config.writeDir) => {
  const key = indexKey(writeDir, sessionId)
  const hit = sessionIndex.get(key)
  if (hit && hasSessionJson(hit.dir)) return hit

  for (const workspaceId of readWorkspaceNames(writeDir)) {
    const dir = path.join(sessionsDir(workspaceId, writeDir), sessionId)
    if (hasSessionJson(dir)) {
      const loc = { workspaceId, dir }
      sessionIndex.set(key, loc)
      return loc
    }
  }

  const legacyDir = path.join(legacySessionsDir(writeDir), sessionId)
  if (hasSessionJson(legacyDir)) {
    const loc = { workspaceId: null, dir: legacyDir }
    sessionIndex.set(key, loc)
    return loc
  }

  return null
}

const sessionDir = (sessionId, writeDir = config.writeDir, workspaceId) => {
  if (workspaceId) return rememberSession(sessionId, workspaceId, writeDir)
  const cached = sessionIndex.get(indexKey(writeDir, sessionId))
  if (cached) return cached.dir
  const loc = locateSession(sessionId, writeDir)
  if (loc) return loc.dir
  return path.join(legacySessionsDir(writeDir), sessionId)
}

const sessionFile = (sessionId, writeDir = config.writeDir, workspaceId) =>
  path.join(sessionDir(sessionId, writeDir, workspaceId), 'session.json')

const runsDir = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'runs')

const runFile = (sessionId, runId, writeDir = config.writeDir) =>
  path.join(runsDir(sessionId, writeDir), `${runId}.json`)

const runPromptFile = (sessionId, runId, writeDir = config.writeDir) =>
  path.join(runsDir(sessionId, writeDir), `${runId}.prompt.txt`)

const runTranscriptFile = (sessionId, runId, writeDir = config.writeDir) =>
  path.join(runsDir(sessionId, writeDir), `${runId}.cursor.jsonl`)

const planFile = (sessionId, runId, writeDir = config.writeDir) =>
  path.join(runsDir(sessionId, writeDir), `${runId}.plan.md`)

const eventsFile = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'events.jsonl')

const daemonLog = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'daemon.log')

const daemonPid = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'daemon.pid')

const controlFile = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'control.json')

const questionsDir = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'questions')

const questionFile = (sessionId, qid, writeDir = config.writeDir) =>
  path.join(questionsDir(sessionId, writeDir), `${qid}.json`)

const answerFile = (sessionId, qid, writeDir = config.writeDir) =>
  path.join(questionsDir(sessionId, writeDir), `${qid}.answer.json`)

const steerDir = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'steer')

const sdkStoreDir = (writeDir = config.writeDir) => path.join(writeDir, 'sdk-store')

const legacySessionSdkStoreDir = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'sdk-store')

const sessionSdkStoreDir = (sessionId, writeDir = config.writeDir) => {
  const loc = locateSession(sessionId, writeDir)
  const parent = loc?.workspaceId ? workspaceDir(loc.workspaceId, writeDir) : writeDir
  return path.join(parent, 'sdk-store', sessionId)
}

const sourcePlanFile = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'source-plan.md')

const phasesFile = (sessionId, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), 'phases.json')

const phaseDir = (sessionId, phase, writeDir = config.writeDir) =>
  path.join(sessionDir(sessionId, writeDir), `phase-${phase}`)

const phasePlanFile = (sessionId, phase, writeDir = config.writeDir) =>
  path.join(phaseDir(sessionId, phase, writeDir), 'plan.md')

const stepRunFile = (sessionId, phase, stepId, writeDir = config.writeDir) => {
  const dir = phase ? phaseDir(sessionId, phase, writeDir) : sessionDir(sessionId, writeDir)
  return path.join(dir, `${stepId}.json`)
}

const stepPromptFile = (sessionId, phase, stepId, writeDir = config.writeDir) => {
  const dir = phase ? phaseDir(sessionId, phase, writeDir) : sessionDir(sessionId, writeDir)
  return path.join(dir, `${stepId}.prompt.txt`)
}

const stepWriteFile = (sessionId, phase, filename, writeDir = config.writeDir) => {
  const dir = phase ? phaseDir(sessionId, phase, writeDir) : sessionDir(sessionId, writeDir)
  return path.join(dir, filename)
}

module.exports = {
  uiSettingsFile,
  tokenWasteIndexDir,
  runIndexDir,
  workspacesDir,
  workspaceDir,
  workspaceFile,
  sessionsDir,
  legacySessionsDir,
  rememberSession,
  rememberLegacySession,
  clearSessionIndex,
  locateSession,
  sessionDir,
  sessionFile,
  runsDir,
  runFile,
  runPromptFile,
  runTranscriptFile,
  planFile,
  eventsFile,
  daemonLog,
  daemonPid,
  controlFile,
  questionsDir,
  questionFile,
  answerFile,
  steerDir,
  sdkStoreDir,
  sessionSdkStoreDir,
  legacySessionSdkStoreDir,
  sourcePlanFile,
  phasesFile,
  phaseDir,
  phasePlanFile,
  stepRunFile,
  stepPromptFile,
  stepWriteFile,
}
