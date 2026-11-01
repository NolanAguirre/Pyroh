export const ICONS = {
  stage: 'M8 3.5v9M3.5 8h9',
  unstage: 'M3.5 8h9',
  discard: 'M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6M3 6.5 5.5 4M3 6.5 5.5 9',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3',
  open: 'M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9.5 1.5zM9.5 1.5V5H13',
}

const Icon = ({ d }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

export default Icon
