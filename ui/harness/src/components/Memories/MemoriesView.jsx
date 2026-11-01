import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  CardHeader,
  CardSection,
  DevScope,
  FormSearch,
} from 'component-library'
import api from '../../api'
import './Memories.css'

const formatDate = (ms) => (ms ? new Date(ms).toLocaleString() : '—')

const matches = (memory, query) => {
  if (!query) return true
  const needle = query.toLowerCase()
  return [memory.title, memory.content, memory.evidence, memory.sourceSessionId]
    .some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
}

const useMemories = () => {
  const [refreshToken, setRefreshToken] = useState(0)
  const [state, setState] = useState({ memories: [], error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    api
      .listMemories({}, { signal: controller.signal })
      .then((data) => setState({ memories: data.memories || [], error: null, loading: false }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState((prev) => ({ ...prev, error: err.message, loading: false }))
      })
    return () => controller.abort()
  }, [refreshToken])

  const replace = (memory) => setState((prev) => ({
    ...prev,
    memories: prev.memories.map((item) => (item.id === memory.id ? memory : item)),
  }))
  const remove = (id) => setState((prev) => ({
    ...prev,
    memories: prev.memories.filter((item) => item.id !== id),
  }))

  return { ...state, replace, remove, refresh: () => setRefreshToken((n) => n + 1) }
}

const SessionLink = ({ sessionId, onOpenSession, onError }) => (
  <button
    type="button"
    className="memories__session"
    title={`Open session ${sessionId}`}
    onClick={(event) => {
      event.stopPropagation()
      Promise.resolve(onOpenSession && onOpenSession(sessionId)).catch((err) => onError(err.message))
    }}
  >
    <code>{sessionId}</code>
  </button>
)

const toDraft = (memory) => ({ title: memory.title || '', content: memory.content || '', evidence: memory.evidence || '' })

const MemoryDetail = ({ memory, onSaved, onDeleted, onOpenSession }) => {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setDraft(null)
    setError(null)
  }, [memory.id])

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const save = () => run(async () => {
    const updated = await api.updateMemory(memory.id, draft)
    onSaved(updated)
    setDraft(null)
  })

  const remove = () => {
    if (!window.confirm(`Delete memory "${memory.title}"?`)) return
    run(async () => {
      await api.deleteMemory(memory.id)
      onDeleted(memory.id)
    })
  }

  const field = (name) => ({
    value: draft[name],
    disabled: busy,
    onChange: (event) => setDraft((prev) => ({ ...prev, [name]: event.target.value })),
  })

  return (
    <DevScope id="m2k9w6d" state={{ id: memory.id, editing: Boolean(draft), busy }}>
      <Card>
        <CardHeader>
          <div className="memories__detail-head">
            {draft
              ? <input className="form__input memories__title-input" aria-label="Title" {...field('title')} />
              : <span className="memories__detail-title">{memory.title}</span>}
            <div className="memories__actions">
              {draft ? (
                <>
                  <Button devId="m8c3v5j" variant="primary" size="sm" onClick={save} disabled={busy || !draft.title.trim() || !draft.content.trim()}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                  <Button devId="m4t7y1p" variant="secondary" size="sm" onClick={() => setDraft(null)} disabled={busy}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button devId="m6h2s9b" variant="secondary" size="sm" onClick={() => setDraft(toDraft(memory))} disabled={busy}>
                    Edit
                  </Button>
                  <Button devId="m1p5x8k" variant="danger" size="sm" onClick={remove} disabled={busy}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardSection>
          <dl className="memories__meta">
            <dt>Source session</dt>
            <dd><SessionLink sessionId={memory.sourceSessionId} onOpenSession={onOpenSession} onError={setError} /></dd>
            <dt>Memory session</dt>
            <dd><code>{memory.memorySessionId}</code></dd>
            <dt>Created</dt>
            <dd>{formatDate(memory.createdAt)}</dd>
            {memory.updatedAt && (
              <>
                <dt>Updated</dt>
                <dd>{formatDate(memory.updatedAt)}</dd>
              </>
            )}
          </dl>
          {error && <p className="memories__error">{error}</p>}
        </CardSection>
        <CardSection>
          <h4 className="memories__label">Content</h4>
          {draft
            ? <textarea className="form__textarea memories__textarea" rows={8} aria-label="Content" {...field('content')} />
            : <p className="memories__text">{memory.content}</p>}
        </CardSection>
        <CardSection>
          <h4 className="memories__label">Evidence</h4>
          {draft
            ? <textarea className="form__textarea memories__textarea" rows={5} aria-label="Evidence" {...field('evidence')} />
            : memory.evidence
              ? <p className="memories__text">{memory.evidence}</p>
              : <p className="hint">No evidence.</p>}
        </CardSection>
      </Card>
    </DevScope>
  )
}

const MemoriesView = ({ devId, onBack, onOpenSession }) => {
  const { memories, error, loading, refresh, replace, remove } = useMemories()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [linkError, setLinkError] = useState(null)

  const visible = memories.filter((memory) => matches(memory, query))
  const selected = memories.find((memory) => memory.id === selectedId) || null

  return (
    <DevScope id={devId} state={{ count: memories.length, visible: visible.length, selected: selectedId, loading }}>
      <div className="memories">
        <header className="memories__topbar">
          <Button devId="m3d9z4f" variant="secondary" size="sm" onClick={onBack}>
            ← Sessions
          </Button>
          <strong className="memories__title">Memories</strong>
          <div className="memories__filters">
            <FormSearch
              field={{ value: query, onChange: (e) => setQuery(e.target.value) }}
              placeholder="Search memories…"
            />
            <Button devId="m9f6b2w" variant="secondary" size="sm" onClick={refresh} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
          </div>
        </header>

        <main className="memories__body">
          <DevScope id="m0q4j7r" state={{ count: visible.length }}>
            <ul className="memories__list" aria-label="Memories">
              {error && <li className="memories__error">{error}</li>}
              {linkError && <li className="memories__error">{linkError}</li>}
              {!error && !loading && !visible.length && (
                <li className="hint">{memories.length ? 'No memories match.' : 'No memories yet.'}</li>
              )}
              {visible.map((memory) => (
                <li key={memory.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`memories__item${memory.id === selectedId ? ' memories__item--selected' : ''}`}
                    aria-pressed={memory.id === selectedId}
                    onClick={() => setSelectedId(memory.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setSelectedId(memory.id)
                    }}
                  >
                    <span className="memories__item-title">{memory.title}</span>
                    <span className="memories__item-meta">
                      <span>{formatDate(memory.createdAt)}</span>
                      <SessionLink sessionId={memory.sourceSessionId} onOpenSession={onOpenSession} onError={setLinkError} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </DevScope>
          <section className="memories__detail">
            {selected
              ? (
                <MemoryDetail
                  memory={selected}
                  onSaved={replace}
                  onDeleted={(id) => {
                    remove(id)
                    setSelectedId(null)
                  }}
                  onOpenSession={onOpenSession}
                />
              )
              : <p className="hint">Select a memory to view it.</p>}
          </section>
        </main>
      </div>
    </DevScope>
  )
}

export default MemoriesView
