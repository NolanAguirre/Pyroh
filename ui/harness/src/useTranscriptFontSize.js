import { useEffect, useRef, useState } from 'react'
import api from './api'

// Global UI settings. Changes save after a short pause.
const useTranscriptFontSize = () => {
  const [transcriptFontSize, setTranscriptFontSize] = useState(13)
  const [maxSubagentDepth, setMaxSubagentDepth] = useState(2)
  const [settingsError, setSettingsError] = useState('')
  const transcriptFontTouched = useRef(false)
  const maxSubagentDepthTouched = useRef(false)
  const fontSaveTimer = useRef(null)
  const depthSaveTimer = useRef(null)

  useEffect(() => {
    let cancelled = false
    api
      .getUiSettings()
      .then(({ settings }) => {
        if (cancelled || !settings) return
        if (!transcriptFontTouched.current && Number.isInteger(settings.transcriptFontSize)) {
          setTranscriptFontSize(settings.transcriptFontSize)
        }
        if (!maxSubagentDepthTouched.current && Number.isInteger(settings.maxSubagentDepth)
          && settings.maxSubagentDepth >= 0 && settings.maxSubagentDepth <= 10) {
          setMaxSubagentDepth(settings.maxSubagentDepth)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (fontSaveTimer.current) clearTimeout(fontSaveTimer.current)
      if (depthSaveTimer.current) clearTimeout(depthSaveTimer.current)
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

  const changeMaxSubagentDepth = (value) => {
    const next = Number(value)
    if (!Number.isInteger(next) || next < 0 || next > 10) return
    maxSubagentDepthTouched.current = true
    setMaxSubagentDepth(next)
    setSettingsError('')
    if (depthSaveTimer.current) clearTimeout(depthSaveTimer.current)
    depthSaveTimer.current = setTimeout(() => {
      api
        .setUiSettings({ maxSubagentDepth: next })
        .catch((err) => setSettingsError(err && err.message ? err.message : String(err)))
    }, 300)
  }

  return { transcriptFontSize, changeTranscriptFontSize, maxSubagentDepth, changeMaxSubagentDepth, settingsError }
}

export default useTranscriptFontSize
