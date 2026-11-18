const { fingerprint } = require('./replayTokenizer')

const known = value => Number.isFinite(value) && value >= 0
const sum = values => values.reduce((total, value) => total + value, 0)
const total = values => values.every(known) ? sum(values) : null
const field = (value, names) => names.map(name => value?.[name]).find(known) ?? null
const visible = block => block.kind !== 'boundary' && block.kind !== 'thinking' && block.visibility !== 'provider-dependent'
const inputUsage = usage => field(usage, ['inputTokens', 'input_tokens', 'input'])
const outputUsage = usage => field(usage, ['outputTokens', 'output_tokens', 'output'])
const tolerance = 0.001
const residual = (target, fitted) => known(target) && known(fitted)
  ? Math.abs(target - fitted) < tolerance ? 0 : target - fitted : null

// Allocate only to evidenced content, preserving complete response measurements.
const allocateOutput = (groups, target) => {
  const fixed = groups.filter(group => known(group.measuredOutput))
  const free = groups.filter(group => !known(group.measuredOutput))
  const remaining = known(target) ? Math.max(0, target - sum(fixed.map(group => group.measuredOutput))) : null
  const weight = sum(free.map(group => group.visibleOutput || 1))
  let assigned = 0
  let cumulative = 0
  for (const group of groups) {
    if (known(group.measuredOutput)) group.output = group.measuredOutput
    else if (remaining !== null && weight > 0) {
      cumulative += group.visibleOutput || 1
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
    const snapshots = group.contextSnapshots.filter(snapshot => snapshot.phase !== 'compaction')
    const snapshot = snapshots.find(item => known(item.input)) || snapshots.at(-1)
    group.anchor = known(group.measuredInput) ? group.measuredInput : snapshot?.input ?? null
    group.contextObservation = group.anchor ?? (snapshot && known(group.output) ? Math.max(0, snapshot.used - group.output) : null)
    group.anchorSource = known(group.measuredInput) ? 'completed-response' : snapshot ? 'active-context' : null
    group.contextLoss = false
    if (!regions.has(group.region)) regions.set(group.region, [])
    regions.get(group.region).push(group)
  }
  for (const region of regions.values()) {
    // A measured decrease is a retention boundary even when the summary was lost.
    let start = 0
    let previousAnchor = null
    const spans = []
    region.forEach((group, index) => {
      if (known(group.contextObservation) && known(previousAnchor) && group.contextObservation < previousAnchor) {
        spans.push(region.slice(start, index))
        start = index
        group.contextLoss = true
      }
      if (known(group.contextObservation)) previousAnchor = group.contextObservation
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
        } else if (known(group.contextObservation)) group.nominal = group.contextObservation
        else if (before && after) {
          const growth = Math.max(0, after.visibleInput - before.visibleInput)
          const ratio = growth > 0 ? Math.min(1, Math.max(0, group.visibleInput - before.visibleInput) / growth) : 0
          group.nominal = before.anchor + (after.anchor - before.anchor) * ratio
        } else if (after) {
          group.nominal = after.visibleInput > 0 ? after.anchor * Math.min(1, (group.visibleInput || 0) / after.visibleInput) : 0
        } else if (before) group.nominal = before.anchor + Math.max(0, (group.visibleInput || 0) - (before.visibleInput || 0))
        else group.nominal = group.contextObservation ?? (known(group.visibleInput) ? group.visibleInput + (group.contextSeed?.used || 0) : null)
        if (!known(group.anchor) && known(group.contextLimit)) {
          group.upper = Math.min(group.upper, Math.max(0, group.contextLimit - (group.output || 0)))
        }
      }
    }
  }
}

