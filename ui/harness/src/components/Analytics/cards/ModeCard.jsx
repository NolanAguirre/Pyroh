import { Card, CardHeader, CardRow, CardSection, DevScope, Matrix } from 'component-library'
import { formatNumber } from '../../../format'
import Stat from '../Stat'

const ModeCard = ({ byMode }) => {
  if (!byMode?.runs) return null
  const other = byMode.runs - byMode.subagent - byMode.nonNested

  return (
    <DevScope id="m4d3brk" state={{ runs: byMode.runs, subagent: byMode.subagent, nonNested: byMode.nonNested }}>
      <Card>
        <CardHeader>Modes</CardHeader>
        <CardRow>
          <Stat label="Runs" value={formatNumber(byMode.runs)} />
          <Stat label="Subagent runs" value={formatNumber(byMode.subagent)} />
          <Stat label="Non-nested runs" value={formatNumber(byMode.nonNested)} />
        </CardRow>
        <CardSection>
          <Matrix
            devId="n6w1mod"
            rowDevId="q3p7sub"
            className="analytics__table"
            label="Runs by mode"
            rowLabel="Mode"
            rows={byMode.modes.map((entry) => ({ id: entry.mode, ...entry }))}
            columns={[
              { id: 'runs', title: 'Runs' },
              { id: 'subagent', title: 'Subagent' },
              { id: 'nonNested', title: 'Non-nested' },
            ]}
            renderRowHeader={(row) => row.mode}
            renderCell={(row, column) => formatNumber(row[column.id])}
          />
          <p className="hint">Subagent runs are custom spawned children. Non-nested runs have no parent.</p>
          {other > 0 && <p className="hint">Workflow runs stay in the mode total.</p>}
        </CardSection>
      </Card>
    </DevScope>
  )
}

export default ModeCard
