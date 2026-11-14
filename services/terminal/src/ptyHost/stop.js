// Asks the running pty host to kill its shells and exit.
const net = require('net')
const paths = require('../store/paths')
const { createLineReader, encode } = require('../hostProtocol')

const socketPath = paths.ptyHostSocket()
const socket = net.createConnection(socketPath)
const state = { connected: false, acknowledged: false, finished: false }
const timeout = setTimeout(() => {
  finish(1, `pty host stop timed out after 5 seconds (${socketPath})`)
}, 5000)

const finish = (code, message) => {
  if (state.finished) return
  state.finished = true
  clearTimeout(timeout)
  socket.destroy()
  process.exitCode = code
  if (message) (code ? process.stderr : process.stdout).write(`${message}\n`)
}

socket.setEncoding('utf8')
socket.on('connect', () => {
  state.connected = true
  socket.write(encode({ reqId: 1, type: 'shutdown', payload: {} }))
})
socket.on('data', createLineReader((message) => {
  if (state.finished || message.reqId !== 1) return
  if (message.ok !== true) {
    finish(1, `pty host refused: ${message.error || 'shutdown was not accepted'}`)
    return
  }
  state.acknowledged = true
}))
socket.on('close', () => {
  if (state.acknowledged) {
    finish(0, 'pty host stopped')
    return
  }
  finish(1, `pty host closed the connection without accepting shutdown (${socketPath})`)
})
socket.on('error', (err) => {
  if (!state.connected && (err.code === 'ENOENT' || err.code === 'ECONNREFUSED')) {
    finish(0, `pty host not running (${socketPath})`)
    return
  }
  finish(1, `pty host stop failed: ${err.message}`)
})
