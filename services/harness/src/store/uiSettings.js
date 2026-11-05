const paths = require('./paths')
const { readJson, writeJson } = require('./jsonFile')

const MIN_TRANSCRIPT_FONT_SIZE = 12
const MAX_TRANSCRIPT_FONT_SIZE = 24
const DEFAULT_TRANSCRIPT_FONT_SIZE = 13
const DEFAULT_MAX_SUBAGENT_DEPTH = 2
const MAX_SUBAGENT_DEPTH = 10

const parseMaxSubagentDepth = (value) =>
  Number.isInteger(value) && value >= 0 && value <= MAX_SUBAGENT_DEPTH ? value : null

const parseSessionNaming = (value) => (typeof value === 'boolean' ? value : null)

const parseTranscriptFontSize = (value) => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < MIN_TRANSCRIPT_FONT_SIZE || value > MAX_TRANSCRIPT_FONT_SIZE) return null
  return value
}

const readStored = (writeDir) => {
  try {
    const stored = readJson(paths.uiSettingsFile(writeDir), {})
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  } catch (err) {
    if (err instanceof SyntaxError) return {}
    throw err
  }
}

const normalize = (stored) => {
  const size = parseTranscriptFontSize(stored && stored.transcriptFontSize)
  const depth = parseMaxSubagentDepth(stored && stored.maxSubagentDepth)
  const naming = parseSessionNaming(stored && stored.sessionNaming)
  return {
    transcriptFontSize: size == null ? DEFAULT_TRANSCRIPT_FONT_SIZE : size,
    maxSubagentDepth: depth == null ? DEFAULT_MAX_SUBAGENT_DEPTH : depth,
    sessionNaming: naming == null ? true : naming,
  }
}

const getUiSettings = (writeDir) => normalize(readStored(writeDir))

const updateUiSettings = (patch, writeDir) => {
  const next = { ...readStored(writeDir) }
  const fields = [
    ['transcriptFontSize', parseTranscriptFontSize, MIN_TRANSCRIPT_FONT_SIZE, MAX_TRANSCRIPT_FONT_SIZE],
    ['maxSubagentDepth', parseMaxSubagentDepth, 0, MAX_SUBAGENT_DEPTH],
    ['sessionNaming', parseSessionNaming],
  ]
  if (!fields.some(([key]) => Object.prototype.hasOwnProperty.call(patch || {}, key))) {
    const err = new Error('transcriptFontSize, maxSubagentDepth, or sessionNaming is required')
    err.status = 400
    throw err
  }
  for (const [key, parse, min, max] of fields) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    const value = parse(patch[key])
    if (value == null) {
      const err = new Error(min == null ? `${key} must be a boolean` : `${key} must be an integer from ${min} to ${max}`)
      err.status = 400
      throw err
    }
    next[key] = value
  }
  writeJson(paths.uiSettingsFile(writeDir), next)
  return normalize(next)
}

module.exports = {
  MIN_TRANSCRIPT_FONT_SIZE,
  MAX_TRANSCRIPT_FONT_SIZE,
  DEFAULT_TRANSCRIPT_FONT_SIZE,
  DEFAULT_MAX_SUBAGENT_DEPTH,
  MAX_SUBAGENT_DEPTH,
  getUiSettings,
  updateUiSettings,
}
