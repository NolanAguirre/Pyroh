const isObject = (value) => value !== null && typeof value === 'object'

const errorMessage = (err) => {
  if (err == null || err === '') return 'unknown error'
  if (typeof err === 'string') return err
  if (typeof err === 'number' || typeof err === 'boolean') return String(err)
  if (err instanceof Error) return err.message || err.name || String(err)
  if (isObject(err)) {
    if (typeof err.message === 'string' && err.message) return err.message
    if (typeof err.error === 'string' && err.error) return err.error
    if (err.error != null && err.error !== err) return errorMessage(err.error)
    try {
      const json = JSON.stringify(err)
      if (json && json !== '{}' && json !== 'null') return json
    } catch {
      // circular or otherwise unserializable
    }
    return String(err)
  }
  return String(err)
}

const errorStack = (err) => {
  if (isObject(err) && typeof err.stack === 'string' && err.stack) return err.stack
  return null
}

const formatError = (err) => {
  const message = errorMessage(err)
  const stack = errorStack(err)
  if (!stack) return message
  if (stack.includes(message)) return stack
  return `${message}\n${stack}`
}

module.exports = { errorMessage, errorStack, formatError }
