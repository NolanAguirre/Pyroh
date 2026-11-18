import { useEffect, useRef, useState } from 'react'
import AttachmentUploads from './AttachmentUploads'
import useAttachmentUploads from './useAttachmentUploads'

export const isFileDrag = (event) => {
  const transfer = event.dataTransfer
  return Array.from(transfer?.types || []).includes('Files') || Array.from(transfer?.items || []).some((item) => item.kind === 'file')
}

export const rejectFileDrop = (event) => {
  if (!isFileDrag(event)) return false
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'none'
  return true
}

const AttachmentDropCard = ({ as: Tag = 'article', cardId, busy, className = '', children, ...props }) => {
  const { uploads, working, addFiles, retry } = useAttachmentUploads(cardId, busy)
  const [hovering, setHovering] = useState(false)
  const [error, setError] = useState('')
  const depth = useRef(0)
  const suppressClick = useRef(false)
  const unavailable = busy || working
  const clearHover = () => {
    depth.current = 0
    setHovering(false)
  }

  useEffect(() => {
    if (!hovering) return
    window.addEventListener('drop', clearHover)
    window.addEventListener('dragend', clearHover)
    window.addEventListener('blur', clearHover)
    return () => {
      window.removeEventListener('drop', clearHover)
      window.removeEventListener('dragend', clearHover)
      window.removeEventListener('blur', clearHover)
    }
  }, [hovering])

  const fileDrag = (event) => {
    if (!isFileDrag(event)) return false
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy'
    return true
  }

  return <Tag {...props} className={`${className} kanban__file-card${hovering ? ' kanban__file-card--hover' : ''}${hovering && unavailable ? ' kanban__file-card--unavailable' : ''}`}
    onDragEnterCapture={(event) => {
      if (!fileDrag(event)) return
      depth.current += 1
      setHovering(true)
    }}
    onDragOverCapture={(event) => {
      if (fileDrag(event)) setHovering(true)
    }}
    onDragLeaveCapture={(event) => {
      if (!isFileDrag(event) && !depth.current) return
      event.preventDefault()
      event.stopPropagation()
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current && !event.currentTarget.contains(event.relatedTarget)) clearHover()
    }}
    onDropCapture={(event) => {
      if (!fileDrag(event)) return
      clearHover()
      suppressClick.current = true
      const files = Array.from(event.dataTransfer.files || [])
      if (unavailable || !addFiles(files)) {
        setError(unavailable ? 'Wait until this card is ready, then drop the files again.' : 'No files could be attached. Drop files rather than folders.')
        return
      }
      setError('')
    }}
    onPointerDownCapture={(event) => {
      suppressClick.current = false
      props.onPointerDownCapture?.(event)
    }}
    onKeyDownCapture={(event) => {
      if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false
      props.onKeyDownCapture?.(event)
    }}
    onClickCapture={(event) => {
      if (suppressClick.current) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      props.onClickCapture?.(event)
    }}>
    {children}
    {hovering && <div className="kanban__file-drop-hint" role="status">{unavailable ? 'Wait until this card is ready' : 'Drop files to attach to this card'}</div>}
    {(uploads.length > 0 || error) && <div className="kanban__card-uploads">
      {error && <p className="kanban__attachments-error" role="alert">{error}</p>}
      {working && <p className="kanban__attachments-hint" role="status">Uploading attachments. Keep this card visible until uploads finish.</p>}
      <AttachmentUploads uploads={uploads} disabled={unavailable} onRetry={retry} />
    </div>}
  </Tag>
}

export default AttachmentDropCard
