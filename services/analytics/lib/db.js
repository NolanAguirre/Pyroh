const { Pool } = require('pg')
const config = require('./config')

const pool = new Pool({ connectionString: config.databaseUrl })

pool.on('error', (err) => {
  console.error(`pg: idle client error: ${err.message}`)
})

const query = (text, params) => pool.query(text, params)

// Runs fn(client) inside BEGIN/COMMIT, rolling back if it throws.
const tx = async (fn) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

const close = () => pool.end()

module.exports = { query, tx, close }
