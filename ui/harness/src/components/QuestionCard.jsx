import { useEffect, useState } from 'react'
import { Badge, Button, CheckboxDisplay, DevScope, Fold, FoldTrigger, FoldContent } from 'component-library'

const draftKey = (questionId) => `harness.question.${questionId}.text`

const keepsDraft = (question) => !question.allowMultiple && question.allowFreeText !== false && !question.secret

const readDraft = (questionId) => {
  try {
    return localStorage.getItem(draftKey(questionId)) || ''
  } catch {
    return ''
  }
}

const writeDraft = (questionId, text) => {
  try {
    if (text) localStorage.setItem(draftKey(questionId), text)
    else localStorage.removeItem(draftKey(questionId))
  } catch {
    // ignore quota and private-mode failures
  }
}

const optionView = (option, index) => {
  if (typeof option === 'string' || typeof option === 'number') {
    const label = String(option)
    return { key: label, label }
  }
  if (option && typeof option === 'object') {
    const label = String(option.label || option.name || option.id || '')
    return { key: String(option.id || label || index), label }
  }
  return { key: String(index), label: '' }
}

const QuestionCard = ({ devId, question, onAnswer }) => {
  const draft = keepsDraft(question)
  const [selected, setSelected] = useState(() => new Set())
  const [other, setOther] = useState(() => draft ? readDraft(question.id) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!draft) return
    writeDraft(question.id, other)
  }, [draft, question.id, other])

  const submit = async (value) => {
    setBusy(true)
    setError('')
    try {
      await onAnswer(question.id, value)
      if (draft) {
        writeDraft(question.id, '')
        setOther('')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (option) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(option)) next.delete(option)
      else next.add(option)
      return next
    })
  }

  const submitMulti = () => {
    const values = [...selected]
    if (other.trim()) values.push(other.trim())
    submit(values)
  }

  return (
    <DevScope id={devId} state={{ id: question.id, multi: question.allowMultiple }}>
      <div className="question-card">
        <div className="question-card__header">
          <Badge variant="warning" size="small">Input Required</Badge>
          <span className="question-card__badge-sub">{question.allowMultiple ? 'Multiple choice' : 'Select an option'}</span>
        </div>
        <p className="question-card__q">{question.question}</p>
        {question.details && (
          <DevScope id="x8z2p4v">
            <Fold>
              <FoldTrigger>Request details</FoldTrigger>
              <FoldContent>
                <pre className="tx__pre">{JSON.stringify(question.details, null, 2)}</pre>
              </FoldContent>
            </Fold>
          </DevScope>
        )}
        {error && <p className="hint hint--error" role="alert">{error}</p>}

        {question.allowMultiple ? (
          <div className="question-card__multi">
            <div className="question-card__options">
              {question.options.map((option, index) => {
                const view = optionView(option, index)
                return (
                  <DevScope key={view.key} id="hr8k3w6" state={{ option: view.label }}>
                    <label className="question-card__option-row">
                      <CheckboxDisplay
                        id={`${question.id}-${view.key}`}
                        value={view.label}
                        label={view.label}
                        checked={selected.has(view.label)}
                        toggle={() => toggle(view.label)}
                      />
                    </label>
                  </DevScope>
                )
              })}
            </div>
            <div className="question-card__other">
              <DevScope id="hr5n0x2">
                <input
                  type="text"
                  className="text-input"
                  placeholder="Other options or remarks…"
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                />
              </DevScope>
              <Button variant="primary" onClick={submitMulti} loading={busy} devId="hr2d7q8">
                Submit answer
              </Button>
            </div>
          </div>
        ) : (
          <div className="question-card__single">
            <div className="question-card__buttons">
              {question.options.map((option, index) => {
                const view = optionView(option, index)
                return (
                  <Button
                    key={view.key}
                    variant="secondary"
                    onClick={() => submit(view.label)}
                    disabled={busy}
                    devId="hr6c4h1"
                    title={question.optionDescriptions?.[index] || undefined}
                  >
                    {view.label}
                  </Button>
                )
              })}
            </div>
            {question.allowFreeText !== false && (
              <div className="question-card__other">
                <DevScope id="hr9m5r3">
                  <input
                    type={question.secret ? 'password' : 'text'}
                    className="text-input"
                    placeholder="Type an answer…"
                    value={other}
                    onChange={(e) => setOther(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && other.trim()) submit(other.trim())
                    }}
                  />
                </DevScope>
                <Button
                  variant="primary"
                  onClick={() => submit(other.trim())}
                  disabled={busy || !other.trim()}
                  devId="hr3w8b7"
                >
                  Send
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </DevScope>
  )
}

export default QuestionCard
