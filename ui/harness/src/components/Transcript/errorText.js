export const errorText = (value) => {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if (typeof value.message === 'string' && value.message) return value.message
    if (typeof value.error === 'string' && value.error) return value.error
    try {
      const json = JSON.stringify(value)
      if (json && json !== '{}' && json !== 'null') return json
    } catch {
      // ignore
    }
  }
  return String(value)
}
