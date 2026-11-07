import { useEffect, useRef, useState } from 'react'
import api from '../../api'

const metadata = ({ id, sessionId, name, mimeType, size }) => ({ id, sessionId, name, mimeType, size })
const fileData = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1])
  reader.onerror = () => reject(new Error('Could not read this image. Try attaching it again.'))
  reader.onabort = () => reject(new Error('Image reading was interrupted.'))
  reader.readAsDataURL(file)
})

const useSessionImages = (sessionId, initial) => {
  const [items, setItems] = useState(() => initial.attachments.map((entry) => entry.image
    ? { ...entry, image: metadata(entry.image), status: 'ready', error: '' }
    : { ...entry, status: 'failed', error: entry.error || 'Upload interrupted. Remove this image and attach it again.' }))
  const [error, setError] = useState(initial.imageError || '')
  const current = useRef(items)
  const files = useRef(new Map())
  const previews = useRef(new Map())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const url of previews.current.values()) URL.revokeObjectURL(url)
      previews.current.clear()
      files.current.clear()
    }
  }, [])

  const update = (next) => {
    current.current = next
    if (mounted.current) setItems(next)
  }
  const patch = (key, changes) => {
    if (mounted.current) update(current.current.map((entry) => entry.key === key ? { ...entry, ...changes } : entry))
  }
  const upload = async (key, file) => {
    patch(key, { status: 'uploading', error: '' })
    try {
      const data = await fileData(file)
      const { image } = await api.uploadSessionImage(sessionId, { name: file.name, mimeType: file.type, data })
      if (!image?.id) throw new Error('Upload returned no image reference. Retry the upload.')
      patch(key, { image: metadata(image), status: 'ready', error: '' })
    } catch (err) {
      patch(key, { status: 'failed', error: err.message || 'Image upload failed.' })
    }
  }
  const add = (incoming) => {
    if (current.current.length + incoming.length > 5) {
      setError('Attach at most 5 images.')
      return
    }
    const entries = incoming.map((file) => {
      const key = crypto.randomUUID()
      files.current.set(key, file)
      previews.current.set(key, URL.createObjectURL(file))
      return { key, name: file.name, mimeType: file.type, size: file.size, status: 'uploading' }
    })
    update([...current.current, ...entries])
    entries.forEach((entry, index) => { void upload(entry.key, incoming[index]) })
  }
  const remove = (key) => {
    const url = previews.current.get(key)
    if (url) URL.revokeObjectURL(url)
    previews.current.delete(key)
    files.current.delete(key)
    update(current.current.filter((entry) => entry.key !== key))
  }
  const clear = () => {
    for (const url of previews.current.values()) URL.revokeObjectURL(url)
    previews.current.clear()
    files.current.clear()
    update([])
    setError('')
  }
  return {
    draftItems: items,
    images: items.filter((entry) => entry.image).map((entry) => entry.image),
    items: items.map((entry) => ({
      ...entry,
      src: entry.image ? api.sessionImageUrl(sessionId, entry.image) : previews.current.get(entry.key),
      canRetry: entry.status === 'failed' && files.current.has(entry.key),
    })),
    blocked: Boolean(error) || items.some((entry) => entry.status !== 'ready'),
    error,
    setError,
    add,
    remove,
    retry: (key) => {
      const file = files.current.get(key)
      if (file && current.current.some((entry) => entry.key === key && entry.status === 'failed')) void upload(key, file)
    },
    clear,
  }
}

export default useSessionImages
