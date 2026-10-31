const prompts = require('../prompts')

const MODE = 'new-chat'

const buildPrompt = (focus) => prompts.render('newChat', { focus: prompts.focusBlock(focus) })

module.exports = { MODE, buildPrompt }
