const fs = require('fs/promises')
const path = require('path')
const { DEFAULT_FILE, isNoteFile } = require('../files')

const putNote = (writeDir) => async (req, res) => {
  const text = req.body && req.body.text
  if (typeof text !== 'string') return res.status(400).json({ error: 'text must be a string' })
  const file = req.query.file === undefined ? DEFAULT_FILE : req.query.file
  if (!isNoteFile(file)) return res.status(400).json({ error: 'Invalid note filename' })
  try {
    await fs.mkdir(writeDir, { recursive: true })
    await fs.writeFile(path.join(writeDir, file), text)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = putNote
