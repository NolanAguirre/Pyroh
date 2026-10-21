// Asks the running pty host to kill its shells and exit.
const net = require('net')
const paths = require('../store/paths')
const { createLineReader, encode } = require('../hostProtocol')

const socketPath = paths.ptyHostSocket()
const socket = net.createConnection(socketPath)

socket.setEncoding('utf8')
socket.on('connect', () => {
  socket.write(encode({ reqId: 1, type: 'shutdown', payload: {} }))
})
socket.on('data', createLineReader((message) => {
  if (message.reqId !== 1) return
  process.stdout.write(message.ok ? 'pty host stopping\n' : `pty host refused: ${message.error}\n`)
}))
socket.on('close', () => process.exit(0))
socket.on('error', (err) => {
  if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
    process.stdout.write(`pty host not running (${socketPath})\n`)
    process.exit(0)
  }
  process.stderr.write(`pty host stop failed: ${err.message}\n`)
  process.exit(1)
})
