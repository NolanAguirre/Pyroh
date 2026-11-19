const fs = require('fs/promises')
const path = require('path')
const { DEFAULT_FILE, isNoteFile } = require('../files')

const getNote = (writeDir) => async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const file = req.query.file === undefined ? DEFAULT_FILE : req.query.file
  if (!isNoteFile(file)) return res.status(400).json({ error: 'Invalid note filename' })
  try {
    const text = await fs.readFile(path.join(writeDir, file), 'utf8')
    res.json({ text })
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (file === DEFAULT_FILE) return res.json({ text: '' })
      return res.status(404).json({ error: 'Note file not found' })
    }
    res.status(500).json({ error: err.message })
  }
}

module.exports = getNote
