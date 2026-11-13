const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const GRAPHQL_URL = `${APP_BASE}/kanban-api/graphql`

const request = async (query, variables) => {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) throw new Error(`Kanban API request failed (${response.status}). Check that the Kanban service is running.`)
  const result = await response.json()
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('\n'))
  if (!result.data) throw new Error('The Kanban API returned no data.')
  return result.data
}

const createClient = () => {
  const queries = new Map()
  const query = (document, variables) => {
    const key = JSON.stringify([document, variables])
    if (queries.has(key)) return queries.get(key)
    const listeners = new Set()
    let state = { data: null, error: null, loading: true }
    let pending = null
    let generation = 0
    const publish = (next) => {
      state = next
      listeners.forEach((listener) => listener())
    }
    const load = (force = false) => {
      if (pending && !force) return pending
      const current = ++generation
      publish({ ...state, error: null, loading: true })
      pending = request(document, variables).then((data) => {
        if (current === generation) publish({ data, error: null, loading: false })
        return data
      }).catch((error) => {
        if (current === generation) publish({ ...state, error, loading: false })
        throw error
      }).finally(() => {
        if (current === generation) pending = null
      })
      return pending
    }
    const entry = {
      load,
      snapshot: () => state,
      active: () => listeners.size > 0,
      subscribe: (listener) => {
        listeners.add(listener)
        queries.set(key, entry)
        return () => {
          listeners.delete(listener)
          if (!listeners.size) queries.delete(key)
        }
      },
    }
    queries.set(key, entry)
    return entry
  }
  const mutate = async ({ mutation, variables }) => {
    const data = await request(mutation, variables)
    // Refresh mounted connections after writes so moves, deletes, and replies
    // retain the source GraphQL contract without a schema-introspection cache.
    await Promise.allSettled([...queries.values()].filter((entry) => entry.active()).map((entry) => entry.load(true)))
    return data
  }
  return { query, mutate }
}

export const client = createClient()
