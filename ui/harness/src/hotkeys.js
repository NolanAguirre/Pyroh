export const DEFAULT_HOTKEYS = {
  newChat: { key: ' ', ctrl: true, alt: false, shift: false, meta: false },
}

export const hotkeyFromEvent = (event) => {
  if (event.isComposing || event.repeat || event.getModifierState?.('AltGraph')) return null
  if (['Control', 'Alt', 'Shift', 'Meta', 'Dead', 'Unidentified'].includes(event.key)) return null
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F([1-9]|1[0-2])$/.test(event.key)) return null
  return { key: event.key.toLowerCase(), ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey }
}

export const matchesHotkey = (event, hotkey) => Boolean(hotkey
  && event.key.toLowerCase() === hotkey.key
  && event.ctrlKey === hotkey.ctrl && event.altKey === hotkey.alt
  && event.shiftKey === hotkey.shift && event.metaKey === hotkey.meta)

export const formatHotkey = (hotkey) => {
  if (!hotkey) return 'Disabled'
  const key = hotkey.key === ' ' ? 'Space' : hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key[0].toUpperCase() + hotkey.key.slice(1)
  return [hotkey.ctrl && 'Ctrl', hotkey.alt && 'Alt', hotkey.shift && 'Shift', hotkey.meta && 'Meta', key].filter(Boolean).join(' + ')
}
