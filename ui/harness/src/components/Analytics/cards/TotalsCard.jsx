import { BarChart, Card, CardHeader, CardSection, DevScope } from 'component-library'
import { formatNumber } from '../../../format'
import { OTHER } from '../constants'
import { bucketLabel } from '../format'

const TotalsCard = ({ overTime }) => {
  const chartSeries = overTime
    ? [
      ...overTime.tools.map((id) => ({ id, title: id })),
      ...(overTime.hasOther ? [{ id: OTHER, title: 'other', color: '#6b7280' }] : []),
    ]
    : []
  const chartBars = overTime
    ? overTime.rows.map((row) => ({
      id: row.bucket,
      label: bucketLabel(row.bucket, overTime.bucket),
      values: { ...row.counts, [OTHER]: row.other },
    }))
    : []
  const totalBars = chartSeries.map((item) => ({
    id: item.id,
    label: item.title,
    values: {
      [item.id]: chartBars.reduce((sum, bar) => sum + (Number(bar.values?.[item.id]) || 0), 0),
    },
  })).filter((bar) => bar.values[bar.id] > 0)

  return (
    <DevScope id="h3p7c1m" state={{ bars: totalBars.length }}>
      <Card>
        <CardHeader>Totals</CardHeader>
        <CardSection>
          <BarChart
            devId="r6v9d2x"
            barDevId="t4b8s0j"
            label="Total tool calls"
            bars={totalBars}
            series={chartSeries}
            height={200}
            showLegend={false}
            formatValue={formatNumber}
          />
        </CardSection>
      </Card>
    </DevScope>
  )
}

export default TotalsCard
