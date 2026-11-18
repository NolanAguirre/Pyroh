import { useEffect, useRef, useState } from 'react'
import { completeAttachment, prepareAttachment, uploadAttachment } from './attachmentApi'

export const ATTACHMENT_ADDED = 'kanban-attachment-added'

const useAttachmentUploads = (cardId, busy) => {
  const [uploads, setUploads] = useState([])
  const [working, setWorking] = useState(false)
  const controller = useRef(null)
  const locked = useRef(false)
  const sequence = useRef(0)

  useEffect(() => {
    const current = new AbortController()
    controller.current = current
    return () => current.abort()
  }, [cardId])

  const updateUpload = (item, changes) => {
    Object.assign(item, changes)
    setUploads((current) => current.map((entry) => entry.id === item.id ? { ...item } : entry))
  }

  const runUploads = async (items) => {
    if (locked.current || busy || !controller.current || controller.current.signal.aborted) return
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
          updateUpload(item, { status: 'Complete', file: null })
          window.dispatchEvent(new CustomEvent(ATTACHMENT_ADDED, { detail: { cardId, attachment: result.attachment } }))
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

  const addFiles = (files) => {
    if (locked.current || busy || !files.length) return false
    const items = Array.from(files, (file) => ({ id: ++sequence.current, file, filename: file.name, status: 'Queued', progress: 0 }))
    setUploads((current) => [...current.filter((item) => item.status !== 'Complete'), ...items])
    runUploads(items)
    return true
  }

  const retry = (item) => runUploads([item])
  return { uploads, working, addFiles, retry }
}

export default useAttachmentUploads
