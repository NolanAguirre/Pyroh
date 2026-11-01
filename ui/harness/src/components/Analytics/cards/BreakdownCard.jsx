import { Badge, Card, CardHeader, CardSection, DevScope, Matrix } from 'component-library'
import { formatNumber } from '../../../format'

const BreakdownCard = ({ breakdown, workspaceName }) => (
  <DevScope id="ezhdxb4" state={{ by: breakdown.by, groups: breakdown.groups.length }}>
    <Card>
      <CardHeader>By {breakdown.by}</CardHeader>
      <CardSection>
        <Matrix
          devId="htjgn7h"
          rowDevId="z9x5kpy"
          className="analytics__table"
          label={`Tool calls by ${breakdown.by}`}
          rowLabel={breakdown.by}
          rows={breakdown.groups.map((group) => ({ id: group.key, ...group }))}
          columns={[
            { id: 'count', title: 'Calls' },
            { id: 'runs', title: 'Runs' },
            { id: 'tools', title: 'Top tools' },
          ]}
          renderRowHeader={(row) => (breakdown.by === 'workspace' ? workspaceName(row.key) : row.key)}
          renderCell={(row, column) => {
            if (column.id !== 'tools') return formatNumber(row[column.id])
            return (
              <span className="analytics__chips">
                {row.tools.map((entry) => (
                  <Badge key={entry.tool} size="small">{`${entry.tool} ${entry.count}`}</Badge>
                ))}
              </span>
            )
          }}
        />
      </CardSection>
    </Card>
  </DevScope>
)

export default BreakdownCard
