// Newline-delimited JSON framing shared by the pty host and its API clients.
// Sockets must use setEncoding('utf8') so multi-byte characters split across
// chunks are reassembled before parsing.
const createLineReader = (onMessage) => {
  const data = Object.create(null)
  data.buffer = ''

  return (chunk) => {
    data.buffer += chunk
    let index = data.buffer.indexOf('\n')
    while (index !== -1) {
      const line = data.buffer.slice(0, index)
      data.buffer = data.buffer.slice(index + 1)
      if (line.trim()) {
        let message = null
        try {
          message = JSON.parse(line)
        } catch {
          // Skip malformed lines.
        }
        if (message && typeof message === 'object') onMessage(message)
      }
      index = data.buffer.indexOf('\n')
    }
  }
}

const encode = (message) => `${JSON.stringify(message)}\n`

module.exports = { createLineReader, encode }
