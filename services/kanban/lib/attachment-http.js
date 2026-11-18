const fail = (status, message) => {
  return Object.assign(new Error(message), { status })
}

const json = (response, status, body) => {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

const readJson = async (request) => {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw fail(415, 'Send application/json')
  }
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16384) throw fail(413, 'Request is too large')
    chunks.push(chunk)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || Array.isArray(body) || typeof body !== 'object') throw fail(400, 'Invalid JSON object')
    return body
  } catch {
    throw fail(400, 'Invalid JSON object')
  }
}

const uuid = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw fail(400, 'Invalid attachment or card ID')
  }
  return value
}

const createRoute = (path, methods) => {
  const handle = async (request, response) => {
    try {
      const action = methods[request.method]
      if (!action) {
        response.setHeader('Allow', Object.keys(methods).join(', '))
        throw fail(405, 'Method not allowed')
      }
      const url = new URL(request.url, 'http://localhost')
      await action(request, response, url.searchParams)
    } catch (error) {
      if (!error.status) console.error('Attachment request failed:', error.message)
      if (response.headersSent) {
        response.destroy()
        return
      }
      json(response, error.status || 500, { error: error.status ? error.message : 'Attachment request failed. Please retry.' })
    }
  }
  return { path, handle }
}

module.exports = { fail, json, readJson, uuid, createRoute }
