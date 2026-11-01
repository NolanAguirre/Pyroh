import { DevScope } from 'component-library'
import PromptCard from './PromptCard'
import usePrompts from './usePrompts'

const PromptsView = () => {
  const { prompts, error, replace } = usePrompts()
  if (error) return <DevScope id="9kbs589"><p className="registry__error">{error}</p></DevScope>
  if (!prompts) return <DevScope id="62o4caw"><p className="hint">Loading prompts…</p></DevScope>
  const groups = [...new Set(prompts.map((prompt) => prompt.group))]
  return (
    <DevScope id="r8q4w1v">
      {groups.map((group) => (
        <DevScope key={group} id="va0d167" state={{ group }}>
          <section className="registry__prompt-group">
            <h3 className="registry__group-title">{group}</h3>
            <div className="registry__flags">
              {prompts.filter((prompt) => prompt.group === group).map((prompt) => <PromptCard key={prompt.id} prompt={prompt} onSaved={replace} />)}
            </div>
          </section>
        </DevScope>
      ))}
    </DevScope>
  )
}

export default PromptsView
