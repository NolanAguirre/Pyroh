import {
  Card,
  CardHeader,
  CardSection,
  Matrix,
} from 'component-library'
import { Decision } from './shared'

const ToolsCard = ({ tools, modes }) => (
  <Card>
    <CardHeader>Tools by mode</CardHeader>
    <CardSection>
      {tools.length ? (
        <Matrix
          devId="r5t8b1n"
          rowDevId="r9t3c6j"
          className="registry__table"
          label="Tool decisions per mode"
          rowLabel="Tool"
          rows={tools}
          columns={modes.map((mode) => ({ id: mode.id, title: mode.label }))}
          renderRowHeader={(row) => (
            <span title={[row.hint, ...Object.entries(row.delivery || {}).map(([provider, how]) => `${provider}: ${how}`)].filter(Boolean).join('\n')}>
              <strong>{row.label}</strong> <code className="registry__id">{row.id}</code>
            </span>
          )}
          renderCell={(row, column) => (row.byMode[column.id] ? <Decision decision={row.byMode[column.id]} /> : '—')}
        />
      ) : (
        <p className="hint">No tools registered.</p>
      )}
    </CardSection>
  </Card>
)

export default ToolsCard
