const { fingerprint } = require('./replayTokenizer')

const known = value => Number.isFinite(value) && value >= 0
const sum = values => values.reduce((total, value) => total + value, 0)
const total = values => values.every(known) ? sum(values) : null
const field = (value, names) => names.map(name => value?.[name]).find(known) ?? null
const visible = block => block.kind !== 'boundary' && block.kind !== 'thinking' && block.visibility !== 'provider-dependent'
const inputUsage = usage => field(usage, ['inputTokens', 'input_tokens', 'input'])
const outputUsage = usage => field(usage, ['outputTokens', 'output_tokens', 'output'])

// Allocate only to evidenced content, preserving complete response measurements.
const allocateOutput = (groups, target) => {
  const fixed = groups.filter(group => known(group.measuredOutput))
  const free = groups.filter(group => !known(group.measuredOutput))
  const remaining = known(target) ? Math.max(0, target - sum(fixed.map(group => group.measuredOutput))) : null
  const weight = sum(free.map(group => group.visibleOutput || 0))
  let assigned = 0
  let cumulative = 0
  for (const group of groups) {
    if (known(group.measuredOutput)) group.output = group.measuredOutput
    else if (remaining !== null && weight > 0) {
      cumulative += group.visibleOutput || 0
      const next = Math.round(remaining * cumulative / weight)
      group.output = next - assigned
      assigned = next
    } else group.output = group.visibleOutput
  }
}

// Monotone interpolation follows captured additions, never elapsed turns.
const shape = groups => {
  const regions = new Map()
  for (const group of groups) {
    group.anchor = known(group.measuredInput) ? group.measuredInput : null
    const snapshots = group.contextSnapshots.filter(snapshot => snapshot.phase !== 'compaction')
    const snapshot = snapshots.at(-1)
    if (snapshot && group.anchor === null) {
      group.anchor = known(snapshot.input) ? snapshot.input
        : known(group.output) ? Math.max(0, snapshot.used - group.output) : null
    }
    group.anchorSource = known(group.measuredInput) ? 'completed-response' : snapshot ? 'active-context' : null
    if (!regions.has(group.region)) regions.set(group.region, [])
    regions.get(group.region).push(group)
  }
  for (const region of regions.values()) {
    // A measured decrease is a retention boundary even when the summary was lost.
    let start = 0
    let previousAnchor = null
    const spans = []
    region.forEach((group, index) => {
      if (known(group.anchor) && known(previousAnchor) && group.anchor < previousAnchor) {
        spans.push(region.slice(start, index))
        start = index
        group.contextLoss = true
      }
      if (known(group.anchor)) previousAnchor = group.anchor
    })
    spans.push(region.slice(start))
    for (const span of spans) {
      for (const [index, group] of span.entries()) {
        const before = span.slice(0, index).filter(item => known(item.anchor)).at(-1)
        const after = span.slice(index + 1).find(item => known(item.anchor))
        group.lower = before?.anchor ?? group.contextSeed?.used ?? 0
        group.upper = after?.anchor ?? Infinity
        if (known(group.anchor)) {
          group.nominal = group.anchor
          group.lower = group.anchor
          group.upper = group.anchor
        } else if (before && after) {
          const growth = Math.max(0, after.visibleInput - before.visibleInput)
          const ratio = growth > 0 ? Math.min(1, Math.max(0, group.visibleInput - before.visibleInput) / growth) : 0
          group.nominal = before.anchor + (after.anchor - before.anchor) * ratio
        } else if (after) {
          group.nominal = after.visibleInput > 0 ? after.anchor * Math.min(1, (group.visibleInput || 0) / after.visibleInput) : 0
        } else if (before) group.nominal = before.anchor + Math.max(0, (group.visibleInput || 0) - (before.visibleInput || 0))
        else group.nominal = known(group.visibleInput) ? group.visibleInput + (group.contextSeed?.used || 0) : null
        if (!known(group.anchor) && known(group.contextLimit)) {
          group.upper = Math.min(group.upper, Math.max(0, group.contextLimit - (group.output || 0)))
        }
      }
    }
  }
}

