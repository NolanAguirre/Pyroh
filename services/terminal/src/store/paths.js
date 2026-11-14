const path = require('path')
const config = require('../config')

const terminalsDir = (writeDir = config.writeDir) => path.join(writeDir, 'terminal')

const terminalDir = (terminalId, writeDir = config.writeDir) => {
  const id = path.basename(String(terminalId))
  if (!id || id === '.' || id === '..' || id !== String(terminalId)) {
    throw new Error('Invalid terminal id')
  }
  return path.join(terminalsDir(writeDir), id)
}

const terminalMetaFile = (terminalId, writeDir = config.writeDir) =>
  path.join(terminalDir(terminalId, writeDir), 'metadata.json')

const terminalGroupsFile = (writeDir = config.writeDir) =>
  path.join(terminalsDir(writeDir), 'groups.json')

const terminalStartupFile = (writeDir = config.writeDir) =>
  path.join(terminalsDir(writeDir), 'startup.txt')

const terminalPreparationFile = (ticket, writeDir = config.writeDir) => {
  if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) throw Object.assign(new Error('Invalid preparation ticket'), { httpStatus: 400 })
  return path.join(terminalsDir(writeDir), 'preparations', `${ticket}.json`)
}

const ptyHostSocket = (writeDir = config.writeDir) => path.join(terminalsDir(writeDir), 'pty-host.sock')

const ptyHostPidFile = (writeDir = config.writeDir) => path.join(terminalsDir(writeDir), 'pty-host.pid')

const ptyHostLog = (writeDir = config.writeDir) => path.join(terminalsDir(writeDir), 'pty-host.log')

module.exports = {
  terminalsDir,
  terminalDir,
  terminalMetaFile,
  terminalGroupsFile,
  terminalStartupFile,
  terminalPreparationFile,
  ptyHostSocket,
  ptyHostPidFile,
  ptyHostLog,
}
