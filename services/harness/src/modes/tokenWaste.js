const fs = require('fs')
const path = require('path')
const paths = require('../store/paths')
const prompts = require('../prompts')

const MODE = 'token-waste'
const NAME = 'Token waste'

const transcriptDirectories = (sessionId, writeDir) => {
  const directories = []
  const visit = (dir) => {
    directories.push(dir)
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) visit(path.join(dir, entry.name))
    }
  }
  visit(path.resolve(paths.sessionDir(sessionId, writeDir)))
  return directories
}

const buildPrompt = (sessionId, focus, writeDir) => prompts.render('tokenWaste', {
  sessionId,
  directories: prompts.directoryLines(transcriptDirectories(sessionId, writeDir)),
  focus: prompts.focusBlock(focus),
})

module.exports = { MODE, NAME, buildPrompt, transcriptDirectories }
