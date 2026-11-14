const fs = require('fs')
const path = require('path')

// Read-only port of harness record prompt resolution.
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

module.exports = { readRecordPrompt }
