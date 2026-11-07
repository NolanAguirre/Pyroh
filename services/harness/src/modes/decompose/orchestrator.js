const { runPipelineDaemon } = require('../../harness/pipelineDaemon')

const runDecomposeDaemon = ({ sessionId, resume = false }) =>
  runPipelineDaemon({ sessionId, mode: 'decompose', resume })

module.exports = { runDecomposeDaemon }
