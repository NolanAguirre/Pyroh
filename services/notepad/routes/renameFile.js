const fs = require('fs/promises')
const path = require('path')
const { DEFAULT_FILE, isNoteFile } = require('../files')
const { isDisplayName, renameNote } = require('../metadata')

const renameFile = (writeDir) => async (req, res) => {
  const { file, displayName: name } = req.body || {}
  if (!isNoteFile(file)) return res.status(400).json({ error: 'Invalid note filename' })
  const displayName = typeof name === 'string' ? name.trim() : name
  if (!isDisplayName(displayName)) {
    return res.status(400).json({ error: 'Name must be 1–120 characters without control characters' })
  }
  try {
    // The default note can be renamed before its first content save.
    try {
      const entry = await fs.lstat(path.join(writeDir, file))
      if (!entry.isFile()) return res.status(404).json({ error: 'Note file not found' })
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      if (file !== DEFAULT_FILE) return res.status(404).json({ error: 'Note file not found' })
    }
    await renameNote(writeDir, file, displayName)
    res.json({ file, displayName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = renameFile
