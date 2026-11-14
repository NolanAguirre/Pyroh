const { createTranscriptEvidence } = require('./transcriptContext')
const { createReplayTokenizer, serialize, freeze } = require('./replayTokenizer')

const known = value => Number.isFinite(value) && value >= 0
const sum = values => values.every(known) ? values.reduce((total, value) => total + value, 0) : null
const content = block => typeof block?.content === 'string' ? block.content : serialize(block?.content)
const parsed = value => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}
const unpack = value => {
  const object = parsed(value)
  if (object?.content?.length === 1 && object.content[0].type === 'text') return parsed(object.content[0].text)
  return object
}
const delegation = block => /^(?:mcp__harness_agents__|harness_agents\/)(spawn|status|wait|stop)$/.exec(block.name || '')?.[1] || null
const pureRead = block => /^(?:Read|read_file|read_file_text|mcp__filesystem__read_file)$/.test(block.name || '')
const range = (point, uncertainty, supported) => ({ estimate: point,
  lower: point === null ? null : supported ? Math.max(0, point - uncertainty) : 0,
  upper: point === null || !supported ? null : point + uncertainty })

const createSubagentReplay = (data, assumptions = {}) => {
  const evidence = createTranscriptEvidence(data.agents)
  const tokenizer = createReplayTokenizer()
  const blocks = new Map(evidence.blocks.map(block => [block.id, block]))
  const turns = new Map(evidence.turns.map(turn => [turn.id, turn]))
  const agents = new Map(data.agents.map(agent => [agent.id, agent]))
  const rows = new Map(data.agents.flatMap(agent => agent.rows.map(row => [`${agent.id}:${row.id}`, row])))
  const gaps = [...evidence.gaps, ...data.warnings.map(reason => ({ reason }))]
  const root = data.agents.find(agent => agent.depth === 0)
  const dispositions = new Map(evidence.blocks.map(block => [block.id, { blockId: block.id, action: 'retain',
    reason: 'Unique content or insufficient evidence for deletion.', sources: block.sources, dependencies: [...block.dependencies] }]))
  const turnDispositions = new Map(evidence.turns.map(turn => [turn.id, { turnId: turn.id, action: 'retain',
    reason: 'Preserve original work unless all generated content is proven removable.', sources: turn.sources }]))
  const remove = (block, reason, dependencies = []) => dispositions.set(block.id, {
    blockId: block.id, action: 'remove', reason, sources: block.sources, dependencies,
  })
  const gap = (reason, extra = {}) => gaps.push({ reason, ...extra })
  const sessionActions = new Map()
  for (const agent of data.agents) {
    const runs = [...agent.rows.map(row => ({ row, startedAt: row.startedAt, id: row.id })),
      ...(agent.containers || []).map(({ record }) => ({ container: record, startedAt: record.startedAt, id: record.id }))]
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || a.id.localeCompare(b.id))
    const actions = runs.flatMap(({ row, container }) => {
      if (container) return [{ kind: 'container', id: `${agent.id}:${container.id}:workflow`, runId: container.id, order: 0 }]
      const local = [
        ...evidence.turns.filter(turn => turn.sessionId === agent.id && turn.runId === row.id)
          .map(turn => ({ kind: 'request', id: turn.id, runId: row.id, order: turn.order })),
        ...evidence.blocks.filter(block => block.sessionId === agent.id && block.runId === row.id)
          .map(block => ({ kind: 'block', id: block.id, runId: row.id, order: block.kind === 'tool_result' ? block.lastOrder : block.order })),
      ]
      return local.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    })
    sessionActions.set(agent.id, actions)
  }

  // Calibration is always per original session/model/region, before any removal.
  const calibration = []
  for (const agent of data.agents) {
    let history = []
    let region = 0
    let model = null
    let thread = null
    let uncertain = Boolean(agent.session.fork)
    const samples = new Map()
    for (const action of sessionActions.get(agent.id)) {
      if (action.kind === 'container') continue
      if (action.kind === 'block') {
        const block = blocks.get(action.id)
        if (block.kind === 'boundary') {
          region += 1
          uncertain = true
          if (block.boundary === 'reset') history = []
          continue
        }
        if (block.fallback || block.visibility === 'provider-dependent' || block.images?.length) uncertain = true
        if (block.kind === 'prompt') {
          const entry = agent.events.find(item => item.event.captureId && item.event.captureId === block.captureId)
          const nextThread = entry?.event.providerAgentId
          if (thread && nextThread && thread !== nextThread) {
            history = []
            region += 1
            uncertain = true
          }
          if (nextThread) thread = nextThread
        }
        history.push(block)
        continue
      }
      const turn = turns.get(action.id)
      if (model && model !== turn.model) {
        region += 1
        uncertain = true
      }
      model = turn.model
      const request = tokenizer.request(history, model)
      const generated = tokenizer.output(turn.blocks.map(id => blocks.get(id)), model)
      const input = turn.measuredUsage?.inputTokens
      const eligible = turn.usageReconciled && turn.confidence === 'measured' && known(input) && request.tokens !== null
      const key = `${agent.id}:${model}:${region}`
      if (!samples.has(key)) samples.set(key, { sessionId: agent.id, model, region, samples: [] })
      samples.get(key).samples.push({ turnId: turn.id, sources: turn.sources, measuredInput: input ?? null,
        reconstructedInput: request.tokens, requestFingerprint: request.fingerprint,
        measuredOutput: turn.measuredUsage?.outputTokens ?? null, generatedOutput: generated.tokens,
        outputResidual: known(turn.measuredUsage?.outputTokens) && generated.tokens !== null
          ? turn.measuredUsage.outputTokens - generated.tokens : null,
        residual: eligible ? input - request.tokens : null, eligible,
        reliableRegion: eligible && !uncertain,
        reason: eligible ? 'Per-response input only. Signed residual remains uncertainty.'
          : 'Missing reconciled input or trustworthy response boundary, excluded from calibration.' })
    }
    for (const group of samples.values()) {
      const residuals = group.samples.filter(sample => sample.reliableRegion).map(sample => sample.residual)
      calibration.push({ ...group, residualEnvelope: residuals.length ? Math.max(...residuals.map(Math.abs)) : null,
        interpretation: 'Observed residual envelope is a sensitivity range, not a statistical guarantee or removable overhead.' })
    }
  }

  const insertions = new Map()
  const linked = new Set()
  const links = (data.links || []).filter(link => agents.has(link.sessionId) && link.sessionId !== root?.id)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.sessionId.localeCompare(b.sessionId))
  for (const child of data.agents.filter(agent => agent.depth > 0)) {
    const candidates = links.filter(link => link.sessionId === child.id)
    let selected = null
    for (const link of candidates) {
      const calls = evidence.blocks.filter(block => block.sessionId === link.parentSessionId
        && (!link.parentRunId || block.runId === link.parentRunId) && delegation(block) === 'spawn')
      const direct = calls.filter(call => unpack(blocks.get(call.resultId)?.content)?.sessionId === child.id)
      const taskMatches = calls.filter(call => link.task && parsed(call.content)?.task === link.task
        && (!link.createdAt || call.ts <= link.createdAt))
        .sort((a, b) => b.order - a.order || a.id.localeCompare(b.id))
      const matches = direct.length ? direct : taskMatches
      if (matches.length) {
        selected = { link, call: matches[0], inferred: direct.length !== 1 }
        break
      }
    }
    if (!selected) {
      const link = candidates[0] || { parentSessionId: child.session.parentSessionId, parentRunId: child.session.parentRunId }
      const parentActions = sessionActions.get(link.parentSessionId) || []
      const anchor = [...parentActions].reverse().find(action => action.runId === link.parentRunId)
      if (anchor) selected = { link, anchor, inferred: !link.workflow }
    }
    if (!selected) {
      gap('Child has no recoverable parent spawn anchor, its work remains an unplaced region.', { sessionId: child.id })
      continue
    }
    const anchorId = selected.call?.id || selected.anchor.id
    if (!insertions.has(anchorId)) insertions.set(anchorId, [])
    insertions.get(anchorId).push({ sessionId: child.id, parentSessionId: selected.link.parentSessionId,
      parentRunId: selected.link.parentRunId, anchorId, inferred: Boolean(selected.inferred),
      createdAt: selected.link.createdAt || child.session.createdAt || 0,
      sources: [selected.link.source, ...(selected.call?.sources || [])].filter(Boolean) })
    linked.add(child.id)
    if (selected.inferred) gap('Spawn position is inferred from task text or the linked parent run boundary.', { sessionId: child.id })
  }
  for (const children of insertions.values()) children.sort((a, b) => a.createdAt - b.createdAt || a.sessionId.localeCompare(b.sessionId))

  const ordered = []
  const visited = new Set()
  const active = new Set()
  const append = (id, parentModel = null, ancestry = []) => {
    if (active.has(id)) {
      gap('Delegation cycle prevents a dependency-safe insertion.', { sessionId: id })
      return
    }
    if (visited.has(id)) return
    active.add(id)
    visited.add(id)
    let model = parentModel
    for (const action of sessionActions.get(id) || []) {
      if (action.kind === 'request' && id === root?.id) model = turns.get(action.id).model
      const row = rows.get(`${id}:${action.runId}`)
      const targetModel = parentModel || model || row?.model || 'unknown'
      ordered.push({ ...action, sessionId: id, targetModel, ancestry })
      for (const child of insertions.get(action.id) || []) append(child.sessionId, targetModel, [...ancestry, action.id])
    }
    active.delete(id)
  }
  if (root) append(root.id)
  const unplaced = data.agents.filter(agent => !visited.has(agent.id)).map(agent => agent.id)
  const position = new Map(ordered.map((action, index) => [action.id, index]))
  const finalBlocks = new Map(data.agents.map(agent => [agent.id,
    evidence.blocks.filter(block => block.sessionId === agent.id && block.kind === 'text')]))
  const taskBlocks = new Map(data.agents.map(agent => [agent.id,
    evidence.blocks.filter(block => block.sessionId === agent.id && block.kind === 'prompt')]))
  const replacement = (result, at) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null
    const childId = result.sessionId
    if (!linked.has(childId) || !visited.has(childId)) return null
    if (result.error || (result.state && result.state !== 'completed')) return null
    const permitted = new Set(['sessionId', 'runId', 'latestRunId', 'parentSessionId', 'parentRunId', 'resultId', 'task',
      'depth', 'lineage', 'usage', 'normalizedUsage', 'durationMs', 'done', 'state', 'status', 'finalResponse',
      'name', 'provider', 'model', 'mode', 'createdAt', 'startedAt', 'endedAt', 'dontReturn', 'childKind',
      'delivery', 'questions', 'pendingQuestions', 'error', 'collectedAt'])
    if (Object.keys(result).some(key => !permitted.has(key))) return null
    if ((result.questions?.length || result.pendingQuestions?.length)) return null
    const dependencies = []
    if (result.task) {
      const task = taskBlocks.get(childId)?.find(block => content(block).trim() === result.task.trim() && position.get(block.id) < at)
      if (!task) return null
      dependencies.push(task.id)
    }
    if (result.finalResponse) {
      const final = finalBlocks.get(childId)?.find(block => content(block) === result.finalResponse && position.get(block.id) < at)
      if (!final) return null
      dependencies.push(final.id)
    }
    return dependencies
  }
  for (const action of ordered) {
    if (action.kind !== 'block') continue
    const block = blocks.get(action.id)
    if (block.kind !== 'tool_call' || !delegation(block)) continue
    const method = delegation(block)
    const result = blocks.get(block.resultId)
    const input = parsed(block.content)
    const children = insertions.get(block.id) || []
    if (method === 'spawn') {
      const child = children.length === 1 ? children[0] : null
      const task = child && taskBlocks.get(child.sessionId)?.find(item => input?.task && content(item).trim() === input.task.trim())
      if (!task || child.inferred || !visited.has(child.sessionId) || result?.error) continue
      // Removal substitutes the explicit child task at this spawn point.
      if (result && replacement(unpack(result.content), position.get(result.id)) === null) continue
      remove(block, 'Delegation spawn is replaced by child work and its intact task.', [task.id])
      if (result) remove(result, 'Delegation receipt is replaced by inserted child work.', [task.id])
    } else if (result && !result.error) {
      const dependencies = replacement(unpack(result.content), position.get(result.id))
      if (dependencies === null) continue
      remove(block, 'Delegation control call has no retained content beyond its replaced receipt.', dependencies)
      remove(result, 'Known delegation wrapper, findings and task are already present verbatim.', dependencies)
    }
  }
  // Remove automatic continuation instructions only when the entire results section is replaceable.
  for (const row of rows.values()) {
    if (!row.record?.delegationDelivery) continue
    const prompts = evidence.blocks.filter(block => block.sessionId === row.sessionId && block.runId === row.id && block.kind === 'prompt')
    const results = prompts.filter(block => block.label === 'Delegated child results')
    if (!results.length) continue
    const substitutions = results.map(block => {
      const values = parsed(block.content)
      if (!Array.isArray(values) || !values.length) return null
      const matches = values.map(value => replacement(value, position.get(block.id)))
      return matches.some(match => match === null) ? null : matches.flat()
    })
    if (substitutions.some(value => value === null)) continue
    const dependencies = substitutions.flat()
    for (const block of prompts) {
      if (['Delegated child results', 'Automatic continuation instructions'].includes(block.label)) {
        remove(block, 'Recorded automatic handoff wrapper, all results already retained verbatim.', dependencies)
      }
    }
  }

  let previousRead = null
  let priorRun = null
  for (const action of ordered) {
    if (action.kind !== 'block') continue
    const block = blocks.get(action.id)
    const key = `${block.sessionId}:${block.runId}`
    if (key !== priorRun) previousRead = null
    priorRun = key
    if (['prompt', 'boundary'].includes(block.kind) || (['text', 'thinking'].includes(block.kind) && content(block).trim())) previousRead = null
    if (block.kind !== 'tool_call' || dispositions.get(block.id).action === 'remove') continue
    const input = parsed(block.content)
    const file = input?.path || input?.file_path || input?.file
    const result = blocks.get(block.resultId)
    const instruction = typeof file === 'string' && /(?:^|\/)(?:AGENTS\.md|SKILL\.md|[^/]*instructions?[^/]*)$/i.test(file)
    const eligible = pureRead(block) && file && !instruction && !input.refresh && !input.force && !input.no_cache
      && result && !result.error && [undefined, null, 0].includes(result.exitCode)
    if (!eligible) {
      previousRead = null
      continue
    }
    if (previousRead && previousRead.call.fingerprint === block.fingerprint
      && previousRead.result.fingerprint === result.fingerprint
      && position.get(previousRead.result.id) < position.get(block.id)) {
      remove(block, 'Exact repeated read and result, same run, no intervening tool or prompt can edit or request a refresh.', [previousRead.result.id])
      remove(result, 'Byte-identical read result remains in retained history.', [previousRead.result.id])
    } else previousRead = { call: block, result }
  }
  for (const turn of evidence.turns) {
    const generated = turn.blocks.map(id => blocks.get(id)).filter(block => block.generated)
    if (turn.confidence !== 'measured' || !generated.length) continue
    const retained = generated.filter(block => dispositions.get(block.id).action !== 'remove')
    const laterCoordinatorWork = ordered.some(action => action.kind === 'request' && action.sessionId === root?.id
      && position.get(action.id) > position.get(turn.id))
    if (!retained.length && laterCoordinatorWork && generated.every(block => dispositions.get(block.id).action === 'remove')) {
      turnDispositions.set(turn.id, { turnId: turn.id, action: 'remove',
        reason: 'All generated content is proven delegation/read overhead, remaining work still has a response turn.',
        sources: turn.sources, dependencies: generated.flatMap(block => dispositions.get(block.id).dependencies) })
    }
  }

  // Replay one growing coordinator history. Output text is added only when its block occurs.
  const retainedHistory = []
  const visible = new Set()
  const estimates = []
  let regionUnsupported = false
  let activeModel = null
  let currentRootThread = null
  for (const action of ordered) {
    if (action.kind === 'container') continue
    if (action.kind === 'block') {
      const block = blocks.get(action.id)
      if (dispositions.get(block.id).action === 'remove') continue
      if (block.kind === 'boundary') {
        regionUnsupported = true
        if (block.boundary === 'reset' && action.sessionId === root?.id) {
          retainedHistory.length = 0
          visible.clear()
        }
        continue
      }
      if (block.kind === 'prompt' && action.sessionId === root?.id) {
        const entry = root.events.find(item => item.event.captureId && item.event.captureId === block.captureId)
        const thread = entry?.event.providerAgentId
        if (currentRootThread && thread && currentRootThread !== thread) {
          retainedHistory.length = 0
          visible.clear()
          regionUnsupported = true
          gap('Coordinator thread changed, retained replay history resets with an unknown provider prefix.', { blockId: block.id })
        }
        if (thread) currentRootThread = thread
      }
      const missing = block.dependencies.filter(id => !visible.has(id) && dispositions.get(id)?.action !== 'remove')
      if (missing.length) {
        regionUnsupported = true
        gap('A block dependency is not yet available at its insertion point.', { blockId: block.id, dependencies: missing })
      }
      if (block.visibility === 'provider-dependent' || block.fallback || block.images?.length) regionUnsupported = true
      retainedHistory.push(block)
      visible.add(block.id)
      continue
    }
    const turn = turns.get(action.id)
    if (turnDispositions.get(turn.id).action === 'remove') continue
    if (turn.confidence !== 'measured') regionUnsupported = true
    if (activeModel && activeModel !== action.targetModel) regionUnsupported = true
    activeModel = action.targetModel
    const request = tokenizer.request(retainedHistory, action.targetModel)
    const generated = turn.blocks.map(id => blocks.get(id)).filter(block => dispositions.get(block.id).action !== 'remove')
    const output = tokenizer.output(generated, action.targetModel)
    const groups = calibration.filter(group => group.sessionId === root?.id && group.model === action.targetModel && group.residualEnvelope !== null)
    const envelope = groups.length ? Math.max(...groups.map(group => group.residualEnvelope)) : null
    const outputSamples = calibration.flatMap(group => group.samples).filter(sample => sample.turnId === turn.id)
    const hiddenOutput = outputSamples.some(sample => sample.outputResidual !== null && sample.outputResidual !== 0)
    const rootRow = action.sessionId === root?.id ? rows.get(`${root.id}:${turn.runId}`) : null
    const coordinatorLimits = evidence.turns.filter(item => item.sessionId === root?.id && item.model === action.targetModel
      && (rootRow ? item.runId === rootRow.id : position.get(item.id) <= position.get(turn.id)))
      .map(item => item.contextLimit).filter(known)
    const limit = coordinatorLimits.at(-1) ?? null
    if (limit === null) {
      regionUnsupported = true
      gap('Coordinator context limit is unavailable for this replay turn.', { turnId: turn.id })
    }
    const overLimit = limit !== null && request.tokens !== null && request.tokens + (output.tokens || 0) > limit
    if (overLimit) {
      regionUnsupported = true
      gap('Reconstructed request and generated output exceed the recorded coordinator context limit. No synthetic compaction is invented.', { turnId: turn.id, limit })
    }
    const supported = !regionUnsupported && !request.identity.approximation && envelope !== null
      && turn.confidence === 'measured' && !unplaced.length && !data.warnings.length
    estimates.push({ turnId: turn.id, sessionId: turn.sessionId, runId: turn.runId, model: action.targetModel,
      originalModel: turn.model, confidence: turn.confidence, requestFingerprint: request.fingerprint,
      requestBlockIds: retainedHistory.map(block => block.id), generatedBlockIds: generated.map(block => block.id),
      input: range(request.tokens, envelope || 0, supported),
      output: range(output.tokens, 0, supported && !hiddenOutput), contextLimit: limit, contextLimitExceeded: overLimit,
      outputResidual: outputSamples[0]?.outputResidual ?? null,
      residualUncertainty: envelope, supported, sources: turn.sources,
      uncertainty: supported ? 'Sensitivity envelope from original coordinator response-input residuals.'
        : 'Missing boundaries, tokenizer mapping, calibration, context, or source coverage. Upper bound is unknown.' })
  }
  const input = { estimate: sum(estimates.map(item => item.input.estimate)),
    lower: sum(estimates.map(item => item.input.lower)), upper: sum(estimates.map(item => item.input.upper)) }
  const output = { estimate: sum(estimates.map(item => item.output.estimate)),
    lower: sum(estimates.map(item => item.output.lower)), upper: sum(estimates.map(item => item.output.upper)) }
  const total = { estimate: sum([input.estimate, output.estimate]), lower: sum([input.lower, output.lower]), upper: sum([input.upper, output.upper]) }
  const baseline = group => Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'fresh', 'reasoning', 'total', 'requests'].map(field => {
    const values = group.map(row => row[field])
    return [field, { value: sum(values), knownSubtotal: values.reduce((sum, value) => sum + (value || 0), 0),
      coveredRuns: values.filter(known).length, runs: values.length }]
  }))
  const missingUsage = data.warnings.some(reason => /Linked child .*unlocated|Linked run .*missing|Source session .*unlocated|Parent run .*missing|Run metadata missing|Incomplete records|Run index unavailable|Unlocated child spawn/i.test(reason))
  const measured = { coordinator: baseline(data.agents.filter(agent => agent.depth === 0).flatMap(agent => agent.rows)),
    descendants: baseline(data.agents.filter(agent => agent.depth > 0).flatMap(agent => agent.rows)),
    combined: baseline(data.agents.flatMap(agent => agent.rows)) }
  if (missingUsage) {
    for (const group of [measured.descendants, measured.combined]) {
      for (const field of Object.values(group)) field.value = null
    }
  }
  if (gaps.length || unplaced.length || !estimates.length) {
    input.upper = null
    output.upper = null
    total.upper = null
    input.lower = 0
    output.lower = 0
    total.lower = 0
  }
  const measuredTotal = measured.combined.total.value
  const difference = { estimate: total.estimate !== null && measuredTotal !== null ? total.estimate - measuredTotal : null,
    lower: total.lower !== null && measuredTotal !== null ? total.lower - measuredTotal : null,
    upper: total.upper !== null && measuredTotal !== null ? total.upper - measuredTotal : null,
    meaning: 'Estimated whole coordinator replay minus measured coordinator and descendant usage. Positive means more tokens in this scenario.' }
  const ignoredAssumptions = Object.keys(assumptions).map(key => `${key}=${assumptions[key]}`)
  if (ignoredAssumptions.length) gap(`Legacy scalar overrides are recorded but not applied to ordered replay: ${ignoredAssumptions.join(', ')}.`)
  return freeze({ version: 1, cutoff: data.cutoff, sourceSessionId: root?.id || null,
    measured, measuredRuns: data.agents.flatMap(agent => agent.rows.map(row => ({ sessionId: row.sessionId, runId: row.id,
      provider: row.provider, model: row.model, source: row.usageSource, status: row.status,
      usage: Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'fresh', 'reasoning', 'total', 'requests'].map(field => [field, row[field]])) }))),
    estimate: { input, output, total, difference, scope: 'All placed coordinator and recursive descendant work through cutoff.' },
    coverage: { complete: estimates.length > 0 && !gaps.length && estimates.every(item => item.supported && item.output.upper !== null), gaps, unplacedSessions: unplaced,
      cutoff: data.cutoff, measuredUsageComplete: measured.combined.total.value !== null && !data.warnings.length,
      firstUnsupportedTurn: estimates.find(item => !item.supported || item.output.upper === null)?.turnId || null },
    confidenceCounts: Object.fromEntries(['measured', 'inferred', 'allocated'].map(confidence => [confidence,
      evidence.turns.filter(turn => turn.confidence === confidence).length])),
    removed: { blocks: [...dispositions.values()].filter(item => item.action === 'remove').length,
      turns: [...turnDispositions.values()].filter(item => item.action === 'remove').length },
    ordering: { policy: 'Original transcript order, recursively insert each child immediately after its spawn call. Siblings use creation time then session ID. Missing anchors are explicit gaps.',
      insertions: [...insertions.values()].flat(), actions: ordered.map((action, index) => ({ ...action, index })) },
    tokenizer: { identities: tokenizer.identities(), cachedRequestsAndOutputs: tokenizer.cacheSize(),
      cacheKey: 'Content SHA-256 + encoding + tokenizer version + serialization version.' },
    calibration, assumptions: [
      'Retain the same recorded substantive work and final answer, performed sequentially by the coordinator model at each spawn.',
      'CPU tokenization covers assembled JSON message requests, not provider wire envelopes or undisclosed tool schemas.',
      'Original sessions calibrate separately against reconciled per-response input only. Context snapshots containing input plus output are excluded.',
      'Residuals are explicit uncertainty. They are neither removed delegation overhead nor hidden reasoning appended to history.',
      'Output counts generated text, visible thinking text and tool-call arguments. Tool results are input history only. Missing hidden output remains a gap.',
      'Unknown compaction summaries, resets, model transitions, context limits and boundary allocations prevent a precise full-history estimate.',
      'Exact read removal requires identical call and result in the same run without intervening tools, prompts, refresh requests or instruction-file reads.',
      'Allocated turn usage conserves run totals for attribution only. It does not fabricate transcript text or request measurements.',
      'Estimates do not measure quality, time or money and do not imply a categorical delegation verdict.',
      ...(ignoredAssumptions.length ? [`Unapplied legacy assumptions: ${ignoredAssumptions.join(', ')}`] : []),
    ],
    turns: evidence.turns, blocks: evidence.blocks, blockDispositions: [...dispositions.values()],
    turnDispositions: [...turnDispositions.values()], replayTurns: estimates, runAccounting: evidence.runAccounting,
    sourceEvents: data.agents.map(agent => ({ sessionId: agent.id, events: agent.events })),
  })
}

module.exports = { createSubagentReplay }
