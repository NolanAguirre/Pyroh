import { Badge, EvidenceText, Metric, Panel, PagedItems } from '../common/Primitives.jsx'
import { number, shortId, signed } from '../common/format.js'
import { TokenizerDetails } from './TokenizerDetails.jsx'

const CalibrationSample = ({ sample, fitted, onSelect }) => {
  const outputResidual = sample.outputResidual ?? (Number.isFinite(sample.measuredOutput) && Number.isFinite(sample.generatedOutput) ? sample.measuredOutput - sample.generatedOutput : null)
  return <div className="detail">
    <div className="row"><button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: sample.turnId })}>Inspect {shortId(sample.turnId)}</button><Badge tone={sample.eligible ? 'neutral' : 'warning'}>{sample.eligible ? 'Eligible sample' : 'Excluded sample'}</Badge><Badge tone={sample.reliableRegion ? 'retain' : 'warning'}>{sample.reliableRegion ? 'Reliable region' : 'Uncertain region'}</Badge>{sample.confidence != null && <Badge>Confidence: {sample.confidence}</Badge>}</div>
    <div className="table-scroll"><table className="data-table"><caption>Original request input, in tokens</caption><thead><tr><th scope="col">Measured</th><th scope="col">Visible tokenized</th><th scope="col">{fitted ? 'Fitted' : 'Reconstructed'}</th><th scope="col">Residual</th></tr></thead><tbody><tr><td>{number(sample.measuredInput)}</td><td>{number(sample.visibleInput)}</td><td>{number(sample.reconstructedInput)}</td><td>{signed(sample.residual)}</td></tr></tbody></table></div>
    <div className="table-scroll"><table className="data-table"><caption>Original response output, in tokens</caption><thead><tr><th scope="col">Measured</th><th scope="col">Generated</th><th scope="col">Residual</th></tr></thead><tbody><tr><td>{number(sample.measuredOutput)}</td><td>{number(sample.generatedOutput)}</td><td>{signed(outputResidual)}</td></tr></tbody></table></div>
    <p className="muted">{sample.reason}</p>
    {!!sample.candidateTurnIds?.length && <div className="row"><strong>Grouped candidate boundaries</strong>{sample.candidateTurnIds.map(id => <span className="monospace" key={id} title={id}>{shortId(id)}</span>)}</div>}
    {sample.contextSnapshots != null && <EvidenceText value={sample.contextSnapshots} label="Context snapshots" />}
    <EvidenceText value={sample} label="Calibration source references and evidence" />
  </div>
}

const CalibrationConstraints = ({ constraints }) => {
  return <PagedItems items={constraints} size={4} empty="No fitted constraints were recorded in this result.">{(constraint, index) => <div className="detail" key={index}><h4>{constraint.kind || 'Constraint'}</h4><div className="table-scroll"><table className="data-table"><caption>Constraint target and fit</caption><thead><tr><th scope="col">Target</th><th scope="col">Fitted</th><th scope="col">Residual</th></tr></thead><tbody><tr><td>{number(constraint.target)}</td><td>{number(constraint.fitted)}</td><td>{signed(constraint.residual)}</td></tr></tbody></table></div>{typeof constraint.source === 'string' && <p className="muted">Source: {constraint.source}</p>}<EvidenceText value={constraint} label="Constraint source and evidence" /></div>}</PagedItems>
}

const FitStatus = ({ item }) => {
  return <div className="detail"><div className="row"><Badge tone={item.status === 'fitted' ? 'retain' : 'warning'}>{item.status || 'Fit status unavailable'}</Badge><span>Largest reported residual: {number(item.maxResidual)}</span></div><p className="muted">A fitted result satisfies the reported constraints within solver tolerance. Partial or unavailable results lack measurements; unresolved results have conflicting constraints. Missing content can remain even when residuals are zero.</p>{item.solver && <EvidenceText value={item.solver} label="Fit solver details" />}</div>
}

