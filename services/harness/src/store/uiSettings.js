const paths = require('./paths')
const { readJson, writeJson } = require('./jsonFile')

const MIN_TRANSCRIPT_FONT_SIZE = 12
const MAX_TRANSCRIPT_FONT_SIZE = 24
const DEFAULT_TRANSCRIPT_FONT_SIZE = 13

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
  return {
    transcriptFontSize: size == null ? DEFAULT_TRANSCRIPT_FONT_SIZE : size,
  }
}

const getUiSettings = (writeDir) => normalize(readStored(writeDir))

const updateUiSettings = (patch, writeDir) => {
  const size = parseTranscriptFontSize(patch && patch.transcriptFontSize)
  if (size == null) {
    const err = new Error(`transcriptFontSize must be an integer from ${MIN_TRANSCRIPT_FONT_SIZE} to ${MAX_TRANSCRIPT_FONT_SIZE}`)
    err.status = 400
    throw err
  }
  const next = { ...readStored(writeDir), transcriptFontSize: size }
  writeJson(paths.uiSettingsFile(writeDir), next)
  return normalize(next)
}

module.exports = {
  MIN_TRANSCRIPT_FONT_SIZE,
  MAX_TRANSCRIPT_FONT_SIZE,
  DEFAULT_TRANSCRIPT_FONT_SIZE,
  getUiSettings,
  updateUiSettings,
}
