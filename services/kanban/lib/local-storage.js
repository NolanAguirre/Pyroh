const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { fail, uuid } = require('./attachment-http')

const ATTACHMENT_DIR = process.env.ATTACHMENT_DIR || path.join(os.homedir(), '.local/share/harness/kanban/attachments')
const ATTACHMENT_MAX_BYTES = Number(process.env.ATTACHMENT_MAX_BYTES || 104857600)

const createLocalStorage = (pool) => {
  const root = path.resolve(ATTACHMENT_DIR)
  const active = new Set()
  let cleanupTimer
  let cleaning = false

  const objectPath = (key, partial = false) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw fail(400, 'Invalid object key')
    return path.join(root, `${key}${partial ? '.part' : ''}`)
  }

  const metadata = (row) => {
    return {
      id: row.id,
      cardId: row.card_id,
      filename: row.filename,
      size: Number(row.size),
      contentType: row.content_type,
      createdAt: row.created_at,
    }
  }

  const unlink = async (filename) => {
    try {
      await fs.promises.unlink(filename)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  const cleanup = async () => {
    if (cleaning) return
    cleaning = true
    try {
      // Expired unused tokens and abandoned completion attempts cannot accumulate.
      await pool.query(`DELETE FROM kanban.card_attachment
        WHERE completed_at IS NULL AND (
          (token_hash IS NOT NULL AND expires_at < pg_catalog.now())
          OR created_at < pg_catalog.now() - INTERVAL '24 hours'
        )`)
      const { rows } = await pool.query('SELECT object_key FROM kanban.attachment_garbage LIMIT 256')
      for (const row of rows) {
        if (active.has(row.object_key)) continue
        await unlink(objectPath(row.object_key, true))
        await unlink(objectPath(row.object_key))
        await pool.query('DELETE FROM kanban.attachment_garbage WHERE object_key = $1', [row.object_key])
      }
    } finally {
      cleaning = false
    }
  }

  const prepare = async () => {
    if (!Number.isSafeInteger(ATTACHMENT_MAX_BYTES) || ATTACHMENT_MAX_BYTES < 1 || ATTACHMENT_MAX_BYTES > 1073741824) {
      throw new Error('ATTACHMENT_MAX_BYTES must be between 1 and 1073741824')
    }
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 })
    await cleanup()
    cleanupTimer = setInterval(() => {
      cleanup().catch((error) => console.error('Attachment cleanup failed:', error.message))
    }, 60000)
    cleanupTimer.unref()
  }

  const signUpload = async (body) => {
    const cardId = uuid(body.cardId)
    if (typeof body.filename !== 'string') throw fail(400, 'A filename is required')
    const filename = body.filename.toWellFormed().replace(/[\/\\\u0000-\u001f\u007f]/g, '_').trim()
    if (!filename || filename.length > 255) throw fail(400, 'Filename must contain 1 to 255 characters')
    if (!Number.isSafeInteger(body.size) || body.size < 0) throw fail(400, 'Invalid file size')
    if (body.size > ATTACHMENT_MAX_BYTES) throw fail(413, `Files must be no larger than ${Math.floor(ATTACHMENT_MAX_BYTES / 1048576)} MiB`)
    const contentType = typeof body.contentType === 'string' && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(body.contentType) && body.contentType.length <= 255
      ? body.contentType : 'application/octet-stream'
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const objectKey = crypto.randomBytes(32).toString('hex')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_catalog.pg_advisory_xact_lock(628193, 2)')
      const count = await client.query('SELECT pg_catalog.count(*) FROM kanban.card_attachment WHERE completed_at IS NULL')
      if (Number(count.rows[0].count) >= 256) throw fail(429, 'Too many pending uploads. Please retry later.')
      const card = await client.query('SELECT id FROM kanban.card WHERE id = $1', [cardId])
      if (!card.rows.length) throw fail(404, 'Card no longer exists')
      const { rows } = await client.query(`INSERT INTO kanban.card_attachment
        (card_id, object_key, filename, size, content_type, token_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, pg_catalog.now() + INTERVAL '10 minutes')
        RETURNING id, expires_at`, [cardId, objectKey, filename, body.size, contentType, tokenHash])
      await client.query('COMMIT')
      return {
        uploadId: rows[0].id,
        uploadUrl: `local-upload?token=${token}`,
        expiresAt: rows[0].expires_at,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      if (error.code === '23503') throw fail(404, 'Card no longer exists')
      throw error
    } finally {
      client.release()
    }
  }

  const upload = async (request, token) => {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail(403, 'Invalid upload token')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    // Claim once, in the database, so concurrent requests cannot share a token.
    const { rows } = await pool.query(`UPDATE kanban.card_attachment SET token_hash = NULL
      WHERE token_hash = $1 AND expires_at > pg_catalog.now() AND completed_at IS NULL
      RETURNING *`, [tokenHash])
    const row = rows[0]
    if (!row) throw fail(403, 'Upload token expired or already used. Choose the file again.')
    const key = row.object_key
    const temporary = objectPath(key, true)
    const destination = objectPath(key)
    active.add(key)
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 300000)
    deadline.unref()
    let published = false
    try {
      const expected = Number(row.size)
      const declared = request.headers['content-length']
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) !== expected)) {
        throw fail(400, 'File size does not match the upload request')
      }
      if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
        throw fail(415, 'Upload the original file bytes without content encoding')
      }
      let received = 0
      const limit = new Transform({
        transform: (chunk, encoding, callback) => {
          received += chunk.length
          if (received > expected || received > ATTACHMENT_MAX_BYTES) {
            callback(fail(413, 'Upload exceeds its declared size'))
            return
          }
          callback(null, chunk)
        },
      })
      await pipeline(request, limit, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600, flush: true }), { signal: controller.signal })
      if (received !== expected) throw fail(400, 'Upload was incomplete. Choose the file again.')
      // Only a complete, flushed file is published. Completion can recover if its DB update fails.
      await fs.promises.rename(temporary, destination)
      const directory = await fs.promises.open(root, fs.constants.O_RDONLY)
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
      published = true
      const result = await pool.query(`UPDATE kanban.card_attachment SET uploaded_at = pg_catalog.now()
        WHERE id = $1 RETURNING id`, [row.id])
      if (!result.rows.length) {
        await unlink(destination)
        throw fail(404, 'Card or attachment was removed during upload')
      }
      return { uploadId: row.id }
    } catch (error) {
      if (!published) {
        await unlink(temporary).catch((cleanupError) => console.error('Partial upload cleanup failed:', cleanupError.message))
        await unlink(destination).catch((cleanupError) => console.error('Upload cleanup failed:', cleanupError.message))
        await pool.query('DELETE FROM kanban.card_attachment WHERE id = $1', [row.id])
          .catch((cleanupError) => console.error('Upload metadata cleanup failed:', cleanupError.message))
      }
      throw error
    } finally {
      clearTimeout(deadline)
      active.delete(key)
    }
  }

  const complete = async (uploadId) => {
    const { rows } = await pool.query('SELECT * FROM kanban.card_attachment WHERE id = $1', [uuid(uploadId)])
    const row = rows[0]
    if (!row) throw fail(404, 'Upload no longer exists. Choose the file again.')
    if (row.completed_at) return metadata(row)
    if (active.has(row.object_key)) throw fail(409, 'Upload is still finishing. Retry saving the attachment.')
    let file
    try {
      file = await fs.promises.open(objectPath(row.object_key), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      const stat = await file.stat()
      if (!stat.isFile() || stat.size !== Number(row.size)) throw fail(409, 'Upload is incomplete. Choose the file again.')
    } catch (error) {
      if (error.code === 'ENOENT') throw fail(409, 'Upload is incomplete. Choose the file again.')
      throw error
    } finally {
      if (file) await file.close()
    }
    const result = await pool.query(`UPDATE kanban.card_attachment
      SET uploaded_at = COALESCE(uploaded_at, pg_catalog.now()),
        completed_at = COALESCE(completed_at, pg_catalog.now()), token_hash = NULL
      WHERE id = $1 RETURNING *`, [row.id])
    if (!result.rows.length) throw fail(404, 'Card or attachment no longer exists')
    return metadata(result.rows[0])
  }

  const list = async (cardId) => {
    const card = await pool.query('SELECT id FROM kanban.card WHERE id = $1', [uuid(cardId)])
    if (!card.rows.length) throw fail(404, 'Card no longer exists')
    const { rows } = await pool.query(`SELECT * FROM kanban.card_attachment
      WHERE card_id = $1 AND completed_at IS NOT NULL ORDER BY created_at, id`, [cardId])
    return rows.map(metadata)
  }

  const remove = async (id) => {
    await pool.query('DELETE FROM kanban.card_attachment WHERE id = $1', [uuid(id)])
    // The durable queue retries disk cleanup if it fails or the service stops.
    cleanup().catch((error) => console.error('Attachment cleanup failed:', error.message))
  }

  const download = async (id, response) => {
    const { rows } = await pool.query(`SELECT * FROM kanban.card_attachment
      WHERE id = $1 AND completed_at IS NOT NULL`, [uuid(id)])
    const row = rows[0]
    if (!row) throw fail(404, 'Attachment no longer exists')
    let file
    try {
      file = await fs.promises.open(objectPath(row.object_key), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      const stat = await file.stat()
      if (!stat.isFile() || stat.size !== Number(row.size)) throw fail(404, 'Attachment file is unavailable')
      const fallback = row.filename.replace(/[^a-z0-9._ -]/gi, '_')
      const encoded = encodeURIComponent(row.filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'no-store',
      })
      await pipeline(file.createReadStream({ autoClose: false }), response)
    } catch (error) {
      if (error.code === 'ENOENT') throw fail(404, 'Attachment file is unavailable')
      throw error
    } finally {
      if (file) await file.close()
    }
  }

  const stop = () => clearInterval(cleanupTimer)

  return { prepare, signUpload, upload, complete, list, remove, download, stop }
}

module.exports = createLocalStorage
