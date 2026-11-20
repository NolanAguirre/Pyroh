import { useEffect, useId, useState } from 'react'

let loading

const loadMermaid = () => {
  if (!loading) {
    loading = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'dark',
        fontFamily: 'inherit',
      })
      return mermaid
    })
  }
  return loading
}

const MermaidDiagram = ({ code, fallback }) => {
  const reactId = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancel = false
    const id = `mermaid-${reactId}-${Math.random().toString(36).slice(2)}`
    loadMermaid().then(async (mermaid) => {
      try {
        const result = await mermaid.render(id, code)
        if (!cancel) setSvg(result.svg)
      } catch {
        if (!cancel) setSvg('')
      }
    }).catch(() => {
      if (!cancel) setSvg('')
    })
    return () => { cancel = true }
  }, [code, reactId])

  if (!svg) return fallback
  return (
    <div
      className="transcript__mermaid"
      role="img"
      aria-label="Diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default MermaidDiagram
