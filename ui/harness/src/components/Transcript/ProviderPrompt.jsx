import { useState } from 'react'
import { CodeDiff, FoldContent, FoldDisplay, FoldTrigger } from 'component-library'

const kinds = {
  system: 'Harness instructions',
  user: 'User text',
  rewritten: 'Rewritten user text',
  context: 'Added context',
}

const ProviderPrompt = ({ prompt }) => {
  const [compare, setCompare] = useState(false)
  const sections = Array.isArray(prompt.sections)
    && prompt.sections.every((section) => typeof section?.text === 'string')
    && prompt.sections.map((section) => section.text).join('') === prompt.text
    ? prompt.sections
    : [{ kind: 'unknown', label: 'Captured prompt · sources unavailable', text: prompt.text }]
  const legend = [...new Map(sections.map((section) => {
    const kind = kinds[section.kind] ? section.kind : 'unknown'
    const label = section.label || kinds[kind] || 'Source unavailable'
    return [`${kind}:${label}`, { kind, label }]
  })).values()]
  const hasOriginal = typeof prompt.originalText === 'string'
  const hasRewrite = hasOriginal && typeof prompt.rewrittenText === 'string'
    && prompt.originalText !== prompt.rewrittenText

  return (
    <div className="tx__provider-prompt">
      <div className="tx__prompt-legend" aria-label="Prompt sources">
        {legend.map(({ kind, label }) => (
          <span key={`${kind}:${label}`} className={`tx__prompt-source tx__prompt-source--${kind}`}>
            {label}
          </span>
        ))}
      </div>
      <div className="tx__user-body tx__prompt-text">{sections.map((section, index) => (
        <span
          key={index}
          className={`tx__prompt-section tx__prompt-section--${kinds[section.kind] ? section.kind : 'unknown'}`}
          title={section.label || kinds[section.kind] || 'Source unavailable'}
        >{section.text}</span>
      ))}</div>
      {hasRewrite && (
        <FoldDisplay isOpen={compare} toggle={() => setCompare((value) => !value)}>
          <FoldTrigger>Compare original and rewritten user text</FoldTrigger>
          <FoldContent>
            {compare && (
              <>
                <div className="tx__prompt-compare-labels"><span>Original</span><span>Rewritten</span></div>
                <CodeDiff original={prompt.originalText} modified={prompt.rewrittenText} filename="prompt.txt" devId="hpr7c2d" />
              </>
            )}
          </FoldContent>
        </FoldDisplay>
      )}
      <p className="tx__prompt-note">
        Exact text passed to {prompt.provider || 'the agent'} by Harness. Provider-managed system instructions and project files are separate.
      </p>
    </div>
  )
}

export default ProviderPrompt
