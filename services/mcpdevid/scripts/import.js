const path = require('path')
const { importIds } = require('../lib/store')
const { expandHome, findIds } = require('../lib/scan')

const main = () => {
  const repos = process.argv.slice(2)
  if (!repos.length) {
    console.error('usage: node scripts/import.js <repoDir> [repoDir...]')
    process.exit(1)
  }
  repos.forEach((raw) => {
    const repoDir = path.resolve(expandHome(raw))
    const ids = findIds(repoDir)
    const added = importIds(ids, repoDir)
    console.log(`${repoDir}: found ${ids.length}, new ${added}`)
  })
}

main()
