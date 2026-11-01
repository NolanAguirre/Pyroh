const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const runIndexStore = require('./runIndexStore')
const { readJson, writeJson, ensureDir } = require('./jsonFile')
const { loadSession } = require('./sessionRecord')
const { persistRecordPrompt, readRecordPrompt } = require('./recordPrompt')

const writePlan = (sessionId, runId, text, writeDir) => {
  const file = paths.planFile(sessionId, runId, writeDir)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text || '')
  return file
}

const writeSourcePlan = (sessionId, text, writeDir) => {
  const file = paths.sourcePlanFile(sessionId, writeDir)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text || '')
  return file
}

const readSourcePlan = (sessionId, writeDir) => {
  try {
    return fs.readFileSync(paths.sourcePlanFile(sessionId, writeDir), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

const writePhases = (sessionId, data, writeDir) => writeJson(paths.phasesFile(sessionId, writeDir), data)

const readPhases = (sessionId, writeDir) => readJson(paths.phasesFile(sessionId, writeDir), null)

const writePhasePlan = (sessionId, phase, text, writeDir) => {
  const file = paths.phasePlanFile(sessionId, phase, writeDir)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text || '')
  return file
}

const readPhasePlan = (sessionId, phase, writeDir) => {
  try {
    return fs.readFileSync(paths.phasePlanFile(sessionId, phase, writeDir), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

const writeStepRun = (sessionId, { phase, stepId }, record, writeDir) => {
  const file = paths.stepRunFile(sessionId, phase, stepId, writeDir)
  const stored = persistRecordPrompt(file, record)
  writeJson(file, stored)
  runIndexStore.recordRun(stored, loadSession(sessionId, writeDir), writeDir, file)
  return stored
}

const loadStepRun = (sessionId, { phase, stepId }, writeDir) =>
  readJson(paths.stepRunFile(sessionId, phase, stepId, writeDir), null)

const readStepRunPrompt = (sessionId, { phase, stepId }, writeDir) => {
  const file = paths.stepRunFile(sessionId, phase, stepId, writeDir)
  return readRecordPrompt(loadStepRun(sessionId, { phase, stepId }, writeDir), file)
}

const writeStepArtifact = (sessionId, { phase, filename }, text, writeDir) => {
  const file = paths.stepWriteFile(sessionId, phase, filename, writeDir)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text || '')
  return file
}

module.exports = {
  writePlan,
  writeSourcePlan,
  readSourcePlan,
  writePhases,
  readPhases,
  writePhasePlan,
  readPhasePlan,
  writeStepRun,
  loadStepRun,
  readStepRunPrompt,
  writeStepArtifact,
}
