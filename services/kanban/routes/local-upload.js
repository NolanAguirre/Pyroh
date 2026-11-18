const { createRoute, json } = require('../lib/attachment-http')

const createLocalUploadRoute = (storage) => {
  return createRoute('/local-upload', {
    PUT: async (request, response, query) => {
      json(response, 200, await storage.upload(request, query.get('token')))
    },
  })
}

module.exports = createLocalUploadRoute
