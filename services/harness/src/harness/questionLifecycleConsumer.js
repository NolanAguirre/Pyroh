const { createLifecycleConsumer } = require('./lifecycleConsumer')

const TYPES = new Set(['requested', 'answered', 'cancelled', 'expired'])

const createQuestionLifecycleConsumer = options => {
  return createLifecycleConsumer({
    ...options,
    subject: options.transport.questionLifecycleSubject,
    valid: event => TYPES.has(event.type) && typeof event.questionId === 'string' &&
      (event.runId === null || typeof event.runId === 'string'),
  })
}

module.exports = { createQuestionLifecycleConsumer }
