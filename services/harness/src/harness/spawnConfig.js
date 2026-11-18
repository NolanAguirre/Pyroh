const config = require('../config')
const { natsConfig } = require('./natsConfig')

module.exports = natsConfig(config)
