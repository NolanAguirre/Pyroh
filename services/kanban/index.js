const http = require('node:http')
const { Pool } = require('pg')
const createApi = require('./lib/api')
const isLocalRequest = require('./lib/local-request')
const createGraphqlRoute = require('./routes/graphql')
const createGraphiqlRoute = require('./routes/graphiql')

const DATABASE_URL = process.env.DATABASE_URL
const PORT = Number(process.env.PORT || 6011)

const start = async () => {
  if (!DATABASE_URL) throw new Error('Set DATABASE_URL in services/kanban/env-dir first.')
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be between 1 and 65535.')

  const pool = new Pool({ connectionString: DATABASE_URL })
  const api = createApi(pool)
  const routes = [createGraphqlRoute(api), createGraphiqlRoute(api)]
  await api.prepare()

  const server = http.createServer((request, response) => {
    // Allow local clients and same-origin requests through the harness proxy.
    if (!isLocalRequest(request)) {
      response.writeHead(403).end('Local requests only')
      return
    }

    const pathname = (request.url || '').split('?')[0]
    const route = routes.find((candidate) => candidate.path === pathname)
    if (!route) {
      response.writeHead(404).end('Not found')
      return
    }
    route.handle(request, response)
  })

  server.on('error', (error) => {
    console.error(error.message)
    pool.end().finally(() => process.exit(1))
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Kanban API: http://127.0.0.1:${PORT}/graphql`)
    console.log(`GraphiQL: http://127.0.0.1:${PORT}/graphiql`)
  })

  const stop = () => {
    server.close(() => pool.end().finally(() => process.exit(0)))
    setTimeout(() => process.exit(1), 8000).unref()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

start().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
