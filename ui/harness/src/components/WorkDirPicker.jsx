import { useEffect, useState } from 'react'
import { Button, DevScope, FolderIcon } from 'component-library'
import api from '../api'

const WorkDirPicker = ({ devId, machine = null, onChange }) => {
  const [listing, setListing] = useState(null)
  const [error, setError] = useState(null)

  const load = (path) => {
    api
      .listWorkDir(path, machine)
      .then((data) => {
        setError(null)
        setListing(data)
        if (onChange) onChange(data.path)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    setListing(null)
    load()
  }, [machine])

  const atBase = !listing || listing.parent === null
  const segments = listing?.path ? listing.path.split('/').filter(Boolean) : []

  return (
    <DevScope id={devId} state={{ path: listing?.path, error: Boolean(error) }}>
      <div className="workdir">
        <div className="workdir__bar">
          <div className="workdir__breadcrumbs" title={listing?.path || ''}>
            <button
              type="button"
              className="workdir__crumb"
              onClick={() => load('/')}
            >
              /
            </button>
            {segments.map((seg, i) => {
              const segPath = '/' + segments.slice(0, i + 1).join('/')
              const isCurrent = i === segments.length - 1
              return (
                <span key={segPath} className="workdir__crumb-item">
                  <span className="workdir__crumb-sep">/</span>
                  <button
                    type="button"
                    className={`workdir__crumb${isCurrent ? ' workdir__crumb--current' : ''}`}
                    onClick={() => load(segPath)}
                  >
                    {seg}
                  </button>
                </span>
              )
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={atBase}
            onClick={() => load(listing?.parent)}
            devId="hr3y9k2"
            title="Navigate up"
          >
            ↑ Up
          </Button>
        </div>

        <div className="workdir__list">
          {listing && listing.entries.length === 0 && (
            <p className="hint">No subdirectories in this path.</p>
          )}
          {listing &&
            listing.entries.map((entry) => (
              <DevScope key={entry.path} id="hr6t1v5" state={{ path: entry.path }}>
                <button
                  type="button"
                  className="workdir__item"
                  onClick={() => load(entry.path)}
                >
                  <FolderIcon size={14} className="workdir__icon" />
                  <span className="workdir__item-name">{entry.name}</span>
                </button>
              </DevScope>
            ))}
        </div>
        {error && <p className="hint hint--error">{error}</p>}
      </div>
    </DevScope>
  )
}

export default WorkDirPicker
