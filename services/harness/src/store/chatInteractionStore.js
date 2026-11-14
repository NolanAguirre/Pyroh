const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const eventLog = require('./eventLog')
const { readJson, readJsonAsync, writeJson } = require('./jsonFile')

const pending = new Map()
const fileFor = (sessionId, name, writeDir) => path.join(paths.sessionDir(sessionId, writeDir), name)
const timestamp = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const isUserMessage = record => {
  if (record.localCommand || record.handoff || record.delegationDelivery) return false
  const provenance = record.promptProvenance
  if (provenance?.messageType === 'agent') return false
  if (provenance?.sections?.length && provenance.sections.every(part => part.kind === 'system')) return false
  return Boolean(record.promptFile || record.prompt?.trim() || record.text?.trim() || record.images?.length)
}

// User sends are separate from the event checkpoint so streaming reads cannot
// overwrite a send accepted while an asynchronous log read is in flight.
const recordUser = (sessionId, at, writeDir) => {
  const file = fileFor(sessionId, 'last-user-interaction.json', writeDir)
  const previous = timestamp(readJson(file)?.lastInteractionAt)
  if (timestamp(at) > previous) writeJson(file, { lastInteractionAt: timestamp(at) })
}

const readRecords = async dir => {
  let names
  try {
    names = await fs.promises.readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  return Promise.all(names.filter(name => name.endsWith('.json') && !name.startsWith('.'))
    .map(name => readJsonAsync(path.join(dir, name))))
}

const historicalUserTime = async (sessionId, writeDir) => {
  const [runs, steers, queue] = await Promise.all([
    readRecords(paths.runsDir(sessionId, writeDir)),
    readRecords(paths.steerDir(sessionId, writeDir)),
    readJsonAsync(fileFor(sessionId, 'queued-messages.json', writeDir)),
  ])
  let latest = 0
  for (const run of runs) {
    if (!run) continue
    if (Object.hasOwn(run, 'userSentAt')) latest = Math.max(latest, timestamp(run.userSentAt))
    else if (!run.queuedMessage && isUserMessage(run)) latest = Math.max(latest, timestamp(run.startedAt))
  }
  for (const message of [...steers, ...(queue?.messages || [])]) {
    if (message && !message.queuedMessageId && isUserMessage(message)) latest = Math.max(latest, timestamp(message.createdAt))
  }
  return latest
}

const eventTime = event => {
  if (event.type === 'text' && typeof event.text === 'string' && event.text.length) return timestamp(event.ts)
  if (event.type === 'result' && typeof event.result === 'string' && event.result.trim()) return timestamp(event.ts)
  if (event.type === 'user' && event.messageType !== 'agent' && (event.text?.trim() || event.images?.length)) {
    return timestamp(event.interactionAt ?? event.ts)
  }
  return 0
}

const readLatest = async (sessionId, writeDir) => {
  const file = fileFor(sessionId, 'chat-interaction.json', writeDir)
  const saved = await readJsonAsync(file)
  let latest = timestamp(saved?.lastInteractionAt)
  if (!saved) latest = Math.max(latest, await historicalUserTime(sessionId, writeDir))
  let offset = saved?.offset || 0
  const eventsFile = paths.eventsFile(sessionId, writeDir)
  const size = await fs.promises.stat(eventsFile).then(stat => stat.size).catch(err => {
    if (err.code === 'ENOENT') return 0
    throw err
  })
  if (offset > size) offset = 0
  // Persist the byte checkpoint once per list refresh. Old logs are scanned
  // once, in chunks, and subsequent polls read only newly appended events.
  while (offset < size) {
    const batch = await eventLog.readFromAsync(sessionId, offset, writeDir, { maxBytes: 65536, end: size })
    for (const event of batch.events) latest = Math.max(latest, eventTime(event))
    if (batch.offset <= offset) break
    offset = batch.offset
  }
  if (!saved || saved.offset !== offset || timestamp(saved.lastInteractionAt) !== latest) {
    writeJson(file, { lastInteractionAt: latest || null, offset })
  }
  const sent = await readJsonAsync(fileFor(sessionId, 'last-user-interaction.json', writeDir))
  latest = Math.max(latest, timestamp(sent?.lastInteractionAt))
  return latest ? new Date(latest).toISOString() : null
}

const latest = (sessionId, writeDir) => {
  const key = fileFor(sessionId, 'chat-interaction.json', writeDir)
  if (!pending.has(key)) pending.set(key, readLatest(sessionId, writeDir).finally(() => pending.delete(key)))
  return pending.get(key)
}

module.exports = { isUserMessage, recordUser, latest }
