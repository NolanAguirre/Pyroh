import { useState } from 'react'
import { asText, number } from './format.js'

export const Badge = ({ children, tone = 'neutral' }) => {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export const Metric = ({ label, value, detail }) => {
  return <div className="metric"><span className="metric__label">{label}</span><strong className="metric__value">{value}</strong>{detail && <span className="metric__detail">{detail}</span>}</div>
}

export const EmptyState = ({ title, children }) => {
  return <div className="empty-state"><h3>{title}</h3>{children && <p>{children}</p>}</div>
}

export const Panel = ({ title, description, children, aside }) => {
  return <section className="card-section"><div className="card-section__header"><div><h3>{title}</h3>{description && <p className="card-section__description">{description}</p>}</div>{aside}</div>{children}</section>
}

export const Pager = ({ page, count, size, onChange }) => {
  const pages = Math.max(1, Math.ceil(count / size))
  return <nav className="pagination" aria-label="Result pages"><span className="muted">{count ? `${number(page * size + 1)}–${number(Math.min((page + 1) * size, count))} of ${number(count)}` : '0 items'}</span><div className="row"><button className="button button--quiet" disabled={page === 0} onClick={() => onChange(page - 1)}>Earlier</button><span>{page + 1} / {number(pages)}</span><button className="button button--quiet" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Later</button></div></nav>
}

export const EvidenceText = ({ value, label = 'Captured content' }) => {
  const [expanded, setExpanded] = useState(false)
  const text = asText(value)
  const limit = 12000
  return <details className="disclosure"><summary>{label} <span className="muted">({number(text.length)} characters)</span></summary><pre className="code-block">{expanded ? text : text.slice(0, limit)}</pre>{text.length > limit && <button className="button button--quiet" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show excerpt' : 'Show full selected content'}</button>}</details>
}

export const PagedItems = ({ items, children, size = 12, empty = 'No entries in this view.' }) => {
  const [requestedPage, setPage] = useState(0)
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(items.length / size) - 1))
  return <><div className="column">{items.length ? items.slice(page * size, (page + 1) * size).map(children) : <p className="muted">{empty}</p>}</div>{items.length > size && <Pager page={page} count={items.length} size={size} onChange={setPage} />}</>
}
