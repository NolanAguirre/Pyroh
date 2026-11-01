import {
  Badge,
  Card,
  CardHeader,
  CardSection,
  DevScope,
} from 'component-library'
import { Scope } from './shared'

const FlagModes = ({ ids, modes }) => (ids.length ? (
  <span className="registry__chips">
    {ids.map((id) => <Badge key={id} size="small" variant="primary">{modes.find((mode) => mode.id === id)?.label || id}</Badge>)}
  </span>
) : <span className="hint">No modes.</span>)

const FlagsView = ({ flags, modes }) => (
  <DevScope id="r6f3x8k">
    <div className="registry__flags">
      {flags.map((flag) => (
        <DevScope key={flag.id} id="mv7ep8a" state={{ id: flag.id }}>
          <Card>
            <CardHeader>
              <strong>{flag.label}</strong> <code className="registry__id">{flag.id}</code>
            </CardHeader>
            <CardSection>
              <p className="registry__flag-desc">{flag.description}</p>
              {flag.text && <pre className="registry__prompt">{flag.text}</pre>}
              {flag.id === 'instructions' && flag.modes.map((id) => {
                const mode = modes.find((item) => item.id === id)
                return (
                  <DevScope key={id} id="91gajph" state={{ id }}>
                    <div className="registry__flag-instr">
                      <div className="registry__rules-head"><strong>{mode?.label || id}</strong> <Scope scope={mode?.scope} /></div>
                      <pre className="registry__prompt">{mode?.instructions === '(function)' ? 'Built by the plugin on each run.' : mode?.instructions}</pre>
                    </div>
                  </DevScope>
                )
              })}
              <div className="registry__flag-modes">
                <span className="hint">Included in</span> <FlagModes ids={flag.modes} modes={modes} />
              </div>
            </CardSection>
          </Card>
        </DevScope>
      ))}
    </div>
  </DevScope>
)

export default FlagsView
