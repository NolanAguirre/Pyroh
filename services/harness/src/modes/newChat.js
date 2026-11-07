const prompts = require('../prompts')

const MODE = 'new-chat'

const buildPrompt = (focus, provider, context = {}) => prompts.render('newChat', { focus: prompts.focusBlock(focus, provider, context) }, provider, context)

module.exports = { MODE, buildPrompt }
