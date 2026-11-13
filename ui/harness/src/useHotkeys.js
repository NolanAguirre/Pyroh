import { useEffect, useRef, useState } from 'react'
import api from './api'
import { DEFAULT_HOTKEYS } from './hotkeys'

const useHotkeys = () => {
  const [hotkeys, setHotkeys] = useState(DEFAULT_HOTKEYS)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    api.getUiSettings().then(({ settings }) => {
      if (!cancelled) setHotkeys({ ...DEFAULT_HOTKEYS, ...settings?.hotkeys })
    }).catch((err) => {
      if (!cancelled) setError(err.message)
    }).finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [])

  const changeHotkey = async (action, binding) => {
    if (!ready || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const { settings } = await api.setUiSettings({ hotkeys: { ...hotkeys, [action]: binding } })
      setHotkeys(settings.hotkeys)
    } catch (err) {
      setError(err.message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return { hotkeys, changeHotkey, ready, saving, error }
}

export default useHotkeys
