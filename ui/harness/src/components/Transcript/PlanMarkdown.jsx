import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from 'component-library'

const PlanMarkdown = ({ plan }) => {
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    if (!plan) return
    navigator.clipboard?.writeText(plan).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  if (!plan) return <p className="hint">Writing plan…</p>

  return (
    <div className="tx__markdown-wrap">
      <div className="tx__markdown-actions">
        <Button
          variant={raw ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={raw}
          onClick={() => setRaw((on) => !on)}
          devId="hr3k8m2"
        >
          Raw
        </Button>
        <Button variant="ghost" size="sm" onClick={copy} devId="hr6p1w4">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {raw
        ? <pre className="tx__pre tx__markdown-raw">{plan}</pre>
        : (
          <div className="tx__markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
          </div>
        )}
    </div>
  )
}

export default PlanMarkdown
