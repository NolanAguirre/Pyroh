// Resolved image payloads belong only in provider requests, never prompt records.
const imageMetadata = (images = []) => images.map(({ id, sessionId, name, mimeType, size }) => ({
  id, sessionId, name, mimeType, size,
}))

module.exports = { imageMetadata }
