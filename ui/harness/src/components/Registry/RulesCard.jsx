import {
  Badge,
  Card,
  CardHeader,
  CardSection,
  Matrix,
} from 'component-library'
import { FilePath, Scope } from './shared'

const whereText = (where) => {
  const entries = Object.entries(where || {})
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(', ') : 'everywhere'
}

const whatText = (what) => Object.entries(what || {}).map(([kind, id]) => `${kind} ${id}`).join(', ')

const RulesCard = ({ ruleSets, policies }) => (
  <Card>
    <CardHeader>Rules &amp; policies</CardHeader>
    {ruleSets.map((set) => (
      <CardSection key={set.scope}>
        <div className="registry__rules-head">
          <Scope scope={set.scope} />
          <FilePath file={set.file} />
          {set.error && <span className="registry__error" title={set.error}>{set.error}</span>}
        </div>
        {set.rules.length ? (
          <Matrix
            devId="r4u9t3w"
            rowDevId="r8v2m5e"
            className="registry__table"
            label={`${set.scope} rules`}
            rowLabel="Rule"
            rows={set.rules}
            columns={[
              { id: 'what', title: 'What' },
              { id: 'where', title: 'Where' },
              { id: 'effect', title: 'Effect' },
              { id: 'note', title: 'Note' },
            ]}
            renderRowHeader={(row) => row.id}
            renderCell={(row, column) => {
              if (column.id === 'what') return whatText(row.what)
              if (column.id === 'where') return whereText(row.where)
              if (column.id === 'effect') return <Badge size="small" variant={row.effect === 'allow' ? 'success' : 'danger'}>{row.effect}</Badge>
              return row.note || <span className="hint">—</span>
            }}
          />
        ) : (
          <p className="hint">No rules.</p>
        )}
      </CardSection>
    ))}
    <CardSection>
      <div className="registry__rules-head"><strong>Policies</strong></div>
      {policies.length ? (
        <ul className="registry__list">
          {policies.map((policy) => (
            <li key={`${policy.scope}:${policy.name}`}>
              <Scope scope={policy.scope} /> {policy.name} <FilePath file={policy.file} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No plugin policies.</p>
      )}
    </CardSection>
  </Card>
)

export default RulesCard
