import { useEffect, useRef, useState } from 'react'
import { Button } from 'component-library'
import { attachmentUrl, listAttachments, removeAttachment } from './attachmentApi'
import AttachmentUploads from './AttachmentUploads'
import useAttachmentUploads, { ATTACHMENT_ADDED } from './useAttachmentUploads'

const formatSize = (size) => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const SavedAttachments = ({ cardId, busy }) => {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const { uploads, working: uploading, addFiles, retry } = useAttachmentUploads(cardId, busy || removing || loading)
  const working = removing || uploading
  const controller = useRef(null)
  const locked = useRef(false)

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
    const added = (event) => {
      if (event.detail.cardId !== cardId) return
      const { attachment } = event.detail
      setAttachments((items) => [...items.filter((item) => item.id !== attachment.id), attachment])
    }
    window.addEventListener(ATTACHMENT_ADDED, added)
    load(current.signal)
    return () => {
      current.abort()
      window.removeEventListener(ATTACHMENT_ADDED, added)
    }
  }, [cardId])

  const selectFiles = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    addFiles(files)
  }

  const remove = async (attachment) => {
    if (locked.current || busy || uploading) return
    locked.current = true
    setRemoving(true)
    setError('')
    const signal = controller.current.signal
    try {
      await removeAttachment(attachment.id, signal)
      if (!signal.aborted) setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    } catch (failure) {
      if (!signal.aborted) setError(`Could not remove ${attachment.filename}: ${failure.message}`)
    } finally {
      locked.current = false
      if (!signal.aborted) setRemoving(false)
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
    <AttachmentUploads uploads={uploads} disabled={busy || working || loading} onRetry={retry} />
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
