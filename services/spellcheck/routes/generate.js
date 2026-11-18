const { enqueueGeneration, validateGeneration } = require('../lib/generation')

const generate = async (req, res) => {
  const error = validateGeneration(req.body)
  if (error) return res.status(400).json({ error })
  try {
    res.status(202).json(await enqueueGeneration(req.body))
  } catch (error) {
    console.error('generation enqueue failed:', error)
    res.status(500).json({ error: error.message })
  }
}

module.exports = generate
