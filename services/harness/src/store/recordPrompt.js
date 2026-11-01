const fs = require('fs')
const path = require('path')
const { ensureDir } = require('./jsonFile')

const promptFileName = (jsonFile) => `${path.basename(jsonFile, '.json')}.prompt.txt`

const writePromptFile = (file, text) => {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text == null ? '' : String(text))
  return file
}

// Move an inline prompt onto a sibling .prompt.txt and point at it from JSON.
// If promptFile is already set, keep that file (do not overwrite on status patches).
const persistRecordPrompt = (jsonFile, record) => {
  if (!record) return record
  if (record.prompt == null) {
    const next = { ...record }
    delete next.prompt
    return next
  }
  if (record.promptFile) {
    const next = { ...record }
    delete next.prompt
    return next
  }
  const name = promptFileName(jsonFile)
  writePromptFile(path.join(path.dirname(jsonFile), name), record.prompt)
  const next = {}
  Object.keys(record).forEach((key) => {
    if (key === 'prompt') next.promptFile = name
    else next[key] = record[key]
  })
  return next
}

const readRecordPrompt = (record, jsonFile) => {
  if (!record) return null
  if (record.promptFile) {
    const file = path.isAbsolute(record.promptFile)
      ? record.promptFile
      : path.join(path.dirname(jsonFile), record.promptFile)
    return fs.readFileSync(file, 'utf8')
  }
  if (record.prompt != null) return record.prompt
  return null
}

const readRecordPromptAsync = async (record, jsonFile) => {
  if (!record) return null
  if (record.promptFile) {
    const file = path.isAbsolute(record.promptFile)
      ? record.promptFile
      : path.join(path.dirname(jsonFile), record.promptFile)
    return fs.promises.readFile(file, 'utf8')
  }
  if (record.prompt != null) return record.prompt
  return null
}

module.exports = {
  writePromptFile,
  persistRecordPrompt,
  readRecordPrompt,
  readRecordPromptAsync,
}
