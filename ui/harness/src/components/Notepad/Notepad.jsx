import { useEffect, useId, useRef, useState } from 'react'
import { DevScope, FormTextarea } from 'component-library'
import api from '../../api'
import MarkdownPreview, { isMarkdown } from '../../common/MarkdownPreview'
import './Notepad.css'

const SAVE_DELAY_MS = 500
const DEFAULT_FILE = 'notepad.txt'

// Serialize writes, including edits flushed when the popup closes.
let writes = Promise.resolve()
const saveNote = (text, file) => {
  writes = writes.catch(() => {}).then(() => api.saveNote(text, file))
  return writes
}

const Notepad = ({ devId }) => {
  const id = useId()
  const [files, setFiles] = useState([DEFAULT_FILE])
  const [displayNames, setDisplayNames] = useState({})
  const [rename, setRename] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')
  const namesRevision = useRef(0)
  const [activeFile, setActiveFile] = useState(DEFAULT_FILE)
  const [notes, setNotes] = useState({})
  const [creating, setCreating] = useState(false)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const cache = useRef({})
  const pending = useRef(null)
  const mounted = useRef(false)

  const setNote = (file, patch) => {
    cache.current = { ...cache.current, [file]: { ...cache.current[file], ...patch } }
    if (mounted.current) setNotes(cache.current)
  }

  const save = (file, next) => {
    saveNote(next, file)
      .then(() => {
        if (cache.current[file]?.text === next) setNote(file, { error: '' })
      })
      .catch((err) => {
        if (cache.current[file]?.text === next) setNote(file, { error: err.message })
      })
  }

  const flush = () => {
    if (!pending.current) return
    const { timer, file, text } = pending.current
    clearTimeout(timer)
    pending.current = null
    save(file, text)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      flush()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const revision = namesRevision.current
    api.listNoteFiles()
      .then((body) => {
        if (cancelled) return
        setFiles((current) => [...new Set([...body.files, ...current])])
        if (revision === namesRevision.current) setDisplayNames(body.displayNames || {})
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => { cancelled = true }
  }, [retry])

  useEffect(() => {
    if (typeof cache.current[activeFile]?.text === 'string') return
    let cancelled = false
    writes.catch(() => {})
      .then(() => api.getNote(activeFile))
      .then((body) => {
        if (cancelled) return
        setNote(activeFile, { text: body.text || '', error: '' })
      })
      .catch((err) => {
        if (!cancelled) setNote(activeFile, { error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [activeFile, retry])

  const updateText = (next) => {
    setNote(activeFile, { text: next })
    if (pending.current) clearTimeout(pending.current.timer)
    const timer = setTimeout(() => {
      pending.current = null
      save(activeFile, next)
    }, SAVE_DELAY_MS)
    pending.current = { timer, file: activeFile, text: next }
  }

  const selectFile = (file) => {
    flush()
    setActiveFile(file)
  }

  const addFile = async () => {
    flush()
    setCreating(true)
    setError('')
    try {
      const body = await api.createNoteFile()
      if (!mounted.current) return
      // Edits can continue while the new file is being created.
      flush()
      setNote(body.file, { text: body.text, error: '' })
      setFiles((current) => [...new Set([...current, body.file])])
      setActiveFile(body.file)
    } catch (err) {
      if (mounted.current) setError(err.message)
    } finally {
      if (mounted.current) setCreating(false)
    }
  }

  const submitRename = async (event) => {
    event.preventDefault()
    if (renaming || !rename) return
    const displayName = rename.name.trim()
    if (!displayName || displayName.length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(displayName)) {
      setRenameError('Name must be 1–120 characters without control characters')
      return
    }
    setRenaming(true)
    setRenameError('')
    try {
      const body = await api.renameNoteFile(rename.file, displayName)
      if (!mounted.current) return
      namesRevision.current += 1
      setDisplayNames((current) => ({ ...current, [body.file]: body.displayName }))
      setRename(null)
    } catch (err) {
      if (mounted.current) setRenameError(err.message)
    } finally {
      if (mounted.current) setRenaming(false)
    }
  }

  const onTabKeyDown = (event, index) => {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % files.length
    else if (event.key === 'ArrowLeft') next = (index + files.length - 1) % files.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = files.length - 1
    else return
    event.preventDefault()
    selectFile(files[next])
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus()
  }

  const note = notes[activeFile]
  const text = note?.text || ''
  const loaded = typeof note?.text === 'string'
  const message = error || note?.error
  const onChange = (event) => updateText(event.target.value)

  const markdown = isMarkdown(text)

  return (
    <DevScope id={devId} state={{ loaded, error: Boolean(message) }}>
      <div className={markdown ? 'notepad notepad--markdown' : 'notepad'}>
        <h2 className="notepad__title">Notepad</h2>
        <div className="notepad__files">
          <div className="notepad__tabs" role="tablist" aria-label="Note files">
            {files.map((file, index) => (
              <button
                key={file}
                id={`${id}-tab-${index}`}
                type="button"
                role="tab"
                aria-selected={file === activeFile}
                aria-controls={`${id}-panel`}
                tabIndex={file === activeFile ? 0 : -1}
                className="notepad__tab"
                title={file}
                onClick={() => selectFile(file)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >{displayNames[file] || file}</button>
            ))}
          </div>
          <button type="button" className="notepad__add" onClick={addFile} disabled={creating}>
            {creating ? 'Adding…' : '+ Add file'}
          </button>
          <button type="button" className="notepad__rename-button" disabled={renaming} onClick={() => {
            setRename({ file: activeFile, name: displayNames[activeFile] || activeFile })
            setRenameError('')
          }}>Rename</button>
        </div>
        {rename && <form className="notepad__rename" onSubmit={submitRename}>
          <label htmlFor={`${id}-name`}>Name for {displayNames[rename.file] || rename.file}</label>
          <input
            id={`${id}-name`}
            className="notepad__name"
            value={rename.name}
            onChange={(event) => setRename({ ...rename, name: event.target.value })}
            maxLength={120}
            required
            autoFocus
            disabled={renaming}
            aria-invalid={Boolean(renameError)}
            aria-describedby={renameError ? `${id}-rename-error` : undefined}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                if (!renaming) setRename(null)
              }
            }}
          />
          <button type="submit" className="notepad__rename-button" disabled={renaming}>{renaming ? 'Saving…' : 'Save name'}</button>
          <button type="button" className="notepad__rename-button" disabled={renaming} onClick={() => setRename(null)}>Cancel</button>
          {renameError && <p id={`${id}-rename-error`} className="notepad__error" role="alert">{renameError}</p>}
        </form>}
        <div className="notepad__body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${files.indexOf(activeFile)}`}>
          <DevScope id="5dty75y">
            <FormTextarea
              className="form__textarea notepad__text"
              aria-label={displayNames[activeFile] || activeFile}
              placeholder={loaded ? 'Write anything…' : note?.error ? 'Unable to load note' : 'Loading…'}
              disabled={!loaded}
              field={{ value: text, onChange }}
            />
          </DevScope>
          {markdown && <MarkdownPreview className="notepad__preview" text={text} onTextChange={loaded ? updateText : undefined} />}
        </div>
        {message && <DevScope id="2a8tbkp"><p className="notepad__error" role="alert">
          {message}{' '}
          <button type="button" className="notepad__retry" onClick={() => {
            setError('')
            if (loaded && note.error) {
              flush()
              save(activeFile, text)
            }
            setRetry((value) => value + 1)
          }}>Retry</button>
        </p></DevScope>}
      </div>
    </DevScope>
  )
}

export default Notepad
