const os = require('os')
const path = require('path')

const expandHome = (raw) => {
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

const config = {
  host: process.env.HOST || 'localhost',
  port: Number(process.env.PORT || 6009),
  dbFile: path.resolve(expandHome(process.env.DB_FILE || path.join(__dirname, '../../../db/mcpdevid/mcpdevid.sqlite'))),
}

module.exports = config
