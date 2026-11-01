export const ICONS = {
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  resume: 'M5 3.5v9l7-4.5z',
  stop: 'M4.5 4.5h7v7h-7z',
  panel: 'M2.5 3h11v10h-11zM9.5 3v10',
  mic: 'M6 2.5h4v6.5h-4zM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2M5.5 14h5',
}

export const Icon = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
