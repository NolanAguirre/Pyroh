const prompts = require('../prompts')
const { transcriptDirectories } = require('./tokenWaste')

const MODE = 'memory-extract'
const NAME = 'Memories'

const buildPrompt = (sessionId, focus, writeDir) => prompts.render('memoryExtract', {
  sessionId,
  directories: prompts.directoryLines(transcriptDirectories(sessionId, writeDir)),
  focus: prompts.focusBlock(focus),
})

module.exports = { MODE, NAME, buildPrompt }
