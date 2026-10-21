import { useEffect, useState } from 'react'
import { DevScope } from 'component-library'
import api from '../../api'

const MatchText = ({ text, column, length }) => {
  const start = Math.max((column || 1) - 1, 0)
  const end = start + Math.max(length || 0, 0)
  return (
    <span className="explorer-search__text">
      {text.slice(0, start)}
      <mark className="explorer-search__hit">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </span>
  )
}

const FileSearch = ({ devId, workspaceId, onOpen, children }) => {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const trimmed = query.trim()

  useEffect(() => {
    if (!trimmed) {
      setResult(null)
      setError(null)
      setSearching(false)
      return undefined
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      api.fsSearch(workspaceId, trimmed, { signal: controller.signal })
        .then((data) => {
          setResult(data)
          setError(null)
        })
        .catch((err) => {
          if (err && err.name === 'AbortError') return
          setResult(null)
          setError(err && err.message ? err.message : 'Search failed')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [workspaceId, trimmed])

  const shown = result && result.query === trimmed ? result : null
  const files = shown?.files || []
  const matchCount = files.reduce((sum, file) => sum + file.matches.length, 0)

  return (
    <div className="explorer-search">
      <DevScope id={devId} state={{ query: trimmed.length, matches: matchCount, searching, error: Boolean(error) }}>
        <div className="explorer-search__field">
          <input
            className="explorer-search__input"
            type="search"
            value={query}
            placeholder="Search"
            aria-label="Search in workspace"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setQuery('')
              }
            }}
          />
        </div>
      </DevScope>
      {trimmed ? (
        <div className="explorer-search__results" role="list">
          {error && <p className="explorer-search__status explorer-search__status--error">{error}</p>}
          {!error && searching && !shown && <p className="explorer-search__status">Searching…</p>}
          {!error && shown && matchCount === 0 && (
            <p className="explorer-search__status">No results</p>
          )}
          {files.map((file) => (
            <div key={file.path} className="explorer-search__file">
              <div className="explorer-search__path" title={file.path}>{file.path}</div>
              {file.matches.map((match) => (
                <button
                  key={`${file.path}:${match.line}:${match.column}`}
                  type="button"
                  className="explorer-search__line"
                  role="listitem"
                  onClick={() => onOpen(file.path, match.line, match.column)}
                >
                  <span className="explorer-search__ln">{match.line}</span>
                  <DevScope id="b8n3q7w" state={{ path: file.path, line: match.line }}>
                    <MatchText text={match.text} column={match.textColumn} length={match.textLength} />
                  </DevScope>
                </button>
              ))}
            </div>
          ))}
          {shown?.truncated && (
            <p className="explorer-search__status">Showing the first {matchCount} matches</p>
          )}
        </div>
      ) : children}
    </div>
  )
}

export default FileSearch
