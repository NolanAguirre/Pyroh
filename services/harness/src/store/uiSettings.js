const paths = require('./paths')
const { readJson, writeJson } = require('./jsonFile')

const MIN_TRANSCRIPT_FONT_SIZE = 12
const MAX_TRANSCRIPT_FONT_SIZE = 24
const DEFAULT_TRANSCRIPT_FONT_SIZE = 13
const DEFAULT_MAX_SUBAGENT_DEPTH = 2
const MAX_SUBAGENT_DEPTH = 10
const DEFAULT_NEW_CHAT_HOTKEY = { key: ' ', ctrl: true, alt: false, shift: false, meta: false }

const parseHotkeys = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!Object.prototype.hasOwnProperty.call(value, 'newChat')) return null
  const binding = value.newChat
  if (binding === null) return { newChat: null }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return null
  if (typeof binding.key !== 'string' || !binding.key.length || binding.key.length > 32) return null
  if (!['ctrl', 'alt', 'shift', 'meta'].every((key) => typeof binding[key] === 'boolean')) return null
  const key = binding.key.toLowerCase()
  if (['control', 'alt', 'shift', 'meta', 'dead', 'unidentified', 'escape', 'tab'].includes(key)) return null
  if (!binding.ctrl && !binding.alt && !binding.meta && !/^f([1-9]|1[0-2])$/.test(key)) return null
  return { newChat: { key, ctrl: binding.ctrl, alt: binding.alt, shift: binding.shift, meta: binding.meta } }
}

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
    hotkeys: parseHotkeys(stored && stored.hotkeys) || { newChat: { ...DEFAULT_NEW_CHAT_HOTKEY } },
  }
}

const getUiSettings = (writeDir) => normalize(readStored(writeDir))

const updateUiSettings = (patch, writeDir) => {
  const next = { ...readStored(writeDir) }
  const fields = [
    ['transcriptFontSize', parseTranscriptFontSize, MIN_TRANSCRIPT_FONT_SIZE, MAX_TRANSCRIPT_FONT_SIZE],
    ['maxSubagentDepth', parseMaxSubagentDepth, 0, MAX_SUBAGENT_DEPTH],
    ['sessionNaming', parseSessionNaming],
    ['hotkeys', parseHotkeys],
  ]
  if (!fields.some(([key]) => Object.prototype.hasOwnProperty.call(patch || {}, key))) {
    const err = new Error('transcriptFontSize, maxSubagentDepth, sessionNaming, or hotkeys is required')
    err.status = 400
    throw err
  }
  for (const [key, parse, min, max] of fields) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    const value = parse(patch[key])
    if (value == null) {
      const message = key === 'hotkeys'
        ? 'hotkeys.newChat must be null or a key with boolean ctrl, alt, shift, and meta modifiers; use Ctrl, Alt, Meta, or F1–F12'
        : min == null ? `${key} must be a boolean` : `${key} must be an integer from ${min} to ${max}`
      const err = new Error(message)
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
