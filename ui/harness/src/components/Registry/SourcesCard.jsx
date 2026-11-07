import {
  Badge,
  Card,
  CardHeader,
  CardSection,
  Matrix,
} from 'component-library'
import { FilePath, Scope } from './shared'

const SourcesCard = ({ sources }) => (
  <Card>
    <CardHeader>Plugins</CardHeader>
    <CardSection>
      <Matrix
        devId="r7s2n4p"
        rowDevId="r1s6k8q"
        className="registry__table"
        label="Loaded plugins"
        rowLabel="Plugin"
        rows={sources.map((source) => ({ id: `${source.scope}:${source.name}`, ...source }))}
        columns={[
          { id: 'scope', title: 'Scope' },
          { id: 'modes', title: 'Modes' },
          { id: 'file', title: 'File' },
          { id: 'status', title: 'Status' },
        ]}
        renderRowHeader={(row) => row.name}
        renderCell={(row, column) => {
          if (column.id === 'scope') return <Scope scope={row.scope} />
          if (column.id === 'modes') return row.modes.length ? row.modes.join(', ') : <span className="hint">none</span>
          if (column.id === 'file') return <FilePath file={row.file} />
          return row.error
            ? <span className="registry__error" title={row.error}>{row.error}</span>
            : <Badge size="small" variant="success">loaded</Badge>
        }}
      />
      {!sources.some(source => ['global', 'workspace'].includes(source.scope)) && <p className="hint">No global or workspace plugins found.</p>}
    </CardSection>
  </Card>
)

export default SourcesCard
