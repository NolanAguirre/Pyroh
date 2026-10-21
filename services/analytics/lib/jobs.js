const db = require('./db')
const metrics = require('./metrics')

const toJob = (row) => row && ({
  id: Number(row.id),
  kind: row.kind,
  params: row.params,
  status: row.status,
  total: row.total,
  done: row.done,
  failed: row.failed,
  error: row.error,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
})

const errorText = (err) => (err && err.message ? err.message : String(err))

const loadSession = async (sessionId) => {
  const { rows } = await db.query(
    `SELECT id, workspace_id, provider, model, cwd, session_dir, events_path, source_fingerprint, meta
     FROM sessions WHERE id = $1`,
    [sessionId],
  )
  const row = rows[0]
  return row && {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    model: row.model,
    cwd: row.cwd,
    sessionDir: row.session_dir,
    eventsPath: row.events_path,
    fingerprint: row.source_fingerprint,
    meta: row.meta,
  }
}

const markRunning = (sessionId, metric) => db.query(
  `INSERT INTO metric_results (session_id, metric, status)
   VALUES ($1, $2, 'running')
   ON CONFLICT (session_id, metric) DO UPDATE SET status = 'running'`,
  [sessionId, metric],
)

const saveError = (session, metric, err, durationMs) => db.query(
  `INSERT INTO metric_results (session_id, metric, version, status, error, source_fingerprint, computed_at, duration_ms)
   VALUES ($1, $2, $3, 'error', $4, $5::jsonb, now(), $6)
   ON CONFLICT (session_id, metric) DO UPDATE SET
     version = EXCLUDED.version, status = 'error', error = EXCLUDED.error,
     source_fingerprint = EXCLUDED.source_fingerprint, computed_at = now(), duration_ms = EXCLUDED.duration_ms`,
  [session.id, metric.name, metric.version, errorText(err), JSON.stringify(session.fingerprint), durationMs],
)

const saveResult = (client, session, metric, result, durationMs) => client.query(
  `INSERT INTO metric_results (session_id, metric, version, status, result, error, source_fingerprint, computed_at, duration_ms)
   VALUES ($1, $2, $3, 'ok', $4::jsonb, NULL, $5::jsonb, now(), $6)
   ON CONFLICT (session_id, metric) DO UPDATE SET
     version = EXCLUDED.version, status = 'ok', result = EXCLUDED.result, error = NULL,
     source_fingerprint = EXCLUDED.source_fingerprint, computed_at = now(), duration_ms = EXCLUDED.duration_ms`,
  [session.id, metric.name, metric.version, JSON.stringify(result ?? null), JSON.stringify(session.fingerprint), durationMs],
)

// Computes one session/metric pair. The fingerprint saved is the one the
// last sync recorded, so files written mid-compute leave the pair stale.
const computePair = async ({ sessionId, metric: name }) => {
  const metric = metrics.get(name)
  if (!metric) throw new Error(`unknown metric: ${name}`)
  const session = await loadSession(sessionId)
  if (!session) throw new Error(`session not registered: ${sessionId}`)
  await markRunning(sessionId, name)
  const started = Date.now()
  try {
    const result = await metric.compute(session)
    await db.tx(async (client) => {
      if (metric.store) await metric.store(client, session, result)
      await saveResult(client, session, metric, metric.summary ? metric.summary(result) : result, Date.now() - started)
    })
  } catch (err) {
    await saveError(session, metric, err, Date.now() - started)
    throw err
  }
}

// In-process queue with bounded concurrency. Each task is one session/metric
// pair; a pair already queued absorbs later requests, and a pair already
// running is queued once more to pick up changes made meanwhile. Progress is
// counted against every job that asked for the pair.
const createJobQueue = ({ concurrency = 4, compute = computePair } = {}) => {
  const queue = []
  const pending = new Map()
  const running = new Map()
  let active = 0

  const keyOf = (task) => `${task.sessionId}\t${task.metric}`

  const recordProgress = async (jobIds, failed) => {
    for (const id of jobIds) {
      await db.query(
        `UPDATE jobs SET
           done = done + 1,
           failed = failed + $2,
           status = CASE WHEN done + 1 >= total THEN 'done' ELSE 'running' END,
           started_at = coalesce(started_at, now()),
           finished_at = CASE WHEN done + 1 >= total THEN now() ELSE finished_at END
         WHERE id = $1`,
        [id, failed ? 1 : 0],
      ).catch((err) => console.error(`jobs: progress for job ${id} failed: ${errorText(err)}`))
    }
  }

  const runTask = async (task) => {
    const jobIds = [...task.jobIds]
    await db.query(
      `UPDATE jobs SET status = 'running', started_at = coalesce(started_at, now())
       WHERE id = ANY($1::bigint[]) AND status = 'pending'`,
      [jobIds],
    ).catch(() => {})
    let failed = false
    try {
      await compute(task)
    } catch (err) {
      failed = true
      console.error(`jobs: ${task.metric} for ${task.sessionId} failed: ${errorText(err)}`)
    }
    await recordProgress(jobIds, failed)
  }

  const pump = () => {
    while (active < concurrency && queue.length) {
      const task = queue.shift()
      const key = keyOf(task)
      pending.delete(key)
      running.set(key, { next: null })
      active += 1
      runTask(task).finally(() => {
        active -= 1
        const slot = running.get(key)
        running.delete(key)
        if (slot && slot.next) {
          pending.set(key, slot.next)
          queue.push(slot.next)
        }
        pump()
      })
    }
  }

  const add = (pair, jobId) => {
    const key = keyOf(pair)
    const queued = pending.get(key)
    if (queued) {
      queued.jobIds.add(jobId)
      return
    }
    const slot = running.get(key)
    if (slot) {
      if (slot.next) slot.next.jobIds.add(jobId)
      else slot.next = { ...pair, jobIds: new Set([jobId]) }
      return
    }
    const task = { ...pair, jobIds: new Set([jobId]) }
    pending.set(key, task)
    queue.push(task)
  }

  // Records a job row and queues its pairs. Jobs without pairs finish at once.
  const enqueue = async ({ kind, params = {}, pairs }) => {
    const empty = pairs.length === 0
    const { rows } = await db.query(
      `INSERT INTO jobs (kind, params, status, total, finished_at)
       VALUES ($1, $2::jsonb, $3, $4, CASE WHEN $3 = 'done' THEN now() END)
       RETURNING *`,
      [kind, JSON.stringify(params), empty ? 'done' : 'pending', pairs.length],
    )
    const job = toJob(rows[0])
    for (const pair of pairs) add(pair, job.id)
    pump()
    return job
  }

  // Run once at startup: pairs and jobs left mid-flight by a previous process
  // are marked so they get picked up (pairs) or reported as abandoned (jobs).
  const recover = async () => {
    await db.query(`UPDATE metric_results SET status = 'pending' WHERE status = 'running'`)
    await db.query(
      `UPDATE jobs SET status = 'interrupted', finished_at = now()
       WHERE status IN ('pending', 'running')`,
    )
  }

  const stats = () => ({ queued: queue.length, running: active, concurrency })

  return { enqueue, recover, stats }
}

const getJob = async (id) => {
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id])
  return toJob(rows[0]) || null
}

const listJobs = async ({ limit = 50, offset = 0 } = {}) => {
  const { rows } = await db.query('SELECT * FROM jobs ORDER BY id DESC LIMIT $1 OFFSET $2', [limit, offset])
  return rows.map(toJob)
}

module.exports = { createJobQueue, getJob, listJobs }
