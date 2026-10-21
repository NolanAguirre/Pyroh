import { useState } from 'react'
import { Badge, Button, DevScope, ScrollingText } from 'component-library'

const STATUS_VARIANT = {
  idle: 'neutral',
  running: 'info',
  awaiting_input: 'warning',
  paused: 'warning',
  disconnected: 'danger',
  stopped: 'neutral',
  finished: 'success',
  error: 'danger',
}

const JobRow = ({ job, workspaceName, active, onSelect }) => {
  const isRunning = job.status === 'running' || job.status === 'awaiting_input'
  const label = job.name || (job.model ? `${job.provider} · ${job.model}` : job.provider)
  return (
    <DevScope id="hr6w1n4" state={{ session: job.id, active }}>
      <button
        type="button"
        className={`session-row session-row--job${active ? ' session-row--active' : ''}`}
        onClick={() => onSelect(job)}
      >
        <div className="session-row__top">
          <div className="session-row__job-info">
            <ScrollingText className="session-row__provider" title={label}>
              {label}
            </ScrollingText>
            {workspaceName && (
              <span className="session-row__ws-tag">{workspaceName}</span>
            )}
          </div>
          <Badge
            size="small"
            variant={STATUS_VARIANT[job.status] || 'neutral'}
            dot
            addClassName={`session-row__status-dot${isRunning ? ' session-row__status-dot--live' : ''}`}
            title={job.status}
            aria-label={job.status}
          />
        </div>
      </button>
    </DevScope>
  )
}

const RunningJobsNav = ({
  devId,
  jobs = [],
  workspaces = [],
  activeId,
  onSelect,
  collapsed: collapsedProp,
  onCollapsedChange,
}) => {
  const [collapsedState, setCollapsedState] = useState(false)
  const collapsed = collapsedProp ?? collapsedState
  const setCollapsed = (value) => {
    if (collapsedProp == null) setCollapsedState(value)
    if (onCollapsedChange) onCollapsedChange(value)
  }
  const [filterActiveOnly, setFilterActiveOnly] = useState(false)
  const nameById = Object.fromEntries(workspaces.map((item) => [item.id, item.name]))

  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'awaiting_input')
  const displayedJobs = filterActiveOnly ? activeJobs : jobs

  if (collapsed) {
    return (
      <DevScope id={devId} state={{ count: jobs.length, collapsed: true }}>
        <aside className="jobs-nav jobs-nav--collapsed">
          <button
            type="button"
            className="jobs-nav__collapsed-btn"
            onClick={() => setCollapsed(false)}
            title="Expand Jobs panel"
          >
            <span className="jobs-nav__collapsed-text">Jobs</span>
            <Badge size="small" variant={activeJobs.length > 0 ? 'info' : 'neutral'} count={activeJobs.length || jobs.length} showZero />
          </button>
        </aside>
      </DevScope>
    )
  }

  return (
    <DevScope id={devId} state={{ count: jobs.length, session: activeId, collapsed: false }}>
      <aside className="jobs-nav">
        <div className="jobs-nav__header">
          <div className="jobs-nav__title-row">
            <h2>Jobs</h2>
            <Badge
              size="small"
              variant={activeJobs.length > 0 ? 'info' : 'neutral'}
              count={activeJobs.length}
              showZero={false}
            />
          </div>
          <div className="jobs-nav__header-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(true)}
              devId="b1f6n8q"
              title="Collapse panel"
            >
              →
            </Button>
          </div>
        </div>

        <div className="jobs-nav__filter-bar">
          <button
            type="button"
            className={`jobs-nav__tab${!filterActiveOnly ? ' jobs-nav__tab--active' : ''}`}
            onClick={() => setFilterActiveOnly(false)}
          >
            All ({jobs.length})
          </button>
          <button
            type="button"
            className={`jobs-nav__tab${filterActiveOnly ? ' jobs-nav__tab--active' : ''}`}
            onClick={() => setFilterActiveOnly(true)}
          >
            Active ({activeJobs.length})
          </button>
        </div>

        <div className="jobs-nav__list">
          {displayedJobs.length === 0 && (
            <DevScope id="hr9q4t0">
              <div className="jobs-nav__empty">
                <p className="hint">{filterActiveOnly ? 'No active background jobs.' : 'No recent jobs.'}</p>
              </div>
            </DevScope>
          )}
          {displayedJobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              workspaceName={nameById[job.workspaceId] || job.cwd}
              active={job.id === activeId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </aside>
    </DevScope>
  )
}

export default RunningJobsNav
