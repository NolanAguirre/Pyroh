const fs = require('fs')
const path = require('path')
const { readRecordPrompt } = require('../source/recordPrompt')
const { fingerprint, freeze } = require('./replayTokenizer')

const known = value => Number.isSafeInteger(value) && value >= 0
const text = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
const contentText = value => typeof value === 'string' ? value : text(value)
const total = values => values.every(known) ? values.reduce((sum, value) => sum + value, 0) : null
const median = values => {
  const sorted = values.filter(value => value > 0).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
}

const readTranscript = (dir, cutoff, warnings) => {
  if (!dir) return []
  let phases = []
  try { phases = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^phase-/.test(entry.name)).map(entry => entry.name).sort() }
  catch (error) { warnings.add(`Cannot discover phase transcripts in ${dir}: ${error.message}`) }
  const events = []
  const copies = new Map()
  for (const file of [path.join(dir, 'events.jsonl'), ...phases.map(phase => path.join(dir, phase, 'events.jsonl'))]) {
    let lines
    try { lines = fs.readFileSync(file, 'utf8').split('\n') }
    catch (error) {
      if (error.code !== 'ENOENT' || file === path.join(dir, 'events.jsonl')) warnings.add(`Transcript unavailable: ${file} (${error.code || error.message})`)
      continue
    }
    lines.forEach((line, index) => {
      if (!line.trim()) return
      let event
      try { event = JSON.parse(line) }
      catch {
        warnings.add(`Unreadable transcript record: ${file}:${index + 1}`)
        return
      }
      if (!known(event.ts)) {
        warnings.add(`Transcript timestamp missing: ${file}:${index + 1}`)
        return
      }
      if (event.ts > cutoff) return
      const hash = fingerprint(event)
      const source = { file, line: index + 1, link: `${file}:${index + 1}` }
      const copy = copies.get(hash)
      if (copy && copy.source.file !== file) {
        copy.sources.push(source)
        return
      }
      const entry = { event, source, sources: [source], fingerprint: hash }
      copies.set(hash, entry)
      events.push(entry)
    })
  }
  events.sort((a, b) => a.event.ts - b.event.ts || a.source.file.localeCompare(b.source.file) || a.source.line - b.source.line)
  return events.map((entry, order) => freeze({ ...entry, order }))
}

const responseKey = (event, row) => event.requestKey || JSON.stringify([row.provider,
  row.provider === 'claude' ? 'message' : event.evidenceScopeId || event.providerRunId || event.runId || event.segmentId || row.id,
  event.requestId])
const responseRecords = (row, events) => {
  const records = new Map()
  const accept = (record, source, order) => {
    if (!record.requestId || record.parentToolUseId || record.nested) return
    const key = responseKey(record, row)
    const previous = records.get(key)
    const sources = [...(previous?.sources || []), source].filter(Boolean)
    const orders = [...(previous?.orders || []), ...(known(order) ? [order] : [])]
    const keepFinal = previous?.record.status === 'completed' && record.status !== 'completed'
    records.set(key, { key, record: keepFinal ? previous.record : { ...previous?.record, ...record }, sources, orders,
      starts: [...(previous?.starts || []), ...(record.status === 'streaming' && known(order) ? [order] : [])],
      ends: [...(previous?.ends || []), ...(record.status === 'completed' && known(order) ? [order] : [])] })
  }
  for (const segment of row.requestEvidence?.segments || []) {
    for (const record of segment.requestRecords || []) accept(record, { file: row.file, field: `modelRequests.segments.${segment.segmentId}.${record.requestId}` })
  }
  for (const entry of events) if (entry.event.type === 'model_request') accept(entry.event, entry.source, entry.order)
  return [...records.values()].sort((a, b) => (a.orders[0] ?? Infinity) - (b.orders[0] ?? Infinity)
    || (a.record.firstObservedAt ?? a.record.observedAt ?? 0) - (b.record.firstObservedAt ?? b.record.observedAt ?? 0)
    || a.key.localeCompare(b.key))
}

