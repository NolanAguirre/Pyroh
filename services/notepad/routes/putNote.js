const fs = require('fs/promises')
const path = require('path')

const putNote = (writeDir) => async (req, res) => {
  const text = req.body && req.body.text
  if (typeof text !== 'string') return res.status(400).json({ error: 'text must be a string' })
  try {
    await fs.mkdir(writeDir, { recursive: true })
    await fs.writeFile(path.join(writeDir, 'notepad.txt'), text)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = putNote
