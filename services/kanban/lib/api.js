const { postgraphile } = require('postgraphile')

const createApi = (pool) => {
  const middleware = postgraphile(pool, 'kanban', {
    graphqlRoute: '/graphql',
    graphiqlRoute: '/graphiql',
    // Resolve beside GraphiQL, including when nginx strips /kanban-api/.
    externalGraphqlRoute: 'graphql',
    graphiql: true,
    enhanceGraphiql: true,
    disableQueryLog: true,
    retryOnInitFail: false,
    graphileBuildOptions: { pgStrictFunctions: true },
  })

  const prepare = async () => {
    await pool.query('SELECT id FROM kanban.board LIMIT 0')
    await middleware.getGraphQLSchema()
  }

  const handle = (request, response) => middleware(request, response)

  return { prepare, handle }
}

module.exports = createApi
