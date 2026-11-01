export const ICONS = {
  editor: 'M4 5.5 1.5 8 4 10.5M12 5.5 14.5 8 12 10.5M9.2 3.5 6.8 12.5',
  settings: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.6v1.5M8 12.9v1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M1.6 8h1.5M12.9 8h1.5M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1',
  terminal: 'M2.5 4.5 6 8l-3.5 3.5M8 12h5.5',
  git: 'M5 5v6M11 6c0 2.5-6 1.5-6 4.5M6.5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6.5 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM12.5 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  codeStats: 'M2 3.5h12M2 6.5h8M2 9.5h10M2 12.5h5',
  analytics: 'M2 13.5V9M6 13.5V5M10 13.5V7.5M14 13.5V3M1.5 13.5h13',
  registry: 'M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z',
  memory: 'M4 1.5h6l2.5 2.5v10.5h-8.5zM10 1.5V4h2.5M6 7h4.5M6 9.5h4.5M6 12h3',
  workspace: 'M1.5 3.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1zM8 6.5v5M5.5 9h5',
  session: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v6M5 8h6',
  archive: 'M1.5 2.5h13v2.5h-13zM2.5 5v8.5h11V5M6 8.5h4',
}

export const Icon = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

export const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
)

export const RestoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
)

export const PinIcon = ({ filled }) => (
  <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
)

export const PencilIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)
