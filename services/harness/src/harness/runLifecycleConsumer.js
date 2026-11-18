const { createLifecycleConsumer } = require('./lifecycleConsumer')

const TYPES = new Set(['started', 'completed', 'failed', 'cancelled'])

const createRunLifecycleConsumer = options => {
  return createLifecycleConsumer({
    ...options,
    subject: options.transport.lifecycleSubject,
    valid: event => TYPES.has(event.type) && typeof event.runId === 'string',
  })
}

module.exports = { createRunLifecycleConsumer }
