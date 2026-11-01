const path = require('path')
const { reclaimIds } = require('../lib/store')
const { expandHome, findIds } = require('../lib/scan')

// Prefetched ids younger than this may belong to a turn that has not written
// them yet, so they are kept.
const CUTOFF_MS = 24 * 60 * 60 * 1000

const main = () => {
  const repos = process.argv.slice(2)
  if (!repos.length) {
    console.error('usage: node scripts/reclaim.js <repoDir> [repoDir...]')
    process.exit(1)
  }
  const found = repos.flatMap((raw) => findIds(path.resolve(expandHome(raw))))
  const deleted = reclaimIds(found, CUTOFF_MS)
  console.log(`reclaimed ${deleted} prefetched ids`)
}

main()
