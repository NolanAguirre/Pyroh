import { useState } from 'react'
import { Card, CardHeader, CardSection, DevScope, Matrix, ProgressBar, SelectDisplay } from 'component-library'
import { formatNumber } from '../../../format'
import { ALL } from '../constants'

const LIMIT_OPTIONS = [
  ...['10', '25', '50'].map((value) => ({ value, displayValue: `Top ${value}` })),
  { value: ALL, displayValue: 'All tools' },
]

const ToolCard = ({ byTool = [], tool, toggleTool }) => {
  const [limit, setLimit] = useState('10')
  const shown = limit === ALL ? byTool : byTool.slice(0, Number(limit))
  const maxToolCount = byTool[0]?.count || 1

  return (
    <DevScope id="k27g7v7" state={{ tools: byTool.length, shown: shown.length, limit, tool }}>
      <Card>
        <CardHeader>
          <div className="analytics__card-header">
            <span>By tool</span>
            <SelectDisplay
              className="analytics__select"
              aria-label="Tool limit"
              selected={limit}
              options={LIMIT_OPTIONS}
              select={setLimit}
            />
          </div>
        </CardHeader>
        <CardSection>
          <Matrix
            devId="xcx97r7"
            rowDevId="dye0g66"
            className="analytics__table"
            label="Tool call counts"
            rowLabel="Tool"
            rows={shown.map((entry) => ({ id: entry.tool, ...entry }))}
            columns={[
              { id: 'share', title: 'Share' },
              { id: 'count', title: 'Calls' },
              { id: 'runs', title: 'Runs' },
              { id: 'perRun', title: 'Per run' },
            ]}
            renderRowHeader={(row) => (
              <button
                type="button"
                className={`analytics__link${row.tool === tool ? ' analytics__link--active' : ''}`}
                title={row.tool === tool ? 'Clear tool filter' : 'Filter to this tool'}
                onClick={() => toggleTool(row.tool)}
              >
                {row.tool}
              </button>
            )}
            renderCell={(row, column) => {
              if (column.id === 'share') {
                return (
                  <ProgressBar
                    label={`${row.pct}%`}
                    value={row.count}
                    max={maxToolCount}
                    addClassName="analytics__share"
                  />
                )
              }
              if (column.id === 'perRun') return row.perRun
              return formatNumber(row[column.id])
            }}
          />
          {!tool && <p className="hint">Click a tool to break its calls down by file, pattern, or command.</p>}
        </CardSection>
      </Card>
    </DevScope>
  )
}

export default ToolCard
