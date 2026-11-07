import { useEffect, useState } from 'react'
import { Button, FileIcon } from 'component-library'
import api from '../../api'

const MessageFiles = ({ text, workspaceId, onOpenFile }) => {
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!workspaceId || !text) return
    const controller = new AbortController()
    api.fsMessageFiles(workspaceId, text, { signal: controller.signal })
      .then(({ files }) => {
        if (!controller.signal.aborted) setResult({ text, workspaceId, files })
      })
      .catch(() => { /* File lookup must not interrupt the reply. */ })
    return () => controller.abort()
  }, [text, workspaceId])

  const files = result?.text === text && result?.workspaceId === workspaceId ? result.files : []
  if (!files.length || !onOpenFile) return null

  return (
    <div className="transcript__message-files" role="group" aria-label="Files in this message">
      <strong>Files in this message</strong>
      <div className="transcript__message-file-links">
        {files.map((file) => (
          <Button
            key={file.path}
            devId="mf8r2k6"
            variant="ghost"
            size="sm"
            title={`Open in editor: ${file.path}`}
            aria-label={`Open in editor: ${file.path}`}
            onClick={() => onOpenFile(file.path)}
          >
            <FileIcon name={file.path} size={14} /> {file.path}
          </Button>
        ))}
      </div>
    </div>
  )
}

export default MessageFiles
