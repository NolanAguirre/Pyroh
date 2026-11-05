import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DevScope } from 'component-library'

const fenceOpen = (line) => {
  const match = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
  if (!match) return null
  return { marker: match[2], info: match[3].trim() }
}

const fenceClose = (line, marker) => {
  const match = line.match(/^\s*(`{3,}|~{3,})\s*$/)
  if (!match) return false
  const close = match[1]
  return close[0] === marker[0] && close.length >= marker.length
}

const languageOf = (info) => (info.split(/\s+/)[0] || '').replace(/[^A-Za-z0-9_+#.-]/g, '')

const fenceLine = (line) => fenceOpen(line) !== null

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const CodeFence = ({ language, code }) => {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="transcript__code">
      <div className="transcript__code-bar">
        {language ? <span className="transcript__code-lang">{language}</span> : null}
        <DevScope id="hr4c8k2">
          <button
            type="button"
            className="transcript__code-copy"
            aria-label={copied ? 'Copied' : 'Copy code'}
            title={copied ? 'Copied' : 'Copy'}
            onClick={copy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </DevScope>
      </div>
      <pre className="transcript__code-pre"><code>{code}</code></pre>
    </div>
  )
}

const isSeparatorRow = (line) => /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(line)

const isTableRow = (line) => {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return body.split('|').length >= 2
}

const splitMarkdownTables = (text) => {
  const lines = String(text).split('\n')
  const parts = []
  let buffer = []

  const flush = () => {
    if (!buffer.length) return
    parts.push({ kind: 'text', text: buffer.join('\n') })
    buffer = []
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index].replace(/\r$/, '')
    const open = fenceOpen(line)
    if (open) {
      flush()
      const body = []
      index += 1
      while (index < lines.length && !fenceClose(lines[index].replace(/\r$/, ''), open.marker)) {
        body.push(lines[index].replace(/\r$/, ''))
        index += 1
      }
      if (index < lines.length) index += 1
      parts.push({ kind: 'code', language: languageOf(open.info), text: body.join('\n') })
      continue
    }
    const next = lines[index + 1]?.replace(/\r$/, '')
    if (next !== undefined && isTableRow(line) && isSeparatorRow(next)) {
      flush()
      const table = [line, next]
      index += 2
      while (index < lines.length) {
        const row = lines[index].replace(/\r$/, '')
        if (fenceLine(row) || !isTableRow(row) || isSeparatorRow(row)) break
        table.push(row)
        index += 1
      }
      parts.push({ kind: 'table', text: table.join('\n') })
      continue
    }
    buffer.push(line)
    index += 1
  }
  flush()
  return parts
}

const TextWithTables = ({ text }) => {
  const parts = splitMarkdownTables(text)
  if (!parts.some((part) => part.kind !== 'text')) {
    return <span className="transcript__text">{text}</span>
  }
  return (
    <div className="transcript__text">
      {parts.map((part, index) => {
        if (part.kind === 'table') {
          return (
            <div key={index} className="transcript__table">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          )
        }
        if (part.kind === 'code') return <CodeFence key={index} language={part.language} code={part.text} />
        return <span key={index}>{part.text}</span>
      })}
    </div>
  )
}

export default TextWithTables
