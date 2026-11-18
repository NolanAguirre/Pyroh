const { createRoute, json } = require('../lib/attachment-http')

const createAttachmentsRoute = (storage) => {
  return createRoute('/attachments', {
    GET: async (request, response, query) => {
      json(response, 200, { attachments: await storage.list(query.get('cardId')) })
    },
    DELETE: async (request, response, query) => {
      await storage.remove(query.get('id'))
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
    },
  })
}

module.exports = createAttachmentsRoute
