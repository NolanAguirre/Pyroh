import {
  Card,
  CardHeader,
  CardSection,
  Matrix,
} from 'component-library'
import { Decision, Scope } from './shared'

const PanelsCard = ({ panels }) => (
  <Card>
    <CardHeader>Panels</CardHeader>
    <CardSection>
      <Matrix
        devId="r3p6l9a"
        rowDevId="r7p2q4z"
        className="registry__table"
        label="Registered panels"
        rowLabel="Panel"
        rows={panels}
        columns={[
          { id: 'decision', title: 'Decision' },
          { id: 'scope', title: 'Scope' },
          { id: 'placement', title: 'Placement' },
          { id: 'needsWorkspace', title: 'Needs workspace' },
        ]}
        renderRowHeader={(row) => (
          <span title={row.title || undefined}>
            <strong>{row.label}</strong> <code className="registry__id">{row.id}</code>
          </span>
        )}
        renderCell={(row, column) => {
          if (column.id === 'decision') return <Decision decision={row.decision} />
          if (column.id === 'scope') return <Scope scope={row.scope} />
          if (column.id === 'needsWorkspace') return row.needsWorkspace ? 'yes' : 'no'
          return row[column.id]
        }}
      />
    </CardSection>
  </Card>
)

export default PanelsCard
