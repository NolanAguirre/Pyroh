import { Button } from 'component-library'

const AttachmentUploads = ({ uploads, disabled, onRetry }) => {
  if (!uploads.length) return null
  return <ul className="kanban__attachment-list column" aria-label="File uploads">
    {uploads.map((item) => <li className="kanban__attachment card-section" key={item.id}>
      <strong className="kanban__attachment-name">{item.filename}</strong>
      <p className="kanban__attachments-hint" role="status">{item.status}{item.status === 'Uploading' ? ` ${item.progress}%` : ''}</p>
      {item.status === 'Uploading' && <progress className="kanban__attachment-progress" max={100} value={item.progress} aria-label={`Uploading ${item.filename}`} />}
      {item.error && <p className="kanban__attachments-error" role="alert">{item.error}{item.uploaded ? ' The file was uploaded. Retry finishing without uploading it again.' : ''}</p>}
      {item.status === 'Failed' && <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => onRetry(item)} devId="attachment-retry">{item.uploaded ? 'Retry finishing' : 'Retry upload'}</Button>}
    </li>)}
  </ul>
}

export default AttachmentUploads
