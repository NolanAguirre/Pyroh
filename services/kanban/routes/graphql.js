const createGraphqlRoute = (api) => {
  const handle = (request, response) => api.handle(request, response)
  return { path: '/graphql', handle }
}

module.exports = createGraphqlRoute
