const paths = require('./paths')
const { readJson, readJsonAsync } = require('./jsonFile')

const hasLineage = (session) => Array.isArray(session.lineage) &&
  session.lineage.every(id => typeof id === 'string') &&
  new Set(session.lineage).size === session.lineage.length &&
  !session.lineage.includes(session.id) &&
  (session.parentSessionId ? session.lineage.at(-1) === session.parentSessionId : session.lineage.length === 0)

const complete = (session, lineage) => ({
  ...session,
  parentSessionId: session.parentSessionId || null,
  rootSessionId: session.rootSessionId || lineage[0] || session.id,
  lineage,
  depth: lineage.length,
})

// Existing files acquire cached ancestry on their next ordinary write.
const withAncestry = (session, writeDir, seen = new Set()) => {
  if (!session) return session
  if (seen.has(session.id)) throw new Error(`Session ancestry cycle at ${session.id}`)
  if (hasLineage(session)) return complete(session, session.lineage)
  seen.add(session.id)
  const parent = session.parentSessionId
    ? withAncestry(readJson(paths.sessionFile(session.parentSessionId, writeDir), null), writeDir, seen)
    : null
  return complete(session, parent ? [...parent.lineage, parent.id] : session.parentSessionId ? [session.parentSessionId] : [])
}

const withAncestryAsync = async (session, writeDir, seen = new Set()) => {
  if (!session) return session
  if (seen.has(session.id)) throw new Error(`Session ancestry cycle at ${session.id}`)
  if (hasLineage(session)) return complete(session, session.lineage)
  seen.add(session.id)
  const parent = session.parentSessionId
    ? await withAncestryAsync(await readJsonAsync(paths.sessionFile(session.parentSessionId, writeDir), null), writeDir, seen)
    : null
  return complete(session, parent ? [...parent.lineage, parent.id] : session.parentSessionId ? [session.parentSessionId] : [])
}

module.exports = { withAncestry, withAncestryAsync }
