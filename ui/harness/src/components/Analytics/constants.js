export const ALL = 'all'
export const NONE = 'none'
export const OTHER = '__other'
export const CUSTOM = 'custom'

export const RANGE_OPTIONS = [
  { value: '24h', displayValue: 'Last 24 hours' },
  { value: '7d', displayValue: 'Last 7 days' },
  { value: '30d', displayValue: 'Last 30 days' },
  { value: '12w', displayValue: 'Last 12 weeks' },
  { value: ALL, displayValue: 'All time' },
  { value: CUSTOM, displayValue: 'Custom range…' },
]

export const BUCKET_OPTIONS = ['hour', 'day', 'week'].map((value) => ({ value, displayValue: `Per ${value}` }))

export const GROUP_OPTIONS = [
  { value: NONE, displayValue: 'No breakdown' },
  ...['workspace', 'provider', 'model', 'session'].map((value) => ({ value, displayValue: `By ${value}` })),
]
