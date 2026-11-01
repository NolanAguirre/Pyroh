import { useEffect, useRef } from 'react'

const GroupNameInput = ({ commit, cancel }) => {
  const inputRef = useRef(null)
  const doneRef = useRef(false)
  const armedRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return undefined
    input.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => {
      armedRef.current = true
      if (document.activeElement !== input) input.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const finish = async (event, action) => {
    event.preventDefault()
    event.stopPropagation()
    if (doneRef.current) return
    doneRef.current = true
    const result = action()
    const ok = result && typeof result.then === 'function' ? await result : result
    if (ok === false) {
      doneRef.current = false
      inputRef.current?.focus()
    }
  }

  return (
    <input
      ref={inputRef}
      className="terminal-group-name__input"
      type="text"
      placeholder="Group name"
      aria-label="Group name"
      spellCheck={false}
      autoComplete="off"
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(event, () => commit(event.currentTarget.value))
        else if (event.key === 'Escape') finish(event, () => cancel())
      }}
      onBlur={(event) => {
        if (doneRef.current || !armedRef.current) return
        const value = event.currentTarget.value.trim()
        finish(event, () => (value ? commit(value) : cancel()))
      }}
    />
  )
}

export default GroupNameInput
