import { TextArea } from 'component-library'
import usePromptEvaluation from '../components/Session/usePromptEvaluation'
import './PromptInput.css'

const PromptInput = ({ sessionId, evaluationContext, evaluationRevision, value, ...rest }) => {
  const text = value == null ? '' : String(value)
  const { result, error, pending } = usePromptEvaluation(sessionId, { ...evaluationContext, prompt: text }, evaluationRevision)

  return (
    <TextArea {...rest} value={value} highlights={result?.highlights}>
      <div className="prompt-feedback" aria-live="polite">
        {pending && text && <span className="hint">Checking prompt conditions…</span>}
        {error && <span className="prompt-feedback__error">Prompt conditions unavailable: {error}</span>}
        {result?.triggered?.map(trigger => (
          <span key={`${trigger.effect}:${trigger.id}`} className={`prompt-feedback__item prompt-feedback__item--${trigger.effect}`} title={trigger.description}>
            {trigger.effect === 'excluded' ? 'Excluded: ' : trigger.effect === 'command' ? 'Command: ' : 'Applied: '}{trigger.label}
          </span>
        ))}
      </div>
    </TextArea>
  )
}

export default PromptInput