// Fit a cumulative budget inside nonnegative, anchor-bounded context intervals.
const fitBudget = (groups, target) => {
  if (!known(target)) {
    groups.forEach(group => { group.input = known(group.nominal) ? Math.round(group.nominal) : null })
    return
  }
  const free = groups.filter(group => !known(group.anchor) && known(group.nominal))
  const fixed = sum(groups.filter(group => known(group.anchor)).map(group => group.anchor))
  const value = (group, scale) => Math.min(group.upper, Math.max(group.lower, group.nominal * scale))
  const at = scale => fixed + sum(free.map(group => value(group, scale)))
  let low = 0
  let high = 1
  while (at(high) < target && high < 2 ** 48) high *= 2
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2
    if (at(middle) < target) low = middle
    else high = middle
  }
  groups.forEach(group => {
    group.input = known(group.anchor) ? group.anchor : known(group.nominal) ? Math.round(value(group, high)) : null
  })
  let remainder = target - sum(groups.map(group => group.input || 0))
  // Integer rounding does not create a decreasing append-only context.
  const ordered = remainder > 0 ? [...groups].reverse() : groups
  for (const group of ordered) {
    if (!remainder || known(group.anchor) || !known(group.input)) continue
    const index = groups.indexOf(group)
    const before = groups[index - 1]
    const after = groups[index + 1]
    const lower = before?.region === group.region && !group.contextLoss ? Math.max(group.lower, before.input || 0) : group.lower
    const upper = after?.region === group.region && !after.contextLoss ? Math.min(group.upper, after.input ?? Infinity) : group.upper
    const change = Math.max(lower - group.input, Math.min(upper - group.input, remainder))
    group.input += change
    remainder -= change
  }
}

const snapshotsFor = (agent, row, cutoff) => {
  const snapshots = []
  const budgets = []
  const cumulative = new Map()
  const seen = new Set()
  for (const entry of agent.events || []) {
    const event = entry.event
    if (event.runId !== row.id || event.ts > cutoff) continue
    const raw = event.snapshot || event.params?.tokenUsage
    if (event.kind === 'token_usage_snapshot' && raw) {
      const key = event.providerAgentId || event.evidenceScopeId || row.id
      const input = inputUsage(raw.total)
      const previous = cumulative.get(key)
      if (known(input)) {
        if (previous && input >= previous.input) budgets.push({
          kind: 'cumulative-input-delta', start: previous.order, end: entry.order,
          target: input - previous.input, source: entry.source,
        })
        cumulative.set(key, { input, order: entry.order })
      }
      if (known(raw.last?.totalTokens)) snapshots.push({ order: entry.order, used: raw.last.totalTokens,
        input: inputUsage(raw.last), output: outputUsage(raw.last), source: entry.source, phase: 'post-response',
        semantics: 'Active context, including output. Snapshot does not establish a request boundary.' })
    }
    if (event.kind === 'turn_usage') {
      const input = inputUsage(event.usage)
      const key = event.evidenceId || fingerprint([event.evidenceScopeId, event.usage, event.ts])
      if (known(input) && !seen.has(key)) {
        const prior = budgets.filter(budget => budget.kind === 'turn-input').at(-1)
        budgets.push({ kind: 'turn-input', start: prior?.end ?? -Infinity, end: entry.order, target: input, source: entry.source })
        seen.add(key)
      }
    }
    if (known(event.context?.usedTokens)) {
      const used = event.context.usedTokens
      // Providers may emit a context event immediately after the richer snapshot.
      if (snapshots.at(-1)?.used === used && snapshots.at(-1)?.order === entry.order - 1) continue
      snapshots.push({ order: entry.order, used, input: null, source: entry.source,
        phase: ['compacting', 'awaiting_update'].includes(event.context.status) ? 'compaction' : 'post-response',
        semantics: 'May include generated output. Output attribution and observation timing are inferred.' })
    }
  }
  const context = agent.session.context
  if (context?.runId === row.id && known(context.usedTokens) && known(context.updatedAt) && context.updatedAt <= cutoff
    && (!row.endedAt || context.updatedAt <= row.endedAt)
    && !snapshots.length) {
    const entries = (agent.events || []).filter(entry => entry.event.runId === row.id && entry.event.ts <= context.updatedAt)
    const thread = entries.map(entry => entry.event.providerAgentId).filter(Boolean).at(-1)
    if (!context.providerAgentId || context.providerAgentId === thread) snapshots.push({
      order: entries.at(-1)?.order ?? Infinity, used: context.usedTokens, input: null,
      phase: ['compacting', 'awaiting_update'].includes(context.status) ? 'compaction' : 'post-response',
      source: { field: 'session.context', sessionId: agent.id }, semantics: 'Latest persisted active context for this run at cutoff.' })
  }
  return { snapshots, budgets }
}

