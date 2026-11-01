import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const fenceLine = (line) => /^\s*(```|~~~)/.test(line)

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
  let inFence = false

  const flush = () => {
    if (!buffer.length) return
    parts.push({ kind: 'text', text: buffer.join('\n') })
    buffer = []
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index].replace(/\r$/, '')
    if (fenceLine(line)) {
      inFence = !inFence
      buffer.push(line)
      index += 1
      continue
    }
    const next = lines[index + 1]?.replace(/\r$/, '')
    if (!inFence && next !== undefined && isTableRow(line) && isSeparatorRow(next)) {
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
  if (!parts.some((part) => part.kind === 'table')) {
    return <span className="transcript__text">{text}</span>
  }
  return (
    <div className="transcript__text">
      {parts.map((part, index) => (
        part.kind === 'table'
          ? (
            <div key={index} className="transcript__table">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          )
          : <span key={index}>{part.text}</span>
      ))}
    </div>
  )
}

export default TextWithTables
