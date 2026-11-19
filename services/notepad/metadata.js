const fs = require('fs/promises')
const path = require('path')
const { randomBytes } = require('crypto')
const { isNoteFile } = require('./files')

const METADATA_FILE = 'metadata.json'
const isDisplayName = (name) => typeof name === 'string'
  && name.length > 0 && name.length <= 120 && name === name.trim()
  && !/[\u0000-\u001f\u007f-\u009f]/.test(name)

const readMetadata = async (writeDir) => {
  let raw
  try {
    raw = await fs.readFile(path.join(writeDir, METADATA_FILE), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return { displayNames: {} }
    throw err
  }
  const metadata = JSON.parse(raw)
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || !metadata.displayNames || typeof metadata.displayNames !== 'object'
    || Array.isArray(metadata.displayNames)
    || Object.entries(metadata.displayNames).some(([file, name]) => !isNoteFile(file) || !isDisplayName(name))) {
    throw new Error('Invalid note metadata')
  }
  return metadata
}

// Serialize metadata updates so simultaneous renames keep each other's changes.
let writes = Promise.resolve()
const renameNote = (writeDir, file, displayName) => {
  writes = writes.catch(() => {}).then(async () => {
    const metadata = await readMetadata(writeDir)
    metadata.displayNames[file] = displayName
    await fs.mkdir(writeDir, { recursive: true })
    const temporary = path.join(writeDir, `.metadata-${randomBytes(12).toString('hex')}.tmp`)
    try {
      await fs.writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' })
      await fs.rename(temporary, path.join(writeDir, METADATA_FILE))
    } finally {
      await fs.unlink(temporary).catch(() => {})
    }
  })
  return writes
}

module.exports = { isDisplayName, readMetadata, renameNote }
