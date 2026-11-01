import { useMemo, useRef } from 'react'
import { TRIGGERS, findTriggers } from 'prompt-triggers'

const triggerById = new Map(TRIGGERS.map((trigger) => [trigger.id, trigger]))

// Splits text into plain strings and highlighted trigger matches.
const segments = (text, matches) => {
  const out = []
  let last = 0
  matches.forEach((match, i) => {
    if (match.start > last) out.push(text.slice(last, match.start))
    out.push(<mark key={i} data-trigger={match.id}>{match.text}</mark>)
    last = match.end
  })
  out.push(text.slice(last))
  return out
}

// Textarea over a mirrored backdrop that highlights prompt trigger matches,
// with a chip per firing trigger. `steer` skips triggers steers cannot fire.
const PromptInput = ({ value, onChange, onKeyDown, rows, placeholder, className, steer = false }) => {
  const backdropRef = useRef(null)
  const text = value || ''
  const matches = useMemo(() => findTriggers(text, { steer }), [text, steer])
  const fired = useMemo(
    () => [...new Set(matches.map((match) => match.id))].map((id) => triggerById.get(id)).filter(Boolean),
    [matches],
  )

  const syncScroll = (e) => {
    if (!backdropRef.current) return
    backdropRef.current.scrollTop = e.target.scrollTop
    backdropRef.current.scrollLeft = e.target.scrollLeft
  }

  return (
    <div className="prompt-input">
      <div className="prompt-input__field">
        <div className="prompt-input__backdrop" ref={backdropRef} aria-hidden="true">
          {segments(text, matches)}
          {/* A trailing newline needs a character after it to take up a line. */}
          {text.endsWith('\n') ? ' ' : null}
        </div>
        <textarea
          className={className}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          rows={rows}
        />
      </div>
      {fired.length > 0 && (
        <div className="prompt-input__chips">
          {fired.map((trigger) => (
            <span key={trigger.id} className="prompt-input__chip" title={trigger.description}>
              {trigger.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default PromptInput
