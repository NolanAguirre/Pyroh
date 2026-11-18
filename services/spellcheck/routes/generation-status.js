const { isGenerationId, readGeneration } = require('../lib/generation')

const generationStatus = async (req, res) => {
  res.set('Cache-Control', 'no-store')
  if (!isGenerationId(req.params.id)) return res.status(400).json({ error: 'Invalid generation job id' })
  try {
    const job = await readGeneration(req.params.id)
    if (!job) return res.status(404).json({ error: 'Generation job not found or expired' })
    res.json(job)
  } catch (error) {
    console.error('generation status failed:', error)
    res.status(500).json({ error: error.message })
  }
}

module.exports = generationStatus
