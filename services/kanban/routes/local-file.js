const { createRoute } = require('../lib/attachment-http')

const createLocalFileRoute = (storage) => {
  return createRoute('/local-file', {
    GET: async (request, response, query) => {
      await storage.download(query.get('id'), response)
    },
  })
}

module.exports = createLocalFileRoute
