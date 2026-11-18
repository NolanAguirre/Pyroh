import { useEffect, useRef, useState } from 'react'
import { Button } from 'component-library'
import { attachmentUrl, completeAttachment, listAttachments, prepareAttachment, removeAttachment, uploadAttachment } from './attachmentApi'

const formatSize = (size) => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const SavedAttachments = ({ cardId, busy }) => {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploads, setUploads] = useState([])
  const [working, setWorking] = useState(false)
  const controller = useRef(null)
  const locked = useRef(false)
  const sequence = useRef(0)

  const load = async (signal) => {
    setLoading(true)
    setError('')
    try {
      const result = await listAttachments(cardId, signal)
      if (!signal.aborted) setAttachments(result.attachments)
    } catch (failure) {
      if (!signal.aborted) setError(failure.message)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    load(current.signal)
    return () => current.abort()
  }, [cardId])

  const updateUpload = (item, changes) => {
    Object.assign(item, changes)
    setUploads((current) => current.map((entry) => entry.id === item.id ? { ...item } : entry))
  }

  const runUploads = async (items) => {
    if (locked.current || busy) return
    locked.current = true
    setWorking(true)
    const signal = controller.current.signal
    try {
      for (const entry of items) {
        const item = { ...entry }
        if (signal.aborted) break
        try {
          if (!item.uploaded) {
            updateUpload(item, { status: 'Preparing', error: '', progress: 0 })
            const prepared = await prepareAttachment(cardId, item.file, signal)
            if (signal.aborted) break
            updateUpload(item, { uploadId: prepared.uploadId, status: 'Uploading' })
            await uploadAttachment(prepared.uploadUrl, item.file, (progress) => {
              if (!signal.aborted) updateUpload(item, { progress })
            }, signal)
            if (signal.aborted) break
            updateUpload(item, { uploaded: true, progress: 100 })
          }
          updateUpload(item, { status: 'Finishing', error: '' })
          const result = await completeAttachment(item.uploadId, signal)
          if (signal.aborted) break
          setAttachments((current) => [...current.filter((entry) => entry.id !== result.attachment.id), result.attachment])
          updateUpload(item, { status: 'Complete', file: null })
        } catch (failure) {
          if (signal.aborted) break
          updateUpload(item, { status: 'Failed', error: failure.message })
        }
      }
    } finally {
      locked.current = false
      if (!signal.aborted) setWorking(false)
    }
  }

  const selectFiles = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (locked.current || busy || !files.length) return
    const items = files.map((file) => ({ id: ++sequence.current, file, filename: file.name, status: 'Queued', progress: 0 }))
    setUploads((current) => [...current.filter((item) => item.status !== 'Complete'), ...items])
    runUploads(items)
  }

  const remove = async (attachment) => {
    if (locked.current || busy) return
    locked.current = true
    setWorking(true)
    setError('')
    const signal = controller.current.signal
    try {
      await removeAttachment(attachment.id, signal)
      if (!signal.aborted) setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    } catch (failure) {
      if (!signal.aborted) setError(`Could not remove ${attachment.filename}: ${failure.message}`)
    } finally {
      locked.current = false
      if (!signal.aborted) setWorking(false)
    }
  }

  return <>
    {loading && <p className="kanban__attachments-hint" role="status">Loading attachments…</p>}
    {error && <div className="kanban__attachments-error" role="alert">
      <p>{error}</p>
      <Button type="button" variant="secondary" size="sm" disabled={busy || working || loading} onClick={() => load(controller.current.signal)} devId="attachments-reload">Reload attachments</Button>
    </div>}
    {!loading && !error && !attachments.length && <p className="kanban__attachments-hint">No attachments yet.</p>}
    <ul className="kanban__attachment-list column">
      {attachments.map((attachment) => <li className="kanban__attachment card-section" key={attachment.id}>
        <a className="kanban__attachment-name" href={attachmentUrl(attachment.id)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${attachment.filename}`}>{attachment.filename}</a>
        <div className="kanban__attachment-meta row">
          <span>{formatSize(attachment.size)}</span>
          <time dateTime={attachment.createdAt}>{new Date(attachment.createdAt).toLocaleString()}</time>
        </div>
        <div className="kanban__attachment-actions row">
          <a href={attachmentUrl(attachment.id)} download={attachment.filename}>Download</a>
          <Button type="button" variant="danger" size="sm" disabled={busy || working || loading} onClick={() => remove(attachment)} aria-label={`Remove ${attachment.filename}`} devId="attachment-remove">Remove</Button>
        </div>
      </li>)}
    </ul>
    <label className="kanban__attachments-picker">Add files
      <input type="file" multiple disabled={busy || working || loading} onChange={selectFiles} />
    </label>
    <p className="kanban__attachments-hint">Files upload one at a time. Keep this editor open until uploads finish.</p>
    {uploads.length > 0 && <ul className="kanban__attachment-list column" aria-label="File uploads">
      {uploads.map((item) => <li className="kanban__attachment card-section" key={item.id}>
        <strong className="kanban__attachment-name">{item.filename}</strong>
        <p className="kanban__attachments-hint" role="status">{item.status}{item.status === 'Uploading' ? ` ${item.progress}%` : ''}</p>
        {item.status === 'Uploading' && <progress className="kanban__attachment-progress" max={100} value={item.progress} aria-label={`Uploading ${item.filename}`} />}
        {item.error && <p className="kanban__attachments-error" role="alert">{item.error}{item.uploaded ? ' The file was uploaded. Retry finishing without uploading it again.' : ''}</p>}
        {item.status === 'Failed' && <Button type="button" variant="secondary" size="sm" disabled={busy || working || loading} onClick={() => runUploads([item])} devId="attachment-retry">{item.uploaded ? 'Retry finishing' : 'Retry upload'}</Button>}
      </li>)}
    </ul>}
  </>
}

const TaskAttachments = ({ cardId, busy }) => {
  return <section className="kanban__attachments" aria-label="Card attachments">
    <h3>Attachments</h3>
    {cardId
      ? <SavedAttachments key={cardId} cardId={cardId} busy={busy} />
      : <p className="kanban__attachments-hint">Save this card before adding attachments.</p>}
  </section>
}

export default TaskAttachments
