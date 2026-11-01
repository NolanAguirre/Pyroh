const fs = require('fs')
const path = require('path')
const paths = require('../store/paths')
const prompts = require('../prompts')

const MODE = 'memory-extract'
const NAME = 'Memories'

const isTranscriptFile = (name) =>
  name === 'events.jsonl' || name.endsWith('.prompt.txt')

const transcriptFiles = (sessionId, writeDir) => {
  const files = []
  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile() && isTranscriptFile(entry.name)) files.push(full)
    }
  }
  visit(path.resolve(paths.sessionDir(sessionId, writeDir)))
  return files
}

const buildPrompt = (sessionId, focus, writeDir) => prompts.render('memoryExtract', {
  sessionId,
  files: prompts.directoryLines(transcriptFiles(sessionId, writeDir)),
  focus: prompts.focusBlock(focus),
})

module.exports = { MODE, NAME, buildPrompt }
