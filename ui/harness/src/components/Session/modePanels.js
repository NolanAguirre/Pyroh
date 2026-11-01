import DecomposePanel from './DecomposePanel'

// Per-mode panels rendered above the transcript; props: { session, runs, events, filter, setFilter }.
const MODE_PANELS = {
  decompose: DecomposePanel,
}

export default MODE_PANELS
