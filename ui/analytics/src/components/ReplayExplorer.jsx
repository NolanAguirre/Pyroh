import { useMemo, useRef, useState } from 'react'
import { Badge } from '../common/Primitives.jsx'
import { shortId } from '../common/format.js'
import { createReplayModel } from './replayModel.js'
import { ReplaySummary, Coverage, ComparisonStage } from './ReplaySummary.jsx'
import { SelectionDetails } from './SelectionDetails.jsx'
import { SourceStage, PlacementStage } from './SourceStages.jsx'
import { RemovalStage } from './RemovalStage.jsx'
import { HistoryStage } from './HistoryStage.jsx'
import { CalibrationStage } from './CalibrationStage.jsx'

const stages = [
  { title: 'Collect sources', description: 'Inspect the coordinator, linked descendants, captured messages, assistant response boundaries, and evidence gaps.' },
  { title: 'Calibrate sources', description: 'Inspect fitted original requests, measured constraints, and remaining residuals before joining sessions.' },
  { title: 'Depth-first joins', description: 'Follow child work into the coordinator timeline at its recorded spawn anchor.' },
  { title: 'Removal decisions', description: 'Compare original actions with retained work and inspect each deletion’s evidence.' },
  { title: 'History & tokens', description: 'Step through surviving model calls, their retained message context, and assistant output.' },
  { title: 'Measured vs estimate', description: 'Compare actual combined usage with the whole coordinator replay scenario.' },
]

export const ReplayExplorer = ({ replay }) => {
  const model = useMemo(() => createReplayModel(replay), [replay])
  const [stage, setStage] = useState(0)
  const [selection, setSelection] = useState(null)
  const [reset, setReset] = useState(0)
  const detailRef = useRef(null)
  const select = next => setSelection(next)
  const restart = () => {
    setStage(0)
    setSelection(null)
    setReset(value => value + 1)
  }
  const props = { replay, model, selection, onSelect: select }
  return <div className="column"><div className="row"><Badge>Replay v{replay.version}</Badge><span className="monospace" title={replay.sourceSessionId}>Source {shortId(replay.sourceSessionId)}</span><Badge tone="warning">Recorded-work scenario</Badge></div><ReplaySummary replay={replay} /><nav className="pipeline" aria-label="Estimator stages">{stages.map((item, index) => <button className={`pipeline__step${stage === index ? ' pipeline__step--active' : ''}`} key={item.title} onClick={() => setStage(index)} aria-current={stage === index ? 'step' : undefined} aria-controls="replay-stage"><span className="pipeline__number">{index + 1}</span><span className="pipeline__label">{item.title}</span></button>)}</nav><section aria-label="Step controls" className="stage-toolbar"><div><h2 id="stage-title">{stage + 1}. {stages[stage].title}</h2><p className="stage-toolbar__description">{stages[stage].description}</p></div><div className="stage-controls"><button className="button button--quiet" disabled={stage === 0} onClick={() => setStage(value => value - 1)}>Previous</button><button className="button button--primary" disabled={stage === stages.length - 1} onClick={() => setStage(value => value + 1)}>Next</button><button className="button button--quiet" onClick={restart}>Reset view</button></div></section><div className="workspace"><div className="workspace__main column"><div id="replay-stage" aria-labelledby="stage-title" key={`${stage}:${reset}`}>{stage === 0 && <SourceStage {...props} />}{stage === 1 && <CalibrationStage {...props} />}{stage === 2 && <PlacementStage {...props} />}{stage === 3 && <RemovalStage {...props} />}{stage === 4 && <HistoryStage {...props} />}{stage === 5 && <ComparisonStage {...props} />}</div>{selection && <button className="button button--quiet" onClick={() => { detailRef.current?.scrollIntoView({ block: 'start' })
    detailRef.current?.focus() }}>Go to selection details: {shortId(selection.id)}</button>}<Coverage replay={replay} onSelect={select} /></div><aside className="workspace__aside" ref={detailRef} tabIndex="-1" aria-label="Selected evidence"><SelectionDetails selection={selection} model={model} onSelect={select} /></aside></div></div>
}
