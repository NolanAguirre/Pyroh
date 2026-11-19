import { createContext, useContext, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './MarkdownPreview.css'

// Matches the list marker and task box at the start of a list item's source.
const TASK_PATTERN = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/

const ToggleContext = createContext(null)
const ItemOffsetContext = createContext(null)

export const isMarkdown = (text) => text.trimStart().startsWith('#')

// Each li exposes its source offset so its checkbox can flip the exact box, even on duplicate lines.
const ListItem = ({ node, children, ...props }) => {
  return (
    <ItemOffsetContext.Provider value={node?.position?.start.offset ?? null}>
      <li {...props}>{children}</li>
    </ItemOffsetContext.Provider>
  )
}

const Input = ({ node, ...props }) => {
  const toggle = useContext(ToggleContext)
  const offset = useContext(ItemOffsetContext)
  if (props.type !== 'checkbox' || !toggle || offset === null) return <input {...props} />
  return <input {...props} disabled={false} className={`markdown-preview__checkbox ${props.className ?? ''}`.trim()} onChange={() => toggle(offset)} />
}

const CopyIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const CheckIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const CopyButton = ({ text, size = 14 }) => {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <button
      type="button"
      className="markdown-preview__copy"
      aria-label={copied ? 'Copied' : 'Copy code'}
      title={copied ? 'Copied' : 'Copy'}
      onClick={copy}
    >
      {copied ? <CheckIcon size={size} /> : <CopyIcon size={size} />}
    </button>
  )
}

// Fenced blocks are pre > code. The hast text includes one trailing newline that is not in the source.
const fenceParts = (node) => {
  const code = node?.children?.find((child) => child.tagName === 'code')
  const raw = (code?.children ?? []).map((child) => child.value ?? '').join('')
  const className = code?.properties?.className
  const classes = Array.isArray(className) ? className.join(' ') : className || ''
  return { text: raw.endsWith('\n') ? raw.slice(0, -1) : raw, className: classes }
}

const Pre = ({ node }) => {
  const { text, className } = fenceParts(node)
  return (
    <div className="markdown-preview__block">
      <CopyButton text={text} />
      <pre><code className={className || undefined}>{text}</code></pre>
    </div>
  )
}

const inlineText = (children) => {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map((child) => (typeof child === 'string' ? child : '')).join('')
  return ''
}

const Code = ({ children }) => (
  <span className="markdown-preview__inline">
    <code>{children}</code>
    <CopyButton text={inlineText(children)} size={12} />
  </span>
)

const components = { li: ListItem, input: Input, pre: Pre, code: Code }

const MarkdownPreview = ({ text, className = '', onTextChange }) => {
  const toggle = (offset) => {
    const match = TASK_PATTERN.exec(text.slice(offset))
    if (!match) return
    const at = offset + match[1].length
    onTextChange(text.slice(0, at) + (match[2] === ' ' ? 'x' : ' ') + text.slice(at + 1))
  }

  return (
    <div className={`markdown-preview tx__markdown ${className}`.trim()}>
      <ToggleContext.Provider value={onTextChange ? toggle : null}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
      </ToggleContext.Provider>
    </div>
  )
}

export default MarkdownPreview
