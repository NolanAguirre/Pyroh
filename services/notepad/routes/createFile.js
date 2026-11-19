const fs = require('fs/promises')
const path = require('path')
const { DEFAULT_FILE, isNoteFile } = require('../files')

const createFile = (writeDir) => async (req, res) => {
  const name = req.body && req.body.name
  if (name !== undefined && !isNoteFile(name)) {
    return res.status(400).json({ error: 'name must be a .txt filename without path separators' })
  }
  if (name === DEFAULT_FILE) return res.status(409).json({ error: 'Note file already exists' })
  try {
    await fs.mkdir(writeDir, { recursive: true })
    for (let number = 1; ; number += 1) {
      const file = name === undefined ? `note-${number}.txt` : name
      try {
        await fs.writeFile(path.join(writeDir, file), '', { flag: 'wx' })
        return res.status(201).json({ file, text: '' })
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
        if (name !== undefined) return res.status(409).json({ error: 'Note file already exists' })
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = createFile
