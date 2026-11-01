import { useEffect, useRef, useState } from 'react'
import api from './api'

// Transcript font size from UI settings. Changes save after a short pause.
const useTranscriptFontSize = () => {
  const [transcriptFontSize, setTranscriptFontSize] = useState(13)
  const [settingsError, setSettingsError] = useState('')
  const transcriptFontTouched = useRef(false)
  const fontSaveTimer = useRef(null)

  useEffect(() => {
    let cancelled = false
    api
      .getUiSettings()
      .then(({ settings }) => {
        if (cancelled || transcriptFontTouched.current) return
        if (settings && Number.isInteger(settings.transcriptFontSize)) {
          setTranscriptFontSize(settings.transcriptFontSize)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (fontSaveTimer.current) clearTimeout(fontSaveTimer.current)
    }
  }, [])

  const changeTranscriptFontSize = (value) => {
    const next = Number(value)
    if (!Number.isInteger(next)) return
    transcriptFontTouched.current = true
    setTranscriptFontSize(next)
    setSettingsError('')
    if (fontSaveTimer.current) clearTimeout(fontSaveTimer.current)
    fontSaveTimer.current = setTimeout(() => {
      api
        .setUiSettings({ transcriptFontSize: next })
        .catch((err) => setSettingsError(err && err.message ? err.message : String(err)))
    }, 300)
  }

  return { transcriptFontSize, changeTranscriptFontSize, settingsError }
}

export default useTranscriptFontSize
