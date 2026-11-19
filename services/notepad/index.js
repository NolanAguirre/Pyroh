const express = require('express')
const getNote = require('./routes/getNote')
const putNote = require('./routes/putNote')
const listFiles = require('./routes/listFiles')
const createFile = require('./routes/createFile')

const HOST = process.env.HOST
const PORT = process.env.PORT
const WRITE_DIR = process.env.WRITE_DIR

const app = express()
app.use(express.json({ limit: '1mb' }))
app.get('/api/notepad/files', listFiles(WRITE_DIR))
app.post('/api/notepad/files', createFile(WRITE_DIR))
app.get('/api/notepad', getNote(WRITE_DIR))
app.put('/api/notepad', putNote(WRITE_DIR))

app.listen(PORT, HOST, () => {
  process.stdout.write(`notepad API listening on http://${HOST}:${PORT}\n`)
})