// Project all overlapping measurements together. Complete response fields are
// fixed variables, so conflicting totals cannot overwrite recorded request usage.
const fitRequests = (groups, budgets) => {
  shape(groups)
  const variables = groups.flatMap(group => [
    { value: group.nominal ?? 0, fixed: group.measuredInput, supported: known(group.nominal) },
    { value: group.output ?? 0, fixed: group.measuredOutput, supported: known(group.output) },
  ])
  const constraints = []
  const add = (terms, target, kind, upper = false) => {
    if (!known(target)) return
    if (!upper) terms.forEach(([index]) => { variables[index].supported = true })
    constraints.push({ terms, target, kind, upper })
  }
  for (const budget of budgets) {
    add(groups.flatMap((group, index) => budget.includes(group) ? [[index * 2 + (budget.output ? 1 : 0), 1]] : []),
      budget.target, budget.kind)
  }
  groups.forEach((group, index) => {
    const input = index * 2
    const output = input + 1
    for (const snapshot of group.contextSnapshots) {
      add([[input, 1]], snapshot.input, 'active-input')
      add([[output, 1]], snapshot.output, 'active-output')
      add([[input, 1], [output, 1]], snapshot.used, 'active-context')
    }
    if (group.contextSeed) {
      variables[input].supported = true
      constraints.push({ terms: [[input, -1]], target: -group.contextSeed.used, kind: 'post-compaction-context-floor', upper: true })
    }
    add([[input, 1], [output, 1]], group.contextLimit, 'context-limit', true)
    const before = groups[index - 1]
    if (before && before.region === group.region && !group.contextLoss) {
      add([[(index - 1) * 2, 1], [input, -1]], 0, 'append-only-context', true)
    }
  })
  const equations = constraints.map(constraint => {
    const terms = constraint.terms.filter(([index]) => !known(variables[index].fixed))
    return { ...constraint, terms,
      target: constraint.target - sum(constraint.terms.filter(([index]) => known(variables[index].fixed))
        .map(([index, coefficient]) => variables[index].fixed * coefficient)),
      norm: sum(terms.map(([, coefficient]) => coefficient * coefficient)), correction: 0 }
  })
  let values = variables.map(variable => variable.fixed ?? variable.value)
  const bounds = variables.map(() => 0)
  const error = candidate => sum(constraints.map(constraint => {
    const delta = sum(constraint.terms.map(([index, coefficient]) => candidate[index] * coefficient)) - constraint.target
    return (constraint.upper ? Math.max(0, delta) : Math.abs(delta)) ** 2
  }))
  let best = [...values]
  let bestError = error(values)
  let iterations = 0
  let converged = bestError < tolerance ** 2
  for (let iteration = 0; iteration < 1200 && !converged; iteration += 1) {
    for (const equation of equations) {
      if (!equation.norm) continue
      for (const [index, coefficient] of equation.terms) values[index] += equation.correction * coefficient
      const delta = sum(equation.terms.map(([index, coefficient]) => values[index] * coefficient)) - equation.target
      const adjustment = (equation.upper ? Math.max(0, delta) : delta) / equation.norm
      for (const [index, coefficient] of equation.terms) values[index] -= adjustment * coefficient
      equation.correction = adjustment
    }
    values = values.map((value, index) => {
      if (known(variables[index].fixed)) return variables[index].fixed
      const candidate = value + bounds[index]
      bounds[index] = Math.min(0, candidate)
      return Math.max(0, candidate)
    })
    iterations = iteration + 1
    const currentError = error(values)
    if (currentError < bestError) {
      best = [...values]
      bestError = currentError
    }
    converged = currentError < tolerance ** 2
  }
  groups.forEach((group, index) => {
    group.input = variables[index * 2].supported || known(group.measuredInput) ? best[index * 2] : null
    group.output = variables[index * 2 + 1].supported || known(group.measuredOutput) ? best[index * 2 + 1] : null
  })
  return { converged, iterations, squaredResidual: bestError, tolerance,
    method: 'Joint nonnegative projection of run totals, overlapping interval budgets and active input/output context, with completed response usage fixed.' }
}

