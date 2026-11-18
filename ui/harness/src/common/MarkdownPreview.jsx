import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './MarkdownPreview.css'

export const isMarkdown = (text) => text.trimStart().startsWith('#')

const MarkdownPreview = ({ text, className = '' }) => {
  return (
    <div className={`markdown-preview tx__markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

export default MarkdownPreview
