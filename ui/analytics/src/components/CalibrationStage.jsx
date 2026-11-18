import { Badge, EvidenceText, Metric, Panel, PagedItems } from '../common/Primitives.jsx'
import { number, shortId, signed } from '../common/format.js'
import { TokenizerDetails } from './TokenizerDetails.jsx'

export const CalibrationStage = ({ replay, onSelect }) => {
  const samples = replay.calibration.flatMap(group => group.samples)
  return <div className="column">
    <Panel title="Calibrate original source history" description="Before joining sessions, the service tokenizes each original request history and compares it with reconciled response usage for that session, model, and context region.">
      <div className="summary-grid"><Metric label="Source regions" value={number(replay.calibration.length)} /><Metric label="Eligible samples" value={number(samples.filter(sample => sample.eligible).length)} detail={`${number(samples.length)} captured samples`} /><Metric label="Reliable samples" value={number(samples.filter(sample => sample.reliableRegion).length)} detail="Used for each region’s residual envelope" /></div>
      <p className="muted">Input residual = measured input − reconstructed input. The envelope is the largest absolute residual among reliable samples in that region. Resets, model or thread changes, and incomplete context can make regions uncertain.</p>
      <p className="alert alert--warning">Residuals are diagnostic only. They do not change replay token counts, become new context, or count as removable overhead.</p>
    </Panel>
    <Panel title="Tokenizer and serialization" description="The service uses js-tiktoken on captured visible content. Unsupported model mappings use a proxy encoding and remain approximate.">
      <PagedItems items={replay.tokenizer.identities} size={4} empty="No tokenizer identities were recorded.">{identity => <TokenizerDetails key={identity.model} identity={identity} />}</PagedItems>
      <p className="muted">Input serializes visible messages with role, type, optional tool name and call ID, and content. Output counts retained generated text and serialized tool calls using visible-generated-text-v2. Thinking, provider-dependent blocks, and context boundaries are excluded from visible tokenization.</p>
      <p className="muted">Even mapped encodings use approximate provider framing. Missing prefixes, tool schemas, hidden reasoning, and context prevent a known upper bound.</p>
      <div className="row"><Badge>{number(replay.tokenizer.cachedRequestsAndOutputs)} cached tokenizations across the replay</Badge></div><p className="muted">Cache key: {replay.tokenizer.cacheKey}</p>
    </Panel>
    <Panel title="Calibration evidence" description="Only reconciled input at measured request boundaries is eligible. Only eligible samples in reliable regions contribute to the envelope.">
      <PagedItems items={replay.calibration} size={4} empty="No source calibration samples were available.">{group => <div className="detail" key={`${group.sessionId}:${group.model}:${group.region}`}><h4>{group.model || 'Unknown model'} · region {group.region}</h4><p className="monospace">{group.sessionId}</p><p>Residual envelope: {number(group.residualEnvelope)} tokens</p><p className="muted">{group.interpretation}</p><PagedItems items={group.samples} size={4}>{sample => <div className="detail" key={sample.turnId}><div className="row"><button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: sample.turnId })}>Inspect {shortId(sample.turnId)}</button><Badge tone={sample.eligible ? 'neutral' : 'warning'}>{sample.eligible ? 'Eligible sample' : 'Excluded sample'}</Badge><Badge tone={sample.reliableRegion ? 'retain' : 'warning'}>{sample.reliableRegion ? 'Reliable region' : 'Uncertain region'}</Badge></div><div className="table-scroll"><table className="data-table"><caption>Original request calibration, in tokens</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Measured</th><th scope="col">Tokenized</th><th scope="col">Residual</th></tr></thead><tbody><tr><th scope="row">Input</th><td>{number(sample.measuredInput)}</td><td>{number(sample.reconstructedInput)}</td><td>{signed(sample.residual)}</td></tr><tr><th scope="row">Output</th><td>{number(sample.measuredOutput)}</td><td>{number(sample.generatedOutput)}</td><td>{signed(sample.outputResidual)}</td></tr></tbody></table></div><p className="muted">{sample.reason}</p><EvidenceText value={sample} label="Calibration source references and fingerprint" /></div>}</PagedItems></div>}</PagedItems>
    </Panel>
  </div>
}
