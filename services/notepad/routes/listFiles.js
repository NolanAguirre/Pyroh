const fs = require('fs/promises')
const { DEFAULT_FILE, isNoteFile } = require('../files')
const { readMetadata } = require('../metadata')

const listFiles = (writeDir) => async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    let entries = []
    try {
      entries = await fs.readdir(writeDir, { withFileTypes: true })
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    const files = entries
      .filter((entry) => entry.isFile() && isNoteFile(entry.name) && entry.name !== DEFAULT_FILE)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const { displayNames } = await readMetadata(writeDir)
    const noteFiles = [DEFAULT_FILE, ...files]
    res.json({
      files: noteFiles,
      displayNames: Object.fromEntries(noteFiles.filter((file) => displayNames[file]).map((file) => [file, displayNames[file]])),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = listFiles
