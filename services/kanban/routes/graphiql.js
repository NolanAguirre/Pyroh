const createGraphiqlRoute = (api) => {
  const handle = (request, response) => api.handle(request, response)
  return { path: '/graphiql', handle }
}

module.exports = createGraphiqlRoute