const createFittedReplayEvidence = (data, original, tokenizer) => {
  const blocks = original.blocks.map(block => ({ ...block }))
  const blockMap = new Map(blocks.map(block => [block.id, block]))
  const turns = []
  const calibration = []
  const reconstruction = []
  const gaps = [...original.gaps]
  const blockWeights = new Map()
  const outputWeights = new Map()
  const opaqueContexts = new Map()
  for (const agent of data.agents) {
    let history = []
    let region = 0
    let priorThread = null
    let priorModel = null
    let priorFit = null
    const rows = [...agent.rows].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || a.id.localeCompare(b.id))
    for (const row of rows) {
      const candidates = original.turns.filter(turn => turn.sessionId === agent.id && turn.runId === row.id)
        .map(turn => ({ ...turn, blocks: [...turn.blocks], candidateTurnIds: [turn.id], contextSnapshots: [],
          measuredInput: turn.requestStatus === 'completed' ? inputUsage(turn.measuredUsage) : null,
          measuredOutput: turn.requestStatus === 'completed' ? outputUsage(turn.measuredUsage) : null }))
      const byId = new Map(candidates.map(turn => [turn.id, turn]))
      const local = blocks.filter(block => block.sessionId === agent.id && block.runId === row.id)
      const actions = [...candidates.map(turn => ({ kind: 'request', order: turn.order, id: turn.id })),
        ...local.map(block => ({ kind: 'block', order: block.kind === 'tool_result' ? block.lastOrder : block.order,
          index: block.sectionIndex, id: block.id }))]
        .sort((a, b) => a.order - b.order || (a.index ?? 0) - (b.index ?? 0) || a.id.localeCompare(b.id))
      let fence = true
      for (const action of actions) {
        if (action.kind === 'block') {
          const block = blockMap.get(action.id)
          if (block.kind === 'boundary') {
            region += 1
            fence = true
            if (['compaction', 'reset'].includes(block.boundary)) history = []
            continue
          }
          if (block.kind === 'prompt') {
            fence = true
            const thread = agent.events.find(entry => entry.order === block.order)?.event.providerAgentId
            if (thread && priorThread && thread !== priorThread) {
              history = []
              region += 1
            }
            if (thread) priorThread = thread
          }
          if (visible(block)) history.push(block)
          continue
        }
        const group = byId.get(action.id)
        if (priorModel && priorModel !== group.model) {
          region += 1
          fence = true
        }
        priorModel = group.model
        group.region = region
        group.history = [...history]
        const request = tokenizer.request(history, group.model)
        group.visibleInput = request.tokens
        group.requestFingerprint = request.fingerprint
        group.visibleOutput = tokenizer.output(group.blocks.map(id => blockMap.get(id)), group.model).tokens
        group.fence = fence
        fence = false
      }
      const { snapshots, budgets } = snapshotsFor(agent, row, data.cutoff)
      const unmatchedSnapshots = []
      for (const snapshot of snapshots) {
        const group = candidates.filter(turn => turn.order <= snapshot.order).at(-1)
        const boundary = local.some(block => block.kind === 'boundary' && ['compaction', 'reset'].includes(block.boundary)
          && block.order > (group?.order ?? -Infinity) && block.order <= snapshot.order)
        if (!group || boundary || snapshot.phase === 'compaction') {
          const next = candidates.find(turn => turn.order > snapshot.order)
          // A post-compaction observation measures the new region's opaque
          // context. It is not the input of the response before compaction.
          if (next && boundary && snapshot.phase !== 'compaction') {
            for (const candidate of candidates.filter(turn => turn.region === next.region && turn.order >= next.order)) {
              candidate.contextSeed = snapshot
            }
          } else unmatchedSnapshots.push(snapshot)
        } else group.contextSnapshots.push(snapshot)
      }
      const accounting = original.runAccounting.find(item => item.sessionId === agent.id && item.runId === row.id)
      const targetRequests = accounting?.expectedRequests ?? null
      let groups = candidates
      allocateOutput(groups, row.output)
      shape(groups)
      // Keep response identities and user/context boundaries. Only unmeasured
      // tool batches can lose a candidate boundary, with the ambiguity exposed.
      const mergeable = index => {
        const left = groups[index - 1]
        const right = groups[index]
        if (!left || right.fence || left.region !== right.region || left.responseId || right.responseId
          || known(left.measuredInput) || known(right.measuredInput) || left.contextSnapshots.length || right.contextSnapshots.length) return false
        return right.blocks.some(id => blockMap.get(id).kind === 'tool_call')
          && right.blocks.every(id => ['tool_call', 'thinking'].includes(blockMap.get(id).kind))
          && !budgets.some(budget => left.order <= budget.end && budget.end < right.order)
      }
      let merged = 0
      while (groups.length > 1) {
        const current = total(groups.map(group => group.nominal))
        const choices = groups.map((group, index) => ({ group, index })).filter(({ index }) => mergeable(index))
        if (!choices.length) break
        if (known(targetRequests) && groups.length <= targetRequests) break
        const best = choices.sort((a, b) => {
          const score = choice => known(row.input) && known(current)
            ? Math.abs(current - choice.group.nominal - row.input) : choice.group.nominal || 0
          return score(a) - score(b) || a.index - b.index
        })[0]
        if (!known(targetRequests) && (!known(row.input) || !known(current)
          || Math.abs(current - best.group.nominal - row.input) >= Math.abs(current - row.input))) break
        const left = groups[best.index - 1]
        const right = best.group
        left.blocks.push(...right.blocks)
        left.candidateTurnIds.push(...right.candidateTurnIds)
        left.sources = [...left.sources, ...right.sources]
        left.visibleOutput = tokenizer.output(left.blocks.map(id => blockMap.get(id)), left.model).tokens
        groups.splice(best.index, 1)
        merged += 1
        allocateOutput(groups, row.output)
        shape(groups)
      }
      const limitations = []
      if (merged) limitations.push('Unmeasured tool boundaries were grouped to fit usage. Tool-result dependencies inside these inferred batches are not fully known.')
      if (known(targetRequests) && targetRequests !== groups.length) limitations.push('Recorded request count cannot be placed without inventing requests or discarding hard boundaries.')
      if (groups.some(group => group.contextSnapshots.some(snapshot => !known(snapshot.input)))) limitations.push('Active-context snapshots may include output. Estimated response output is subtracted when input is not recorded separately.')
      if (groups.some(group => group.contextSeed)) limitations.push('Post-compaction context is represented as opaque measured mass. Replacement summary text is unavailable.')
      if (unmatchedSnapshots.length) limitations.push('Some context snapshots lack an attributable request or describe compaction. They do not create request boundaries or summary text.')
      if (groups.some(group => group.contextLoss)) limitations.push('Measured context shrinks without a captured summary. A new retention region is required, with unknown retained content.')
      if (!known(row.input)) limitations.push('Cumulative input usage is unavailable. Unconstrained requests retain transcript-based estimates.')
      if (agent.session.fork) limitations.push('Inherited session content is incomplete.')
      if (groups.some(group => group.visibleInput === null)) limitations.push('Tokenizer unavailable for some captured context.')
      const constraints = []
      const deferredBudgets = []
      const assigned = new Set()
      // Nonoverlapping measured intervals constrain subsets before the run total.
      for (const budget of budgets) {
        const subset = groups.filter(group => group.order > budget.start && group.order <= budget.end)
        if (subset.some(group => assigned.has(group.id))) {
          deferredBudgets.push({ budget, subset })
          continue
        }
        fitBudget(subset, budget.target)
        subset.forEach(group => assigned.add(group.id))
        const fitted = total(subset.map(group => group.input))
        constraints.push({ ...budget, fitted, residual: fitted === null ? null : budget.target - fitted })
      }
      const assignedInput = total(groups.filter(group => assigned.has(group.id)).map(group => group.input))
      fitBudget(groups.filter(group => !assigned.has(group.id)), known(row.input) && assignedInput !== null
        ? Math.max(0, row.input - assignedInput) : null)
      for (const { budget, subset } of deferredBudgets) {
        const fitted = total(subset.map(group => group.input))
        constraints.push({ ...budget, fitted, residual: fitted === null ? null : budget.target - fitted,
          interpretation: 'Overlapping cumulative constraint evaluated against the fitted interval allocations.' })
      }
      const fittedInput = total(groups.map(group => group.input))
      const fittedOutput = total(groups.map(group => group.output))
      const inputResidual = known(row.input) && fittedInput !== null ? row.input - fittedInput : null
      const outputResidual = known(row.output) && fittedOutput !== null ? row.output - fittedOutput : null
      constraints.push({ kind: 'run-input', target: row.input, fitted: fittedInput, residual: inputResidual, source: row.usageSource },
        { kind: 'run-output', target: row.output, fitted: fittedOutput, residual: outputResidual, source: row.usageSource },
        { kind: 'request-count', target: targetRequests, fitted: groups.length,
          residual: known(targetRequests) ? targetRequests - groups.length : null, source: row.requestEvidence?.detail })
      for (const group of groups) {
        if (known(group.contextLimit)) constraints.push({ kind: 'context-limit', turnId: group.id,
          target: group.contextLimit, fitted: known(group.input) && known(group.output) ? group.input + group.output : null,
          residual: known(group.input) && known(group.output) ? Math.min(0, group.contextLimit - group.input - group.output) : null,
          semantics: 'Upper bound on request input plus generated output.' })
        if (group.contextSeed) constraints.push({ kind: 'post-compaction-context-floor', turnId: group.id,
          target: group.contextSeed.used, fitted: known(group.input) ? Math.min(group.contextSeed.used, group.input) : null,
          residual: known(group.input) ? Math.max(0, group.contextSeed.used - group.input) : null,
          source: group.contextSeed.source })
        for (const snapshot of group.contextSnapshots) {
          const output = known(snapshot.output) ? snapshot.output : group.output
          const fitted = known(group.input) && known(output) ? group.input + output : null
          constraints.push({ kind: 'active-context', turnId: group.id, target: snapshot.used, fitted,
            residual: fitted === null ? null : snapshot.used - fitted, source: snapshot.source, semantics: snapshot.semantics })
        }
      }
      for (const snapshot of unmatchedSnapshots) constraints.push({ kind: 'unplaced-active-context', target: snapshot.used,
        fitted: null, residual: null, source: snapshot.source, semantics: snapshot.semantics })
      if (constraints.some(constraint => Number.isFinite(constraint.residual) && constraint.residual !== 0)) limitations.push('Measured constraints conflict with recoverable nonnegative request contexts. Residual usage is left unassigned.')
      const report = { sessionId: agent.id, runId: row.id, targetInput: row.input, fittedInput, inputResidual,
        targetOutput: row.output, fittedOutput, outputResidual, targetRequests, fittedRequests: groups.length,
        candidateRequests: candidates.length + merged, requestResidual: known(targetRequests) ? targetRequests - groups.length : null,
        constraints, limitations }
      reconstruction.push(report)
      limitations.forEach(reason => gaps.push({ sessionId: agent.id, runId: row.id, reason }))
      // Persist context mass by block introduction. Growth is weighted by the
      // actual captured additions, with opaque mass kept separate from text.
      let prior = priorFit
      for (const group of groups) {
        const activeHistory = group.history
        const decrease = prior && prior.region === group.region && known(group.input) && known(prior.input) && group.input < prior.input
        if (decrease) {
          group.contextLoss = true
          constraints.push({ kind: 'append-only-context', turnId: group.id, target: prior.input,
            fitted: group.input, residual: prior.input - group.input,
            semantics: 'Context cannot shrink within an append-only region. An unobserved retention change would be required.' })
          limitations.push('Cumulative constraints require a context decrease without captured retention evidence.')
          gaps.push({ sessionId: agent.id, runId: row.id, turnId: group.id,
            reason: 'Fitted context decreases across cumulative constraints. Retention is unknown, so append-only reconstruction stops here.' })
        }
        const reset = !prior || prior.region !== group.region || group.contextLoss
        const previousIds = new Set(reset ? [] : prior.history.map(block => block.id))
        const additions = activeHistory.filter(block => !previousIds.has(block.id))
        const weights = additions.map(block => {
          const counted = tokenizer.request([block], group.model).tokens
          const empty = tokenizer.request([], group.model).tokens
          return counted === null || empty === null ? 0 : Math.max(0, counted - empty)
        })
        const captured = sum(weights)
        const increase = known(group.input) ? Math.max(0, group.input - (reset ? 0 : prior.input || 0)) : null
        const visibleIncrease = known(increase) ? Math.min(Math.max(0, increase - (reset ? group.contextSeed?.used || 0 : 0)), captured) : null
        const contextKey = group.contextLoss ? `${agent.id}:${group.region}:${group.id}`
          : !reset ? prior.contextKey : `${agent.id}:${group.region}:context`
        const allocations = new Map(reset ? [] : prior.contextContributions.map(item => [item.blockId, item.tokens]))
        let assignedMass = 0
        let cumulativeMass = 0
        additions.forEach((block, index) => {
          cumulativeMass += weights[index]
          const next = visibleIncrease === null ? null : captured > 0 ? Math.round(visibleIncrease * cumulativeMass / captured) : 0
          const tokens = next === null ? null : next - assignedMass
          assignedMass = next || 0
          allocations.set(block.id, tokens)
          // First introduction governs replay. Later retention changes remain
          // per-request context evidence rather than overwriting earlier work.
          if (!blockWeights.has(block.id)) blockWeights.set(block.id, { tokens, model: group.model, visible: weights[index] })
        })
        const opaque = known(group.input) ? Math.max(0, group.input - sum([...allocations.values()].map(value => value || 0))) : null
        group.contextContributions = [...allocations].map(([blockId, tokens]) => ({ blockId, tokens }))
        group.opaqueContext = opaque
        group.contextKey = contextKey
        opaqueContexts.set(group.id, { key: contextKey, tokens: opaque, model: group.model })
        const outputBlocks = group.blocks.map(id => blockMap.get(id)).filter(block => block.generated)
        const visibleWeights = outputBlocks.map(block => tokenizer.output([block], group.model).tokens || 0)
        const visibleTotal = sum(visibleWeights)
        let assignedOutput = 0
        let cumulativeOutput = 0
        outputBlocks.forEach((block, index) => {
          cumulativeOutput += visibleWeights[index]
          const next = known(group.output) && visibleTotal > 0 ? Math.round(Math.min(group.output, visibleTotal) * cumulativeOutput / visibleTotal) : 0
          outputWeights.set(block.id, { tokens: next - assignedOutput, model: group.model, visible: visibleWeights[index] })
          assignedOutput = next
        })
        group.unattributedOutput = known(group.output) ? Math.max(0, group.output - assignedOutput) : null
        group.blocks.forEach(id => { blockMap.get(id).turnId = group.id })
        const fitted = { ...group, confidence: group.confidence === 'measured' ? 'measured' : 'allocated',
          reason: group.responseId ? group.reason : 'Candidate request grouping and context fitted to original-session measured usage.',
          attributedUsage: { input: group.input, output: group.output },
          attribution: 'Nonnegative original-session fit. Recorded complete response metrics take precedence.',
          fitting: { input: group.input, output: group.output, visibleInput: group.visibleInput, visibleOutput: group.visibleOutput,
            region: group.region, contextKey, contextLoss: Boolean(group.contextLoss), opaqueContext: opaque,
            contextContributions: group.contextContributions, candidateTurnIds: group.candidateTurnIds,
            contextSnapshots: group.contextSnapshots, unattributedOutput: group.unattributedOutput,
            inputResidual, outputResidual, contextSeed: group.contextSeed || null } }
        delete fitted.history
        turns.push(fitted)
        prior = group
        priorFit = group
      }
      report.requests = groups.map(group => ({ turnId: group.id, candidateTurnIds: group.candidateTurnIds,
        responseId: group.responseId || null, boundary: group.responseId ? 'recorded-identity' : 'inferred-batch',
        input: group.input, output: group.output, region: group.region, contextSnapshots: group.contextSnapshots,
        opaqueContext: group.opaqueContext, unattributedOutput: group.unattributedOutput }))
      const regions = [...new Set(groups.map(group => group.region))]
      for (const value of regions) {
        const localGroups = groups.filter(group => group.region === value)
        calibration.push({ sessionId: agent.id, runId: row.id, model: localGroups[0]?.model, region: value,
          constraints, residualEnvelope: constraints.some(item => item.residual !== null)
            ? Math.max(0, ...constraints.map(item => Math.abs(item.residual || 0))) : null,
          interpretation: 'Fitted original requests constrain the rewritten replay. Zero residual is a feasible scenario, not a unique reconstruction.',
          samples: localGroups.map(group => ({ turnId: group.id, confidence: group.responseId ? group.confidence : 'allocated',
            candidateTurnIds: group.candidateTurnIds, sources: group.sources, measuredInput: group.measuredInput,
            reconstructedInput: group.input, visibleInput: group.visibleInput, requestFingerprint: group.requestFingerprint,
            measuredOutput: group.measuredOutput, generatedOutput: group.output,
            residual: known(group.measuredInput) && known(group.input) ? group.measuredInput - group.input : null,
            eligible: known(group.input), reliableRegion: group.confidence === 'measured' && !limitations.length,
            contextSnapshots: group.contextSnapshots,
            reason: group.anchorSource === 'completed-response' ? 'Recorded complete response input retained.'
              : 'Grouped and fitted using cumulative usage, captured context growth and available active-context snapshots.' })) })
      }
    }
  }
  return { evidence: { ...original, turns, blocks, gaps }, originalTurns: original.turns, calibration, reconstruction, blockWeights, outputWeights, opaqueContexts }
}

module.exports = { createFittedReplayEvidence }
