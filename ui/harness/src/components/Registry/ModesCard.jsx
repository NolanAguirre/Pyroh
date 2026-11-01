import {
  Badge,
  Card,
  CardHeader,
  CardSection,
  Matrix,
} from 'component-library'
import { Decision, Scope } from './shared'

const modeFlags = (flags, mode) => flags.filter((flag) => flag.modes.includes(mode.id))

const ModesCard = ({ modes, flags, onFlags }) => (
  <Card>
    <CardHeader>Modes</CardHeader>
    <CardSection>
      <Matrix
        devId="r2m7d4c"
        rowDevId="r6m1f9h"
        className="registry__table"
        label="Registered modes"
        rowLabel="Mode"
        rows={modes}
        columns={[
          { id: 'decision', title: 'Decision' },
          { id: 'scope', title: 'Scope' },
          { id: 'kind', title: 'Kind' },
          { id: 'base', title: 'Base' },
          { id: 'tools', title: 'Tools' },
          { id: 'flags', title: 'Flags' },
        ]}
        renderRowHeader={(row) => (
          <span title={row.hint || undefined}>
            <strong>{row.label}</strong> <code className="registry__id">{row.id}</code>
            {row.shadows && <span className="hint"> shadows {row.shadows}</span>}
          </span>
        )}
        renderCell={(row, column) => {
          if (column.id === 'decision') return <Decision decision={row.decision} />
          if (column.id === 'scope') return <span title={row.file || undefined}><Scope scope={row.scope} /> {row.source}</span>
          if (column.id === 'tools') return row.tools?.length ? row.tools.join(', ') : <span className="hint">—</span>
          if (column.id === 'flags') {
            return (
              <span className="registry__chips">
                {modeFlags(flags, row).map((flag) => (
                  <button key={flag.id} type="button" className="registry__flag-link" title={flag.description} onClick={onFlags}>
                    <Badge size="small">{flag.label}</Badge>
                  </button>
                ))}
              </span>
            )
          }
          return row[column.id] || <span className="hint">—</span>
        }}
      />
    </CardSection>
  </Card>
)

export default ModesCard
