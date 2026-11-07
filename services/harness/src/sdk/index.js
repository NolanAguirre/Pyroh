// Register TypeScript once before loading the public contract or registry bridges.
require('tsx/cjs')
module.exports = require('./index.ts')
