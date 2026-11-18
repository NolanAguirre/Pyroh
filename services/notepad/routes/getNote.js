const fs = require('fs/promises')
const path = require('path')

const getNote = (writeDir) => async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const text = await fs.readFile(path.join(writeDir, 'notepad.txt'), 'utf8')
    res.json({ text })
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ text: '' })
    res.status(500).json({ error: err.message })
  }
}

module.exports = getNote
