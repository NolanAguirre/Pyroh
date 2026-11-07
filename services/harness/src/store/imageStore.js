const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('../config')
const paths = require('./paths')

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGES = 5
const UPLOAD_JSON_LIMIT = 14 * 1024 * 1024
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const imageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const requireId = (id, pattern, label) => {
  if (typeof id !== 'string' || !pattern.test(id)) throw fail(`invalid ${label}`)
}
const validName = (name) => typeof name === 'string' && name.trim().length > 0 &&
  Buffer.byteLength(name, 'utf8') <= 255 && !/[\x00-\x1f\x7f/\\]/.test(name) && name !== '.' && name !== '..'

// Check container signatures, dimensions and framing, without decompressing pixels.
const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
const isPng = (b) => {
  if (b.length < 57 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return false
  let pos = 8
  let data = false
  while (pos + 12 <= b.length) {
    const size = b.readUInt32BE(pos)
    const type = b.toString('ascii', pos + 4, pos + 8)
    const end = pos + 12 + size
    if (end > b.length || !/^[A-Za-z]{4}$/.test(type)) return false
    if (crc32(b.subarray(pos + 4, end - 4)) !== b.readUInt32BE(end - 4)) return false
    if (pos === 8) {
      if (type !== 'IHDR' || size !== 13 || !b.readUInt32BE(pos + 8) || !b.readUInt32BE(pos + 12)) return false
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!depths[b[pos + 17]]?.includes(b[pos + 16]) || b[pos + 18] || b[pos + 19] || b[pos + 20] > 1) return false
    } else if (type === 'IHDR') return false
    if (type === 'IDAT' && size) data = true
    if (type === 'IEND') return size === 0 && data && end === b.length
    pos = end
  }
  return false
}
const isJpeg = (b) => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false
  let pos = 2
  let frame = false
  let scan = false
  while (pos < b.length) {
    if (b[pos++] !== 0xff) return false
    while (b[pos] === 0xff) pos++
    const marker = b[pos++]
    if (marker === 0xd9) return frame && scan && pos === b.length
    if (!marker || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || pos + 2 > b.length) return false
    const size = b.readUInt16BE(pos)
    if (size < 2 || pos + size > b.length) return false
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (size < 11 || !b.readUInt16BE(pos + 3) || !b.readUInt16BE(pos + 5) || size !== 8 + 3 * b[pos + 7]) return false
      frame = true
    }
    if (marker === 0xda) {
      if (!frame || size < 8 || size !== 6 + 2 * b[pos + 2]) return false
      scan = true
    }
    pos += size
    if (marker === 0xda) {
      const start = pos
      while (pos < b.length) {
        if (b[pos] !== 0xff) { pos++; continue }
        if (b[pos + 1] === 0 || (b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) { pos += 2; continue }
        break
      }
      if (pos === start) return false
    }
  }
  return false
}
const isGif = (b) => {
  if (b.length < 14 || !['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) || !b.readUInt16LE(6) || !b.readUInt16LE(8)) return false
  let pos = 13 + ((b[10] & 0x80) ? 3 * (1 << ((b[10] & 7) + 1)) : 0)
  let image = false
  const blocks = () => {
    let count = 0
    while (pos < b.length) {
      const size = b[pos++]
      if (!size) return count
      if (pos + size > b.length) return -1
      count += size
      pos += size
    }
    return -1
  }
  while (pos < b.length) {
    const type = b[pos++]
    if (type === 0x3b) return image && pos === b.length
    if (type === 0x21) {
      if (pos >= b.length) return false
      pos++
      if (blocks() < 0) return false
    } else if (type === 0x2c) {
      if (pos + 9 > b.length || !b.readUInt16LE(pos + 4) || !b.readUInt16LE(pos + 6)) return false
      const packed = b[pos + 8]
      pos += 9 + ((packed & 0x80) ? 3 * (1 << ((packed & 7) + 1)) : 0)
      if (pos >= b.length || b[pos] < 2 || b[pos] > 8) return false
      pos++
      if (blocks() <= 0) return false
      image = true
    } else return false
  }
  return false
}
const isWebp = (b) => {
  if (b.length < 20 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP' || b.readUInt32LE(4) !== b.length - 8) return false
  const chunks = (start, end, nested = false) => {
    let image = false
    let pos = start
    while (pos + 8 <= end) {
      const type = b.toString('ascii', pos, pos + 4)
      const size = b.readUInt32LE(pos + 4)
      const data = pos + 8
      const next = data + size + (size & 1)
      if (next > end) return false
      if (type === 'VP8 ') {
        if (size < 10 || (b[data] & 1) || b.toString('hex', data + 3, data + 6) !== '9d012a' || !(b.readUInt16LE(data + 6) & 0x3fff) || !(b.readUInt16LE(data + 8) & 0x3fff)) return false
        image = true
      } else if (type === 'VP8L') {
        if (size < 5 || b[data] !== 0x2f || (b[data + 4] & 0xe0)) return false
        image = true
      } else if (type === 'VP8X' && size !== 10) return false
      else if (type === 'ANMF') {
        if (nested || size < 24 || !chunks(data + 16, data + size, true)) return false
        image = true
      }
      pos = next
    }
    return image && pos === end
  }
  return chunks(12, b.length)
}
const validateBytes = (bytes, mimeType) => {
  if (!bytes.length) throw fail('image is empty')
  if (bytes.length > MAX_IMAGE_BYTES) throw fail('image exceeds 10 MiB', 413)
  const validators = { 'image/png': isPng, 'image/jpeg': isJpeg, 'image/gif': isGif, 'image/webp': isWebp }
  if (!MIME_TYPES.has(mimeType) || !validators[mimeType](bytes)) throw fail('invalid image bytes or MIME type')
}

// Resolve beneath the configured root and reject symlinks at every child component.
const safePath = (file, writeDir) => {
  const relative = path.relative(path.resolve(writeDir), path.resolve(file))
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw fail('invalid image path')
  let current = fs.realpathSync(writeDir)
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw fail('invalid image path')
    } catch (err) { if (err.code !== 'ENOENT') throw err }
  }
  return current
}
const sessionLocation = (id, writeDir) => {
  requireId(id, sessionIdPattern, 'session id')
  const location = paths.locateSession(id, writeDir)
  if (!location) throw fail('session not found', 404)
  safePath(path.join(location.dir, 'session.json'), writeDir)
  return location
}
const readFile = (file, limit) => {
  let fd
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > limit) throw fail('invalid stored image')
    return fs.readFileSync(fd)
  } catch (err) {
    if (err.code === 'ENOENT') throw fail('image not found', 404)
    throw err
  } finally { if (fd !== undefined) fs.closeSync(fd) }
}
const imageFiles = (sessionId, id, writeDir) => {
  requireId(id, imageIdPattern, 'image id')
  const dir = path.join(paths.sessionDir(sessionId, writeDir), 'images')
  return { dir: safePath(dir, writeDir), path: safePath(path.join(dir, `${id}.bin`), writeDir), metadata: safePath(path.join(dir, `${id}.json`), writeDir) }
}
const readImage = (sessionId, imageId, writeDir = config.writeDir) => {
  sessionLocation(sessionId, writeDir)
  const files = imageFiles(sessionId, imageId, writeDir)
  let metadata
  try { metadata = JSON.parse(readFile(files.metadata, 4096).toString('utf8')) } catch (err) {
    if (err instanceof SyntaxError) throw fail('invalid stored image')
    throw err
  }
  if (!metadata || metadata.id !== imageId || metadata.sessionId !== sessionId || !validName(metadata.name) || !MIME_TYPES.has(metadata.mimeType) || !Number.isInteger(metadata.size)) throw fail('invalid stored image')
  const bytes = readFile(files.path, MAX_IMAGE_BYTES)
  if (metadata.size !== bytes.length) throw fail('invalid stored image size')
  validateBytes(bytes, metadata.mimeType)
  return { image: { id: imageId, sessionId, name: metadata.name, mimeType: metadata.mimeType, size: bytes.length }, path: files.path, bytes }
}
const storeImage = (sessionId, upload, writeDir = config.writeDir) => {
  sessionLocation(sessionId, writeDir)
  if (!upload || typeof upload !== 'object' || Array.isArray(upload) || Object.keys(upload).some(key => !['name', 'mimeType', 'data'].includes(key))) throw fail('invalid image upload')
  const { name, mimeType, data } = upload
  if (!validName(name)) throw fail('invalid image name')
  if (!MIME_TYPES.has(mimeType)) throw fail('unsupported image MIME type')
  if (typeof data !== 'string' || !data.length) throw fail('data must be base64 without a URL prefix')
  if (data.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) throw fail('image exceeds 10 MiB', 413)
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw fail('invalid base64 image data')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.toString('base64') !== data) throw fail('invalid base64 image data')
  validateBytes(bytes, mimeType)
  const id = crypto.randomUUID()
  const image = { id, sessionId, name, mimeType, size: bytes.length }
  const files = imageFiles(sessionId, id, writeDir)
  fs.mkdirSync(files.dir, { recursive: true, mode: 0o700 })
  // Exclusive files make generated IDs immutable; metadata is published last.
  const write = (file, contents) => {
    const fd = fs.openSync(file, 'wx', 0o600)
    try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  }
  write(files.path, bytes)
  write(files.metadata, JSON.stringify(image))
  const directory = fs.openSync(files.dir, 'r')
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
  return image
}
const loadImages = (sessionId, images, writeDir) => {
  if (images === undefined) return []
  if (!Array.isArray(images)) throw fail('images must be an array')
  if (images.length > MAX_IMAGES) throw fail('at most 5 images are allowed per prompt')
  if (!images.length) return []
  const target = sessionLocation(sessionId, writeDir)
  return images.map(reference => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw fail('invalid image reference')
    const ownerId = reference.sessionId === undefined ? sessionId : reference.sessionId
    const owner = sessionLocation(ownerId, writeDir)
    if (ownerId !== sessionId && (!target.workspaceId || target.workspaceId !== owner.workspaceId)) throw fail('image belongs to a different workspace', 403)
    return readImage(ownerId, reference.id, writeDir)
  })
}
const normalizeImages = (sessionId, images, writeDir = config.writeDir) =>
  loadImages(sessionId, images, writeDir).map(({ image }) => image)
const resolveImages = (sessionId, images, writeDir = config.writeDir) =>
  loadImages(sessionId, images, writeDir).map(({ image, path, bytes }) => ({ ...image, path, data: bytes.toString('base64') }))

module.exports = { storeImage, readImage, normalizeImages, resolveImages, MAX_IMAGE_BYTES, MAX_IMAGES, UPLOAD_JSON_LIMIT }
