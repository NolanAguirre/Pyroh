import { createContext, useContext } from 'react'
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

const components = { li: ListItem, input: Input }

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
