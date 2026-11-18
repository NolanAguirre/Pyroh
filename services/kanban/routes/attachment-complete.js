const { createRoute, readJson, json } = require('../lib/attachment-http')

const createAttachmentCompleteRoute = (storage) => {
  return createRoute('/attachments/complete', {
    POST: async (request, response) => {
      const body = await readJson(request)
      json(response, 200, { attachment: await storage.complete(body.uploadId) })
    },
  })
}

module.exports = createAttachmentCompleteRoute