const snapshotsFor = (agent, row, cutoff) => {
  const snapshots = []
  const budgets = []
  const cumulative = new Map()
  const seen = new Set()
  const turnEnds = new Map()
  const notices = []
  for (const entry of [...(agent.events || [])].sort((a, b) => a.order - b.order)) {
    const event = entry.event
    if (event.runId !== row.id || event.ts > cutoff) continue
    const raw = event.snapshot || event.params?.tokenUsage
    if (event.kind === 'token_usage_snapshot' && raw) {
      const key = fingerprint([event.evidenceScopeId || row.id, event.providerAgentId || null])
      const input = inputUsage(raw.total)
      const previous = cumulative.get(key)
      if (known(input)) {
        if (previous && input >= previous.input) budgets.push({
          kind: 'cumulative-input-delta', start: previous.order, end: entry.order,
          target: input - previous.input, source: entry.source,
        })
        if (previous && input < previous.input) notices.push('A cumulative usage counter reset starts a new measurement interval. Its initial usage is unknown.')
        if (!previous) notices.push('The first cumulative snapshot has no established zero baseline. Only subsequent within-scope deltas constrain requests.')
        cumulative.set(key, { input, order: entry.order })
      }
      const lastInput = inputUsage(raw.last)
      const lastOutput = outputUsage(raw.last)
      const used = field(raw.last, ['totalTokens', 'total_tokens', 'total']) ?? total([lastInput, lastOutput])
      if (known(used) || known(lastInput)) snapshots.push({ order: entry.order, used,
        requestId: event.requestId || raw.last?.requestId || null,
        input: lastInput, output: lastOutput, source: entry.source, phase: 'post-response',
        semantics: 'Active context, including output. Snapshot does not establish a request boundary.' })
    }
    if (event.kind === 'turn_usage') {
      const input = inputUsage(event.usage)
      const key = event.evidenceId || fingerprint([event.evidenceScopeId, event.usage, event.ts])
      if (known(input) && !seen.has(key)) {
        const scope = fingerprint([event.evidenceScopeId || row.id, event.providerAgentId || null])
        budgets.push({ kind: 'turn-input', start: turnEnds.get(scope) ?? -Infinity, end: entry.order, target: input, source: entry.source })
        turnEnds.set(scope, entry.order)
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
  return { snapshots, budgets, notices: [...new Set(notices)] }
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
    let pendingContext = null
    const prepared = []
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
            if (['compaction', 'reset'].includes(block.boundary)) {
              history = []
              pendingContext = null
            }
            continue
          }
          if (block.kind === 'prompt') {
            fence = true
            const thread = agent.events.find(entry => entry.order === block.order)?.event.providerAgentId
            if (thread && priorThread && thread !== priorThread) {
              history = []
              pendingContext = null
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
        if (pendingContext) {
          group.contextSeed = pendingContext
          pendingContext.seeded = true
        }
        group.history = [...history]
        const request = tokenizer.request(history, group.model)
        group.visibleInput = request.tokens
        group.requestFingerprint = request.fingerprint
        group.visibleOutput = tokenizer.output(group.blocks.map(id => blockMap.get(id)), group.model).tokens
        group.fence = fence
        fence = false
      }
      const { snapshots, budgets, notices } = snapshotsFor(agent, row, data.cutoff)
      const unmatchedSnapshots = []
      for (const snapshot of snapshots) {
        const group = (snapshot.requestId && candidates.find(turn => turn.responseId === snapshot.requestId))
          || candidates.filter(turn => turn.order <= snapshot.order && (turn.end === null || turn.end <= snapshot.order)).at(-1)
          || candidates.filter(turn => turn.order <= snapshot.order).at(-1)
        const boundary = local.some(block => block.kind === 'boundary' && ['compaction', 'reset'].includes(block.boundary)
          && block.order > (group?.order ?? -Infinity) && block.order <= snapshot.order)
        if (!group || boundary || snapshot.phase === 'compaction') {
          const next = candidates.find(turn => turn.order > snapshot.order)
          // A post-compaction observation measures the new region's opaque
          // context. It is not the input of the response before compaction.
          if (boundary && snapshot.phase !== 'compaction' && known(snapshot.used)) {
            const laterReset = local.some(block => block.kind === 'boundary' && ['compaction', 'reset'].includes(block.boundary)
              && block.order > snapshot.order)
            if (!laterReset) pendingContext = snapshot
            if (next && !local.some(block => block.kind === 'boundary' && ['compaction', 'reset'].includes(block.boundary)
              && block.order > snapshot.order && block.order < next.order)) {
              snapshot.seeded = true
              for (const candidate of candidates.filter(turn => turn.region === next.region && turn.order >= next.order)) {
                candidate.contextSeed = snapshot
              }
            } else unmatchedSnapshots.push(snapshot)
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
          || known(left.measuredOutput) || known(right.measuredOutput)
          || known(left.measuredInput) || known(right.measuredInput) || left.contextSnapshots.length || right.contextSnapshots.length) return false
        return right.blocks.some(id => blockMap.get(id).kind === 'tool_call')
          && right.blocks.every(id => ['tool_call', 'thinking'].includes(blockMap.get(id).kind))
          && !budgets.some(budget => [budget.start, budget.end].some(order => left.order <= order && order < right.order))
      }
      let merged = 0
      const groupingScore = proposed => {
        const measures = [{ target: row.input, subset: proposed }, ...budgets.map(budget => ({
          target: budget.target, subset: proposed.filter(group => group.order > budget.start && group.order <= budget.end),
        }))]
        return sum(measures.filter(measure => known(measure.target)).map(({ target, subset }) => {
          const nominal = total(subset.map(group => group.nominal))
          const floor = sum(subset.map(group => group.lower || 0))
          const ceiling = sum(subset.map(group => group.upper))
          const infeasible = Math.max(0, floor - target, target - ceiling)
          return infeasible * 2 + (nominal === null ? 0 : Math.abs(nominal - target))
        }))
      }
      while (groups.length > 1) {
        const currentScore = groupingScore(groups)
        const choices = groups.map((group, index) => ({ group, index })).filter(({ index }) => mergeable(index))
        if (!choices.length) break
        if (known(targetRequests) && groups.length <= targetRequests) break
        const best = choices.sort((a, b) => {
          const score = choice => groupingScore(groups.filter((group, index) => index !== choice.index))
          return score(a) - score(b) || a.index - b.index
        })[0]
        if (!known(targetRequests) && ((!known(row.input) && !budgets.length)
          || groupingScore(groups.filter((group, index) => index !== best.index)) >= currentScore)) break
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
      prepared.push({ row, groups, budgets, unmatchedSnapshots, targetRequests, merged,
        candidateRequests: candidates.length + merged, notices })
    }
    const sessionGroups = prepared.flatMap(item => item.groups)
    const sessionBudgets = prepared.flatMap(({ row, groups, budgets }) => [
      ...budgets.map(budget => ({ ...budget,
        includes: group => groups.includes(group) && group.order > budget.start && group.order <= budget.end })),
      { kind: 'run-input', target: row.input, includes: group => groups.includes(group) },
      { kind: 'run-output', target: row.output, output: true, includes: group => groups.includes(group) },
    ])
    const solver = fitRequests(sessionGroups, sessionBudgets)
    for (const { row, groups, budgets, unmatchedSnapshots, targetRequests, merged, candidateRequests, notices } of prepared) {
      const limitations = [...notices]
      if (!solver.converged) limitations.push('Joint fitting did not satisfy all constraints within tolerance. Conflicting evidence or solver convergence may be responsible, inspect residuals.')
      if (merged) limitations.push('Unmeasured tool boundaries were grouped to fit usage. Tool-result dependencies inside these inferred batches are not fully known.')
      if (known(targetRequests) && targetRequests !== groups.length) limitations.push('Recorded request count cannot be placed without inventing requests or discarding hard boundaries.')
      if (groups.some(group => group.contextSnapshots.some(snapshot => !known(snapshot.input)))) limitations.push('Active-context snapshots may include output. Input and output are solved jointly when input is not recorded separately.')
      if (groups.some(group => group.contextSeed)) limitations.push('Post-compaction context is represented as opaque measured mass. Replacement summary text is unavailable.')
      if (unmatchedSnapshots.some(snapshot => !snapshot.seeded)) limitations.push('Some context snapshots lack an attributable request or describe compaction. They remain unplaced constraints and do not create request boundaries or summary text.')
      if (groups.some(group => group.contextLoss)) limitations.push('Measured context shrinks without a captured summary. A new retention region is required, with unknown retained content.')
      if (!known(row.input)) limitations.push('Cumulative input usage is unavailable. Unconstrained requests retain transcript-based estimates.')
      if (agent.session.fork) limitations.push('Inherited session content is incomplete.')
      if (groups.some(group => group.visibleInput === null)) limitations.push('Tokenizer unavailable for some captured context. Measured mass can still be fitted, but content attribution may remain opaque.')
      if (groups.some(group => !group.contextSnapshots.length && !known(group.measuredInput))) limitations.push('Some request contexts have no direct measurement. Their allocation is inferred from cumulative usage and captured growth.')
      if (groups.some(group => !group.visibleOutput && !known(group.measuredOutput) && group.output > 0)) limitations.push('Some aggregate output is allocated to requests with no captured output text. That allocation remains opaque.')
      const constraints = []
      for (const budget of budgets) {
        const subset = groups.filter(group => group.order > budget.start && group.order <= budget.end)
        const fitted = total(subset.map(group => group.input))
        constraints.push({ ...budget, fitted, residual: residual(budget.target, fitted),
          interpretation: 'Jointly fitted with overlapping intervals, run totals and active-context observations.' })
      }
      const fittedInput = total(groups.map(group => group.input))
      const fittedOutput = total(groups.map(group => group.output))
      const inputResidual = residual(row.input, fittedInput)
      const outputResidual = residual(row.output, fittedOutput)
      constraints.push({ kind: 'run-input', target: row.input, fitted: fittedInput, residual: inputResidual, source: row.usageSource },
        { kind: 'run-output', target: row.output, fitted: fittedOutput, residual: outputResidual, source: row.usageSource },
        { kind: 'request-count', target: targetRequests, fitted: groups.length,
          residual: known(targetRequests) ? targetRequests - groups.length : null, source: row.requestEvidence?.detail })
      for (const group of groups) {
        if (known(group.contextLimit)) constraints.push({ kind: 'context-limit', turnId: group.id,
          target: group.contextLimit, fitted: known(group.input) && known(group.output) ? group.input + group.output : null,
          residual: known(group.input) && known(group.output) ? Math.min(0, residual(group.contextLimit, group.input + group.output)) : null,
          semantics: 'Upper bound on request input plus generated output.' })
        if (group.contextSeed) constraints.push({ kind: 'post-compaction-context-floor', turnId: group.id,
          target: group.contextSeed.used, fitted: known(group.input) ? Math.min(group.contextSeed.used, group.input) : null,
          residual: known(group.input) ? Math.max(0, residual(group.contextSeed.used, group.input)) : null,
          source: group.contextSeed.source })
        for (const snapshot of group.contextSnapshots) {
          const fitted = total([group.input, group.output])
          constraints.push({ kind: 'active-context', turnId: group.id, target: snapshot.used, fitted,
            residual: residual(snapshot.used, fitted), source: snapshot.source, semantics: snapshot.semantics })
          for (const metric of ['input', 'output']) {
            if (known(snapshot[metric])) constraints.push({ kind: `active-${metric}`, turnId: group.id,
              target: snapshot[metric], fitted: group[metric], residual: residual(snapshot[metric], group[metric]), source: snapshot.source })
          }
        }
      }
      for (const snapshot of unmatchedSnapshots.filter(snapshot => !snapshot.seeded)) constraints.push({ kind: 'unplaced-active-context', target: snapshot.used,
        fitted: null, residual: null, source: snapshot.source, semantics: snapshot.semantics })
      if (constraints.some(constraint => Number.isFinite(constraint.residual) && constraint.residual !== 0)) limitations.push('Measured constraints remain unsatisfied by the recovered nonnegative request contexts. Residual usage is left explicit and is not inserted as fabricated requests.')
      const report = { sessionId: agent.id, runId: row.id, targetInput: row.input, fittedInput, inputResidual,
        targetOutput: row.output, fittedOutput, outputResidual, targetRequests, fittedRequests: groups.length,
        candidateRequests, requestResidual: known(targetRequests) ? targetRequests - groups.length : null,
        constraints, limitations, solver, status: 'unavailable' }
      reconstruction.push(report)
      limitations.forEach(reason => gaps.push({ sessionId: agent.id, runId: row.id, reason }))
      // Persist context mass by block introduction. Growth is weighted by the
      // actual captured additions, with opaque mass kept separate from text.
      let prior = priorFit
      for (const group of groups) {
        const activeHistory = group.history
        const decrease = prior && prior.region === group.region && known(group.input) && known(prior.input) && group.input < prior.input - tolerance
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
          const next = visibleIncrease === null ? null : captured > 0 ? visibleIncrease * cumulativeMass / captured : 0
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
          const next = known(group.output) && visibleTotal > 0 ? Math.min(group.output, visibleTotal) * cumulativeOutput / visibleTotal : 0
          outputWeights.set(block.id, { tokens: known(group.output) ? next - assignedOutput : null, model: group.model, visible: visibleWeights[index] })
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
            inputResidual, outputResidual, contextSeed: group.contextSeed || null,
            inputSource: known(group.measuredInput) ? 'completed-response' : group.anchorSource || (known(row.input) ? 'usage-fit' : 'transcript-estimate'),
            solverConverged: solver.converged } }
        delete fitted.history
        turns.push(fitted)
        prior = group
        priorFit = group
      }
      const measuredConstraints = constraints.filter(constraint => known(constraint.target))
      report.status = measuredConstraints.some(constraint => Number.isFinite(constraint.residual) && Math.abs(constraint.residual) >= tolerance)
        ? 'unresolved' : measuredConstraints.some(constraint => constraint.residual === null) || !known(row.input)
          ? 'partial' : measuredConstraints.length ? 'fitted' : 'unavailable'
      report.maxResidual = measuredConstraints.length ? Math.max(0, ...measuredConstraints.map(constraint => Math.abs(constraint.residual || 0))) : null
      report.requests = groups.map(group => ({ turnId: group.id, candidateTurnIds: group.candidateTurnIds,
        responseId: group.responseId || null, boundary: group.responseId ? 'recorded-identity' : 'inferred-batch',
        input: group.input, output: group.output, region: group.region, contextSnapshots: group.contextSnapshots,
        opaqueContext: group.opaqueContext, unattributedOutput: group.unattributedOutput }))
      const regions = [...new Set(groups.map(group => group.region))]
      for (const value of regions) {
        const localGroups = groups.filter(group => group.region === value)
        calibration.push({ sessionId: agent.id, runId: row.id, model: localGroups[0]?.model, region: value,
          constraints, residualEnvelope: constraints.some(item => Number.isFinite(item.residual))
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
