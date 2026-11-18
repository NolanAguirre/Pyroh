import { SessionPicker } from '../components/SessionPicker.jsx'
import { ReplayExplorer } from '../components/ReplayExplorer.jsx'
import { useReplay } from '../components/useReplay.js'
import { EmptyState } from '../common/Primitives.jsx'

const EstimatorPage = () => {
  const { replay, loading, error, load } = useReplay()
  return <main className="app-shell"><header className="app-header"><p className="app-header__eyebrow">Analytics / replay workbench</p><h1 className="app-header__title">Follow every token.</h1><p className="app-header__description">Step through how recorded subagent work becomes one coordinator conversation—from original timelines to the final estimate.</p></header><SessionPicker onLoad={load} loading={loading} />{loading && <div className="loading" role="status" aria-live="polite"><strong>Building the recorded replay…</strong><p>Loading transcript evidence, placement decisions, and token accounting from the analytics service.</p></div>}{error && <div className="alert alert--error" role="alert"><strong>Replay could not be loaded</strong><p>{error}</p><p>Choose a session and load again to retry.</p></div>}{!loading && !error && !replay && <EmptyState title="Start with a real session">Choose a recorded session above or enter its ID. Each stage will show the actual replay and its supporting evidence.</EmptyState>}{replay && <ReplayExplorer replay={replay} />}</main>
}

export default EstimatorPage
