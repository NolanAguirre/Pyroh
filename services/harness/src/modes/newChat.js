const prompts = require('../prompts')

const MODE = 'new-chat'

const buildPrompt = (focus, provider) => prompts.render('newChat', { focus: prompts.focusBlock(focus, provider) }, provider)

module.exports = { MODE, buildPrompt }
