const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_BASE = `${APP_BASE}/kanban-api/`

const request = async (path, { method = 'GET', body, signal } = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const result = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(result?.error || `Attachment request failed (${response.status}).`)
    error.status = response.status
    throw error
  }
  if (response.status !== 204 && !result) throw new Error('The attachment API returned no data.')
  return result
}

export const listAttachments = (cardId, signal) => request(`attachments?cardId=${encodeURIComponent(cardId)}`, { signal })
export const removeAttachment = (id, signal) => request(`attachments?id=${encodeURIComponent(id)}`, { method: 'DELETE', signal })
export const attachmentUrl = (id) => `${API_BASE}local-file?id=${encodeURIComponent(id)}`
export const prepareAttachment = (cardId, file, signal) => request('presigned-url', {
  method: 'POST',
  body: { cardId, filename: file.name, size: file.size, contentType: file.type || 'application/octet-stream' },
  signal,
})

export const completeAttachment = async (uploadId, signal) => {
  let attempts = 0
  while (attempts < 3) {
    try {
      return await request('attachments/complete', { method: 'POST', body: { uploadId }, signal })
    } catch (error) {
      attempts += 1
      if (signal.aborted || attempts === 3 || (error.status && error.status < 500)) throw error
    }
  }
}

export const uploadAttachment = (uploadUrl, file, onProgress, signal) => new Promise((resolve, reject) => {
  const base = new URL(API_BASE, window.location.href)
  const url = new URL(uploadUrl, base)
  if (url.origin !== base.origin || url.pathname !== `${base.pathname}local-upload` || url.username || url.password) {
    reject(new Error('The attachment API returned an invalid upload URL.'))
    return
  }
  if (signal.aborted) {
    reject(new Error('Upload cancelled.'))
    return
  }
  const xhr = new XMLHttpRequest()
  const abort = () => xhr.abort()
  const finish = (error) => {
    signal.removeEventListener('abort', abort)
    if (error) reject(error)
    else resolve()
  }
  xhr.open('PUT', url.href)
  xhr.timeout = 300000
  xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable && event.total > 0) onProgress(Math.round(event.loaded / event.total * 100))
  }
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      finish()
      return
    }
    let message = `Upload failed (${xhr.status}).`
    try { message = JSON.parse(xhr.responseText).error || message } catch {}
    finish(new Error(message))
  }
  xhr.onerror = () => finish(new Error('Upload failed. Check your connection and retry.'))
  xhr.ontimeout = () => finish(new Error('Upload timed out. Retry the file.'))
  xhr.onabort = () => finish(new Error('Upload cancelled.'))
  signal.addEventListener('abort', abort, { once: true })
  xhr.send(file)
})
