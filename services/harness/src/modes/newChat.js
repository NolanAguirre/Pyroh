const prompts = require('../prompts')

const MODE = 'new-chat'

const buildPrompt = (focus, provider, context = {}) => prompts.render('newChat', { focus: prompts.focusBlock(focus, provider, context) }, provider, context)
const buildPromptWithProvenance = (focus, provider, context = {}, metadata) =>
  prompts.renderWithProvenance('newChat', { focus: prompts.focusWithProvenance(focus, provider, context, metadata) }, provider, context, metadata)

module.exports = { MODE, buildPrompt, buildPromptWithProvenance }
