const { createRoute, readJson, json } = require('../lib/attachment-http')

const createPresignedUrlRoute = (storage) => {
  return createRoute('/presigned-url', {
    POST: async (request, response) => {
      const signed = await storage.signUpload(await readJson(request))
      json(response, 201, signed)
    },
  })
}

module.exports = createPresignedUrlRoute
