import { useEffect, useRef, useState } from 'react'
import api from './api'
import { matchesHotkey } from './hotkeys'
import { defaultSessionOptions } from './newSessionDefaults'

const useNewChatHotkey = ({ enabled, binding, workspace, providers, onCreated }) => {
  const busy = useRef(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || !workspace || !binding) return
    const onKeyDown = async (event) => {
      if (event.defaultPrevented || event.isComposing || event.getModifierState?.('AltGraph')) return
      if (event.target.closest?.('[data-hotkey-recorder], .xterm')) return
      if (!matchesHotkey(event, binding)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat || busy.current) return
      setError('')
      const options = defaultSessionOptions(providers)
      const provider = providers.find((item) => item.id === options.provider)
      if (!provider || !provider.implemented || provider.error) {
        setError(provider?.error || 'The default provider is unavailable. Try again when it is ready.')
        return
      }
      busy.current = true
      try {
        const { session } = await api.createSession({ workspaceId: workspace.id, ...options })
        onCreated(session)
      } catch (err) {
        setError(err.message)
      } finally {
        busy.current = false
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled, binding, workspace, providers, onCreated])

  return error
}

export default useNewChatHotkey