const createTranscriptEvidence = (agents) => {
  const blocks = []
  const turns = []
  const gaps = []
  const runAccounting = []
  const history = agents.flatMap(agent => agent.rows).filter(row => row.requests > 0 && known(row.input))
  const addGap = (row, reason, sources = []) => gaps.push({ sessionId: row.sessionId, runId: row.id, reason, sources })
  for (const agent of agents) {
    for (const row of agent.rows) {
      const entries = (agent.events || []).filter(entry => entry.event.runId === row.id)
      const drafts = new Map()
      const runBlocks = []
      const add = (key, values, entry) => {
        let block = drafts.get(key)
        if (!block) {
          block = { id: `${row.sessionId}:${row.id}:${key}`, sessionId: row.sessionId, runId: row.id,
            order: entry.order, lastOrder: entry.order, ts: entry.event.ts, sources: [],
            role: 'assistant', generated: false, dependencies: [], ...values }
          drafts.set(key, block)
          runBlocks.push(block)
        }
        block.sources.push(...entry.sources)
        block.lastOrder = entry.order
        return block
      }
      let previousThread = null
      let previousModel = row.model
      for (const entry of entries) {
        const event = entry.event
        const id = event.itemId || event.toolUseId || `anonymous-${entry.order}`
        if (event.type === 'provider_prompt') {
          const sections = Array.isArray(event.sections) && event.sections.map(part => part.text).join('') === event.text
            ? event.sections : [{ kind: 'context', label: 'Unclassified prompt', text: event.text || '' }]
          sections.forEach((section, index) => add(`prompt:${event.captureId || entry.order}:${index}`, {
            kind: 'prompt', role: section.kind === 'system' ? 'system' : 'user', content: section.text,
            sectionKind: section.kind, label: section.label, captureId: event.captureId,
            visibility: 'request', lifetime: 'session', images: event.images || [],
          }, entry))
          if (event.images?.length) addGap(row, 'Image payload tokenization is unsupported.', entry.sources)
        } else if (['text', 'thinking'].includes(event.type)) {
          const block = add(`${event.type}:${id}`, { kind: event.type, itemId: id, content: '', generated: true,
            visibility: event.type === 'thinking' ? 'provider-dependent' : 'conversation', lifetime: 'session' }, entry)
          block.content = event.delta && !event.replace ? block.content + (event.text || '') : event.text || ''
        } else if (event.type === 'tool_call') {
          const call = add(`call:${id}`, { kind: 'tool_call', toolId: id, name: event.name || '', content: '',
            visibility: 'conversation', lifetime: 'session', generated: true }, entry)
          if (event.name) call.name = event.name
          if (event.status !== undefined) call.status = event.status
          if (event.input !== undefined) call.content = event.input
          else if (event.inputDelta !== undefined) call.content = text(call.content) + text(event.inputDelta)
          if (event.output !== undefined || event.outputDelta !== undefined) {
            const result = add(`result:${id}`, { kind: 'tool_result', toolId: id, name: call.name, role: 'tool', content: '',
              visibility: 'conversation', lifetime: 'session', dependencies: [call.id] }, entry)
            result.content = event.output !== undefined ? event.output : text(result.content) + text(event.outputDelta)
            result.error = event.error || (event.status === 'error' ? 'Tool error' : null)
            result.exitCode = event.exitCode ?? result.exitCode
            call.resultId = result.id
          }
        }
        const thread = event.providerAgentId || event.context?.providerAgentId
        const model = event.settings?.model || (event.type === 'model_request' ? event.model : null)
        const compacted = ['compacting', 'awaiting_update'].includes(event.context?.status)
          || /^(?:Context compacted|Compacting context)/i.test(event.status || '')
        const reset = previousThread && thread && previousThread !== thread
        const changed = model && previousModel && model !== previousModel
        if (compacted || reset || changed || /Model changed:/.test(event.status || '')) {
          add(`boundary:${entry.order}`, { kind: 'boundary', role: 'system', content: '',
            visibility: 'metadata', lifetime: 'boundary', boundary: compacted ? 'compaction' : reset ? 'reset' : 'model-change',
            model: model || null }, entry)
          addGap(row, compacted ? 'Compaction summary and retained provider context are unavailable.'
            : reset ? 'Provider context reset has no complete replacement history.' : 'Model transition needs a new calibration region.', entry.sources)
        }
        if (thread) previousThread = thread
        if (model) previousModel = model
      }
      if (!runBlocks.some(block => block.kind === 'prompt')) {
        let prompt = null
        try { prompt = readRecordPrompt(row.record, row.file) }
        catch (error) { addGap(row, `Run prompt unavailable: ${error.message}`) }
        if (prompt != null) {
          const source = { file: row.file, field: row.record?.promptFile ? 'promptFile' : 'prompt' }
          add('fallback-prompt', { kind: 'prompt', role: 'user', content: prompt, sectionKind: 'context', label: 'Uncaptured run prompt',
            visibility: 'request', lifetime: 'session', fallback: true }, { order: (entries[0]?.order ?? 0) - 0.5,
            event: { ts: row.startedAt }, sources: [source] })
        }
        addGap(row, 'Provider prompt capture missing: instructions and tool schemas may be absent.')
      }
      const finalText = text(row.record?.result)
      const capturedText = runBlocks.filter(block => block.kind === 'text').map(block => contentText(block.content)).join('')
      if (finalText && !capturedText.includes(finalText)) {
        add('final-result', { kind: 'text', role: 'assistant', content: text(row.record.result), generated: true,
          visibility: 'conversation', lifetime: 'session', fallback: true }, {
          order: (entries.at(-1)?.order ?? 0) + 0.5, event: { ts: row.endedAt }, sources: [{ file: row.file, field: 'result' }],
        })
        addGap(row, 'Final run text was recovered outside streamed response blocks, its boundary is inferred.')
      }
      runBlocks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      for (const block of runBlocks) {
        if (block.kind !== 'tool_call' || block.resultId) continue
        const capturedFileChange = block.name === 'fileChange' && block.status === 'completed'
          && Array.isArray(block.content) && block.content.length > 0
          && block.content.every(change => typeof change?.path === 'string' && typeof change?.diff === 'string')
        // Completed file changes carry their patches in input, with no separate output payload.
        if (capturedFileChange) block.resultRepresentation = 'input-diff'
        else addGap(row, 'Tool-result content is missing or unavailable.', block.sources)
      }
      const responses = responseRecords(row, entries)
      const runTurns = responses.map((response, index) => {
        const start = response.starts.length ? Math.min(...response.starts) : null
        const completedAt = response.record.lastObservedAt ?? response.record.observedAt
        const completionEntry = known(completedAt) && response.record.status === 'completed'
          ? entries.filter(entry => entry.event.ts <= completedAt).at(-1) : null
        const end = response.ends.length ? Math.max(...response.ends) : completionEntry?.order ?? null
        return { id: `${row.sessionId}:${row.id}:response:${index}`, sessionId: row.sessionId, runId: row.id,
          responseKey: response.key, responseId: response.record.requestId,
          model: response.record.model || row.model, provider: row.provider, sources: response.sources,
          confidence: row.requestEvidence?.coverage === 'complete' && response.starts.length > 0 && response.ends.length > 0 ? 'measured' : 'inferred',
          reason: start !== null ? 'Recorded response start and transcript order.' : 'Response identity with inferred content boundary.',
          start, end, order: start ?? end, blocks: [], measuredUsage: response.record.usage || null,
          usageReconciled: row.requestEvidence?.coverage === 'complete' }
      })
      let inferred = null
      let afterResult = false
      for (const block of runBlocks) {
        let turn = null
        if (block.itemId) turn = runTurns.find(item => block.itemId === item.responseId || block.itemId.startsWith(`${item.responseId}:`))
        if (!turn && block.generated) {
          turn = runTurns.find(item => item.start !== null && item.start <= block.order && (item.end === null || item.end >= block.order))
          if (!turn) turn = runTurns.find(item => item.start === null && item.end !== null && item.end >= block.order)
          // Tool snapshots can arrive just after message_stop, before a new request starts.
          if (!turn && block.kind === 'tool_call') turn = [...runTurns].reverse().find(item => item.end !== null && item.end <= block.order)
        }
        if (!turn && block.generated) {
          if (!inferred || afterResult) {
            const unassigned = runTurns.find(item => item.responseId && item.start === null && item.end === null && !item.blocks.length)
            if (unassigned) inferred = unassigned
            else {
            inferred = { id: `${row.sessionId}:${row.id}:inferred:${runTurns.length}`, sessionId: row.sessionId, runId: row.id,
              model: row.model, provider: row.provider, confidence: 'inferred',
              reason: 'Generated content after a prompt/tool-result boundary, without a matched response ID.',
              order: block.order - 0.01, start: null, end: null, blocks: [], sources: block.sources,
              measuredUsage: null, usageReconciled: false }
            runTurns.push(inferred)
            }
          }
          turn = inferred
        }
        if (turn) {
          block.turnId = turn.id
          turn.blocks.push(block.id)
          afterResult = false
        }
        if (['tool_result', 'prompt', 'boundary'].includes(block.kind)) afterResult = true
      }
      const peers = history.filter(item => item.provider === row.provider && item.model === row.model)
      const inputPerTurn = median(peers.map(item => item.input / item.requests)) || 8000
      const segments = row.requestEvidence?.segments || []
      const reported = segments.length && segments.every(segment => known(segment.reportedModelRequests))
        ? total(segments.map(segment => segment.reportedModelRequests)) : null
      const target = Math.max(runTurns.length, row.requestEvidence?.observed || 0, row.requests ?? reported
        ?? (known(row.input) ? Math.max(row.input > 0 ? 1 : 0, Math.round(row.input / inputPerTurn)) : 3))
      while (runTurns.length < target) {
        const index = runTurns.length
        runTurns.push({ id: `${row.sessionId}:${row.id}:allocated:${index}`, sessionId: row.sessionId, runId: row.id,
          model: row.model, provider: row.provider, confidence: 'allocated',
          reason: row.requests !== null ? 'Reconciled count lacks a recoverable transcript boundary.'
            : reported !== null ? 'Provider-reported count lacks a recoverable transcript boundary.'
              : `Run input allocation using ${inputPerTurn} input tokens/turn (${peers.length ? 'same-model measured history' : 'fallback assumption'}).`,
          order: (runBlocks.at(-1)?.lastOrder ?? entries.at(-1)?.order ?? 0) + 1 + index / (target + 1),
          start: null, end: null, blocks: [], sources: [{ file: row.file }], measuredUsage: null, usageReconciled: false })
      }
      for (const turn of runTurns) {
        const generated = runBlocks.filter(block => block.turnId === turn.id)
        // The request must precede the earliest generated block, even for completion-only evidence.
        turn.order = generated.length ? Math.min(turn.order ?? Infinity, generated[0].order - 0.01)
          : turn.order ?? (runBlocks.at(-1)?.order ?? 0) + 0.9
        turn.contextLimit = entries.filter(entry => entry.event.context?.maxTokens > 0)
          .find(entry => entry.order >= turn.order)?.event.context.maxTokens
          ?? entries.filter(entry => entry.event.context?.maxTokens > 0).at(-1)?.event.context.maxTokens ?? null
      }
      runTurns.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      if (runTurns.some(turn => turn.confidence !== 'measured')) addGap(row, 'Some response boundaries are inferred or allocated, so replay timing is a scenario.')
      if (!row.endedAt || row.record?.transcriptStatus === 'incomplete') addGap(row, 'Run or transcript is incomplete at cutoff.')
      if (agent.session.fork) addGap(row, 'Inherited provider history is not fully represented in this session.')
      // Attribution conserves authoritative run totals without changing observed response usage.
      const accounting = { sessionId: row.sessionId, runId: row.id, measured: { input: row.input, output: row.output }, residual: {} }
      for (const field of ['input', 'output']) {
        const key = `${field}Tokens`
        const observed = runTurns.map(turn => known(turn.measuredUsage?.[key]) ? turn.measuredUsage[key] : null)
        const subtotal = observed.reduce((sum, value) => sum + (value ?? 0), 0)
        const missing = observed.filter(value => value === null).length
        const budget = row[field]
        const preserve = known(budget) && subtotal <= budget && (missing > 0 || subtotal === budget)
        let remainder = known(budget) ? budget - (preserve ? subtotal : 0) : null
        const recipients = preserve ? missing : runTurns.length
        runTurns.forEach((turn, index) => {
          turn.attributedUsage = turn.attributedUsage || {}
          const share = known(budget) && (!preserve || observed[index] === null)
            ? Math.floor((budget - (preserve ? subtotal : 0)) / Math.max(1, recipients)) : null
          const value = known(budget) ? preserve && observed[index] !== null ? observed[index] : share : null
          turn.attributedUsage[field] = value
          if (share !== null) remainder -= share
          turn.attribution = preserve ? 'Observed usage retained, missing usage allocated from run remainder.'
            : 'Run total allocated equally, conflicting or incomplete response usage remains separate evidence.'
        })
        const recipient = [...runTurns].reverse().find((turn, reverseIndex) => !preserve || observed[runTurns.length - reverseIndex - 1] === null)
        if (recipient && remainder > 0) {
          recipient.attributedUsage[field] += remainder
          remainder = 0
        }
        accounting.residual[field] = known(budget) ? remainder : null
      }
      runAccounting.push(accounting)
      turns.push(...runTurns.map(turn => freeze(turn)))
      blocks.push(...runBlocks.map(block => freeze({ ...block, fingerprint: fingerprint({ kind: block.kind, content: block.content, name: block.name }),
        dependencies: block.dependencies || [], sources: block.sources })))
    }
  }
  return freeze({ blocks, turns, gaps, runAccounting })
}

module.exports = { readTranscript, createTranscriptEvidence }
