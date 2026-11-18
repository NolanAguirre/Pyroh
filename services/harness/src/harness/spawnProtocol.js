const VERSION = 1
const ID = /^[a-zA-Z0-9_-]{1,128}$/

const failure = (message, code = 'SPAWN_PROTOCOL', status = 503) => Object.assign(new Error(message), { code, status })
const validId = (value) => typeof value === 'string' && ID.test(value)

const validateRequest = (request) => {
  if (!request || request.version !== VERSION || !validId(request.requestId) || !validId(request.sessionId)) {
    throw failure('Invalid agent spawn request', 'SPAWN_PROTOCOL', 400)
  }
  return request
}

const validateArgs = (args) => {
  if (!Array.isArray(args) || !args.every(value => typeof value === 'string') || !validId(args[1])) {
    throw failure('Invalid agent spawn arguments', 'SPAWN_PROTOCOL', 400)
  }
  const turn = ['run', 'plan', 'resume'].includes(args[0]) && args.length === 4 &&
    args[2] === '--run-id' && validId(args[3])
  const workflow = args[0] === 'workflow' && [4, 5].includes(args.length) &&
    args[2] === '--mode' && args[3].length > 0 && args[3].length <= 256 &&
    (args.length === 4 || args[4] === '--resume')
  if (!turn && !workflow) throw failure('Invalid agent spawn command', 'SPAWN_PROTOCOL', 400)
  return args
}

const serializeError = (error) => ({
  message: error?.message || String(error),
  ...(typeof error?.code === 'string' ? { code: error.code } : {}),
  ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
})

const deserializeError = (error) => {
  if (!error || typeof error.message !== 'string' ||
      (error.code !== undefined && typeof error.code !== 'string') ||
      (error.status !== undefined && (!Number.isInteger(error.status) || error.status < 400 || error.status > 599))) {
    return failure('Invalid agent spawn error reply')
  }
  return Object.assign(new Error(error.message), {
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.status === undefined ? {} : { status: error.status }),
  })
}

const validateReply = (reply, request) => {
  if (!reply || reply.version !== VERSION || reply.requestId !== request.requestId ||
      reply.sessionId !== request.sessionId || typeof reply.ok !== 'boolean') {
    throw failure('Invalid agent spawn reply')
  }
  if (!reply.ok) throw deserializeError(reply.error)
  if (!Number.isSafeInteger(reply.pid) || reply.pid <= 0) throw failure('Invalid agent spawn PID')
  return reply.pid
}

module.exports = { VERSION, failure, validateRequest, validateArgs, serializeError, validateReply }