const Reconstruction = ({ items, onSelect }) => {
  return <Panel title="Original session and run reconstruction" description="Compare measured targets with fitted original input and request counts before joining sessions."><PagedItems items={items} size={4} empty="No fitted session or run reconstruction was recorded in this result.">{(item, index) => <div className="detail" key={`${item.sessionId}:${item.runId ?? index}`}><h4>{item.model || 'Original run'}</h4><FitStatus item={item} /><p className="monospace">{item.sessionId}{item.runId != null && ` / ${item.runId}`}</p><div className="table-scroll"><table className="data-table"><caption>Original reconstruction targets and residuals</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Target</th><th scope="col">Fitted</th><th scope="col">Residual</th></tr></thead><tbody><tr><th scope="row">Input tokens</th><td>{number(item.targetInput)}</td><td>{number(item.fittedInput)}</td><td>{signed(item.inputResidual)}</td></tr><tr><th scope="row">Output tokens</th><td>{number(item.targetOutput)}</td><td>{number(item.fittedOutput)}</td><td>{signed(item.outputResidual)}</td></tr><tr><th scope="row">Requests</th><td>{number(item.targetRequests)}</td><td>{number(item.fittedRequests)}</td><td>{signed(item.requestResidual)}</td></tr></tbody></table></div><p className="muted">{number(item.candidateRequests)} captured candidate boundaries before fitting. Inferred boundaries may group together; recorded request boundaries remain.</p>{item.limitations != null && <EvidenceText value={item.limitations} label="Reconstruction limitations" />}<details className="disclosure"><summary>Fitted original requests ({number(item.requests?.length)})</summary><PagedItems items={item.requests ?? []} size={8}>{request => <div className="detail" key={request.turnId}><div className="row"><button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: request.turnId })}>{shortId(request.turnId)}</button><Badge>{request.boundary}</Badge><span>Region {number(request.region)}</span></div><div className="row"><span>Input {number(request.input)}</span><span>Output {number(request.output)}</span><span>{number(request.candidateTurnIds?.length)} candidate boundaries</span></div><EvidenceText value={request} label="Original fitted request evidence" /></div>}</PagedItems></details></div>}</PagedItems></Panel>
}

export const CalibrationStage = ({ replay, onSelect }) => {
  const calibration = replay.calibration ?? []
  const reconstruction = replay.reconstruction ?? []
  const samples = calibration.flatMap(group => group.samples ?? [])
  const fitted = reconstruction.length > 0 || calibration.some(group => group.constraints != null) || samples.some(sample => sample.visibleInput != null)
  return <div className="column">
    <Panel title="Fit original source requests" description="Before joining sessions, the service fits original requests to measured usage constraints for each session, model, and context region.">
      <div className="summary-grid"><Metric label="Source regions" value={number(calibration.length)} /><Metric label="Eligible samples" value={number(samples.filter(sample => sample.eligible).length)} detail={`${number(samples.length)} captured samples`} /><Metric label="Reliable samples" value={number(samples.filter(sample => sample.reliableRegion).length)} detail="Region reliability reported by the service" /></div>
      <p className="muted">Input residual = measured input − fitted input. Visible input is the captured content token count before fitting. The residual envelope describes the remaining mismatch in a region. Resets, model or thread changes, and incomplete context can make regions uncertain.</p>
      <p className="muted">Fitted original requests are the basis for replay reconstruction. Constraints show measured targets, fitted values, and remaining residuals. A fit does not establish the contents of missing context.</p>
      {!fitted && <p className="alert alert--warning">This older result has no fitted request evidence. Its reconstructed input and residuals are shown as recorded.</p>}
    </Panel>
    <Reconstruction items={reconstruction} onSelect={onSelect} />
    <Panel title="Tokenizer and serialization" description="The service uses js-tiktoken on captured visible content. Unsupported model mappings use a proxy encoding and remain approximate.">
      <PagedItems items={replay.tokenizer.identities} size={4} empty="No tokenizer identities were recorded.">{identity => <TokenizerDetails key={identity.model} identity={identity} />}</PagedItems>
      <p className="muted">Input serializes visible messages with role, type, optional tool name and call ID, and content. Prompt sections from one captured send are joined exactly into one user message; section labels do not change its provider role. Output counts retained generated text and serialized tool calls using visible-generated-text-v2. Thinking, provider-dependent blocks, and context boundaries are excluded from visible tokenization.</p>
      <p className="muted">Even mapped encodings use approximate provider framing. Missing prefixes, tool schemas, hidden reasoning, and context prevent a known upper bound.</p>
      <div className="row"><Badge>{number(replay.tokenizer.cachedRequestsAndOutputs)} cached tokenizations across the replay</Badge></div><p className="muted">Cache key: {replay.tokenizer.cacheKey}</p>
    </Panel>
    <Panel title="Calibration evidence" description="Inspect fitted constraints, original requests, eligibility, confidence, and context evidence reported by the service.">
      <PagedItems items={calibration} size={4} empty="No source calibration samples were available.">{group => <div className="detail" key={`${group.sessionId}:${group.runId}:${group.model}:${group.region}`}><h4>{group.model || 'Unknown model'} · region {group.region}</h4><p className="monospace">{group.sessionId}</p><p>Residual envelope: {number(group.residualEnvelope)} tokens</p><p className="muted">{group.interpretation}</p><h4>Fitted constraints</h4><CalibrationConstraints constraints={group.constraints ?? []} /><h4>Original requests</h4><PagedItems items={group.samples ?? []} size={4}>{(sample, index) => <CalibrationSample key={sample.turnId ?? index} sample={sample} fitted={fitted} onSelect={onSelect} />}</PagedItems></div>}</PagedItems>
    </Panel>
  </div>
}
