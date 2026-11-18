const { createTranscriptEvidence } = require('./transcriptContext')
const { createReplayTokenizer, serialize, fingerprint, freeze } = require('./replayTokenizer')

const known = value => Number.isFinite(value) && value >= 0
const sum = values => values.every(known) ? values.reduce((total, value) => total + value, 0) : null
const content = block => typeof block?.content === 'string' ? block.content : serialize(block?.content)
const parsed = value => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}
const unpack = value => {
  const object = parsed(value)
  if (!object || typeof object !== 'object' || object.isError || object.status === 'error') return object
  if (object.status === 'success' && object.value !== undefined) return unpack(object.value)
  if (object.content?.length === 1) {
    const entry = object.content[0]
    const payload = typeof entry.text === 'object' ? entry.text?.text : entry.text
    if (payload !== undefined) return unpack(payload)
  }
  return object
}
const delegationCall = block => {
  const input = parsed(block.content)
  const direct = /^(?:mcp__harness_agents__|harness_agents[/.])(spawn|status|wait|stop)$/.exec(block.name || '')
  if (direct) return { method: direct[1], input }
  if (block.name === 'mcp' && input?.providerIdentifier === 'harness_agents'
    && /^(?:spawn|status|wait|stop)$/.test(input.toolName)) return { method: input.toolName, input: parsed(input.args) }
  return null
}
const delegation = block => delegationCall(block)?.method || null
const pureRead = block => /^(?:Read|read_file|read_file_text|mcp__filesystem__read_file)$/.test(block.name || '')
const relayText = value => value.replace(/^\s*(?:[-*#>]\s+|\d+[.)]\s+)/gm, '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim()
// Coordination is classified only beside replaced calls or captured deliveries.
// Unmatched task reasoning and novel findings remain, even if they mention agents.
const coordinationWords = new Set(('i we ill well im ive will shall am are is be been have has had do does '
  + 'the a an to for from of on in with and or then now next just only still already all both each their them they '
  + 'my our its it this that these those as once until after before here heres back up can need needs should must '
  + 'one two three first second last another other remaining no more '
  + 'agent agents subagent subagents child children grandchild grandchildren parent coordinator '
  + 'spawn spawning spawned delegate delegating delegated delegation start starting started '
  + 'wait waiting await awaiting pending running finish finished done complete completed '
  + 'result results response responses output outputs finding findings receipt receipts summary summaries '
  + 'receive received collect collected return returning returned relay relaying relayed '
  + 'send sending sent pass passing forward forwarding report reported reporting hand handoff deliver delivered '
  + 'summarize summarizing combine combined consolidated acknowledge acknowledged '
  + 'task tasks work status check checking stop stopping stopped ready succeeded finishes resume resumes automatically me user wants wanted asked instructions forbid polling sleeping completion end turn using original was simply continue' ).split(' '))
const coordinationText = value => {
  if (/^(?:the )?(?:user (?:wants|asked) me to |original task was (?:simply )?to )?(?:spawn (?:a )?subagent|continue the parent task using (?:the )?child results)(?: and return its result)?[.!]?$/i.test(value)) return true
  if (/^(?:the )?(?:instructions forbid polling, sleeping, or waiting for subagent completion|subagent will resume me automatically when it finishes)[.!]?$/i.test(value)) return true
  if (/^The user asked me to spawn a subagent and this is a ["']get["']\s*-\s*meaning I should get the result back[.!]?$/i.test(value)) return true
  if (/[^a-z\s.,!?:'’\-]/i.test(value)) return false
  const words = value.toLowerCase().replace(/['’]/g, '').match(/[a-z]+/g) || []
  return words.length > 0 && words.every(word => coordinationWords.has(word))

}
const factText = value => relayText(value).toLowerCase()
  .replace(/^(?:the |it is |i am |i'm )/, '').replace(/[.!?]+$/, '').trim()
const relaySource = (clause, findings) => {
  const excerpt = clause.replace(/^(?:(?:child|grandchild|agent|subagent)(?:\s+[\w-]+)?\s*(?::|reported:|returned:|found:))\s*/i, '')
  const normalized = factText(excerpt)
  if (!normalized) return null
  return findings.find(item => {
    const sentences = content(item).split(/\n+|(?<=[.!?])\s+/).map(factText)
    return sentences.some(sentence => sentence === normalized
      || (normalized.length >= 24 && normalized.split(/\s+/).length >= 4 && ` ${sentence} `.includes(` ${normalized} `)))
  })
}
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
    reason: 'Preserve original work unless every generated block has an explicit removal disposition.', sources: turn.sources }]))
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
          .map(block => ({ kind: 'block', id: block.id, runId: row.id, sectionIndex: block.sectionIndex,
            order: block.kind === 'tool_result' ? block.lastOrder : block.order })),
      ]
      return local.sort((a, b) => a.order - b.order || (a.sectionIndex ?? 0) - (b.sectionIndex ?? 0) || a.id.localeCompare(b.id))
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
    if (!candidates.length && child.session.parentSessionId) candidates.push({ sessionId: child.id,
      parentSessionId: child.session.parentSessionId, parentRunId: child.session.parentRunId })
    for (const call of evidence.blocks.filter(block => block.kind === 'tool_call' && delegation(block) === 'spawn'
      && unpack(blocks.get(block.resultId)?.content)?.sessionId === child.id)) {
      if (!candidates.some(link => link.parentSessionId === call.sessionId && link.parentRunId === call.runId)) {
        candidates.push({ sessionId: child.id, parentSessionId: call.sessionId, parentRunId: call.runId, source: call.sources[0] })
      }
    }
    let selected = null
    for (const link of candidates) {
      const calls = evidence.blocks.filter(block => block.sessionId === link.parentSessionId
        && (!link.parentRunId || block.runId === link.parentRunId) && delegation(block) === 'spawn')
      const direct = calls.filter(call => unpack(blocks.get(call.resultId)?.content)?.sessionId === child.id)
      const taskMatches = calls.filter(call => link.task && delegationCall(call)?.input?.task === link.task
        && (!link.createdAt || call.ts <= link.createdAt))
        .sort((a, b) => b.order - a.order || a.id.localeCompare(b.id))
      const matches = direct.length ? direct : taskMatches
      if (matches.length) {
        selected = { link, call: matches[0], inferred: direct.length !== 1,
          proven: direct.length === 1 || (!direct.length && taskMatches.length === 1 && Boolean(link.source && link.parentRunId)) }
        break
      }
    }
    if (!selected) {
      const link = candidates[0] || { parentSessionId: child.session.parentSessionId, parentRunId: child.session.parentRunId }
      const parentActions = sessionActions.get(link.parentSessionId) || []
      const anchor = link.workflow && parentActions.find(action => action.kind === 'container' && action.runId === link.parentRunId)
      if (anchor) selected = { link, anchor, inferred: false, proven: true }
    }
    if (!selected) {
      gap('Child has no recoverable parent spawn anchor, its work remains an unplaced region.', { sessionId: child.id })
      continue
    }
    const anchorId = selected.call?.id || selected.anchor.id
    if (!insertions.has(anchorId)) insertions.set(anchorId, [])
    insertions.get(anchorId).push({ sessionId: child.id, parentSessionId: selected.link.parentSessionId,
      parentRunId: selected.link.parentRunId, anchorId, inferred: Boolean(selected.inferred),
      proven: Boolean(selected.proven),
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
  const completeChild = id => {
    const child = agents.get(id)
    return child?.rows.length > 0 && child.rows.every(row => row.endedAt && !row.record?.error
      && row.status === 'completed' && row.record?.transcriptStatus !== 'incomplete'
      && evidence.blocks.some(block => block.sessionId === id && block.runId === row.id && block.generated))
  }
  const replacement = (result, at, method = null) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null
    const childId = result.sessionId
    if (!linked.has(childId) || !visited.has(childId) || !Number.isFinite(at)) return null
    if (result.error || !completeChild(childId)) return null
    const activeReceipt = ['spawn', 'status', 'wait'].includes(method)
      && ['starting', 'running', 'subagent'].includes(result.state)
    if (result.state && result.state !== 'completed' && !activeReceipt) return null
    const permitted = new Set(['sessionId', 'runId', 'latestRunId', 'parentSessionId', 'parentRunId', 'resultId', 'task',
      'depth', 'lineage', 'usage', 'normalizedUsage', 'durationMs', 'done', 'state', 'status', 'finalResponse',
      'name', 'provider', 'model', 'mode', 'createdAt', 'startedAt', 'endedAt', 'dontReturn', 'childKind',
      'delivery', 'questions', 'pendingQuestions', 'error', 'collectedAt', 'workflow', 'workspaceId',
      'transcriptLink', 'nativeSpawningBlocked', 'warning'])
    if (Object.keys(result).some(key => !permitted.has(key))) return null
    if (result.warning != null && result.warning !== 'Native spawning cannot be fully blocked by Grok; the child is instructed to use only harness delegation.') return null
    if (['questions', 'pendingQuestions'].some(key => result[key] != null
      && (!Array.isArray(result[key]) || result[key].length))) return null
    const dependencies = []
    if (result.task) {
      if (typeof result.task !== 'string') return null
      const task = taskBlocks.get(childId)?.find(block => content(block).trim() === result.task.trim() && position.get(block.id) < at)
      if (!task) return null
      dependencies.push(task.id)
    }
    if (result.finalResponse) {
      if (typeof result.finalResponse !== 'string') return null
      const final = finalBlocks.get(childId)?.find(block => content(block) === result.finalResponse && position.get(block.id) < at)
      if (!final) return null
      dependencies.push(final.id)
    }
    if (activeReceipt) {
      const task = taskBlocks.get(childId)?.find(block => position.get(block.id) < at)
      if (!task) return null
      dependencies.push(task.id)
      dependencies.push(...(finalBlocks.get(childId) || []).filter(block => position.get(block.id) < at).map(block => block.id))
    }
    return dependencies
  }
  for (const action of ordered) {
    if (action.kind !== 'block') continue
    const block = blocks.get(action.id)
    if (block.kind !== 'tool_call' || !delegation(block)) continue
    const method = delegation(block)
    const result = blocks.get(block.resultId)
    const input = delegationCall(block)?.input
    const children = insertions.get(block.id) || []
    if (method === 'spawn') {
      const child = children.length === 1 ? children[0] : null
      const task = child && taskBlocks.get(child.sessionId)?.find(item => input?.task && content(item).trim() === input.task.trim())
      if (!task || task.fallback || !child.proven || !visited.has(child.sessionId) || !completeChild(child.sessionId) || !result || result.error) continue
      // Removal substitutes the explicit child task at this spawn point.
      const dependencies = result ? replacement(unpack(result.content), position.get(result.id), method) : []
      if (dependencies === null) continue
      remove(block, 'Delegation spawn is replaced by child work and its intact task.', [task.id])
      if (result) remove(result, 'Delegation receipt is replaced by inserted child work.', [...new Set([task.id, ...dependencies])])
    } else if (result && !result.error) {
      const dependencies = replacement(unpack(result.content), position.get(result.id), method)
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

  // Exact duplicates can be removed even in mixed turns, without losing their tools.
  for (const turn of evidence.turns) {
    const generated = turn.blocks.map(id => blocks.get(id)).filter(block => block.generated)
    const calls = generated.filter(block => delegation(block) && dispositions.get(block.id).action === 'remove')
    const prompts = evidence.blocks.filter(block => block.sessionId === turn.sessionId && block.runId === turn.runId
      && block.label === 'Delegated child results' && dispositions.get(block.id).action === 'remove')
    const dependencies = [...new Set([...calls, ...prompts].flatMap(block => [
      ...dispositions.get(block.id).dependencies,
      ...(block.resultId ? dispositions.get(block.resultId)?.dependencies || [] : []),
    ]))]
    if (!calls.length && !prompts.length) continue
    for (const block of generated) {
      if (block.kind !== 'text' || block.fallback) continue
      const duplicate = dependencies.find(id => {
        const original = blocks.get(id)
        return original && position.get(id) < position.get(block.id)
          && dispositions.get(id).action === 'retain' && content(original) === content(block)
      })
      if (duplicate) remove(block, 'Exact handoff text is already retained in inserted child work.', [duplicate])
    }
  }

  const overheadTurns = []
  const firstRunTurns = new Map()
  for (const action of ordered) {
    if (action.kind !== 'request') continue
    const turn = turns.get(action.id)
    const key = `${turn.sessionId}:${turn.runId}`
    if (!firstRunTurns.has(key) && turn.blocks.length) firstRunTurns.set(key, turn.id)
  }
  // Inspect complete generated responses, including thinking. A first child
  // response is real work and receives no automatic startup discount.
  const previousTurns = new Map()
  for (const action of ordered) {
    if (action.kind !== 'request') continue
    const turn = turns.get(action.id)
    const previousTurn = previousTurns.get(turn.sessionId)
    previousTurns.set(turn.sessionId, turn)
    const row = rows.get(`${turn.sessionId}:${turn.runId}`)
    const generated = turn.blocks.map(id => blocks.get(id)).filter(block => block.generated)
    if (!generated.length
      || !row?.endedAt || row.status !== 'completed' || row.record?.error
      || row.record?.transcriptStatus === 'incomplete' || generated.some(block => block.fallback)) continue
    const calls = generated.filter(block => block.kind === 'tool_call')
    if (calls.some(block => !delegation(block) || dispositions.get(block.id).action !== 'remove')) continue
    const prompts = firstRunTurns.get(`${turn.sessionId}:${turn.runId}`) === turn.id && row.record?.delegationDelivery
      ? (taskBlocks.get(turn.sessionId) || []).filter(block => block.runId === turn.runId && block.label === 'Delegated child results') : []
    if (prompts.some(block => dispositions.get(block.id).action !== 'remove')) continue
    const priorCalls = !calls.length && previousTurn?.runId === turn.runId
      ? previousTurn.blocks.map(id => blocks.get(id)).filter(block => block.kind === 'tool_call') : []
    const receipts = priorCalls.length && priorCalls.every(block => delegation(block)
      && dispositions.get(block.id).action === 'remove' && block.resultId
      && dispositions.get(block.resultId)?.action === 'remove'
      && position.get(block.resultId) < position.get(turn.id)) ? priorCalls : []
    const anchors = [...calls, ...prompts, ...receipts]
    if (!anchors.length) continue
    const dependencies = [...new Set(anchors.flatMap(block => [
      ...dispositions.get(block.id).dependencies,
      ...(block.resultId ? dispositions.get(block.resultId)?.dependencies || [] : []),
    ]))]
    if (!dependencies.length) continue
    const findings = dependencies.map(id => blocks.get(id)).filter(block => block?.kind === 'text'
      && !block.fallback && position.get(block.id) < position.get(turn.id))
    const matches = []
    let removable = true
    for (const block of generated) {
      if (dispositions.get(block.id).action === 'remove') continue
      if (!['text', 'thinking'].includes(block.kind)) {
        removable = false
        break
      }
      const clauses = content(block).split(/\n+|(?<=[.!?])\s+/).map(relayText).filter(Boolean)
      const used = []
      for (const clause of clauses) {
        if (coordinationText(clause)) continue
        // Allow formatting/attribution changes and excerpts, but no novel summary
        // claims. In particular, token overlap alone cannot prove synthesis redundant.
        const receiptSummary = /^(?:the )?child confirmed it is running and reported the workspace (?:root )?path[.!]?$/i.test(clause)
          ? findings.find(item => /(?:^|\s)running[.!]/i.test(content(item)) && /workspace (?:root )?(?:path )?is\s+`?\//i.test(content(item))) : null
        const original = relaySource(clause, findings) || receiptSummary
        if (!original) {
          removable = false
          break
        }
        used.push(original.id)
      }
      if (!removable) break
      matches.push({ block, dependencies: used.length ? [...new Set(used)] : dependencies })
    }
    if (!removable || !matches.length) continue
    for (const match of matches) remove(match.block,
      'Estimated delegation-only response: coordination language or attributed excerpts of inserted findings, with no other tool work.', match.dependencies)
    overheadTurns.push({ turnId: turn.id, sessionId: turn.sessionId, runId: turn.runId,
      evidenceBlockIds: anchors.map(block => block.id),
      assumption: 'Coordination-only thinking/prose and excerpt-only relay output are unnecessary in sequential replay. Unmatched synthesis is retained.' })
  }

  for (const turn of evidence.turns) {
    const generated = turn.blocks.map(id => blocks.get(id)).filter(block => block.generated)
    const anchors = generated.filter(block => delegation(block) && dispositions.get(block.id).action === 'remove')
    const dependencies = [...new Set(anchors.flatMap(block => dispositions.get(block.id).dependencies))]
    if (!dependencies.length) continue
    for (const block of generated) {
      if (!['text', 'thinking'].includes(block.kind) || block.fallback || dispositions.get(block.id).action === 'remove') continue
      const clauses = content(block).split(/\n+|(?<=[.!?])\s+/).map(relayText).filter(Boolean)
      if (clauses.length && clauses.every(coordinationText)) remove(block,
        'Coordination-only block attached to a replaced delegation call. Other work in this response is retained.', dependencies)
    }
  }

  // Captured source roles identify instruction sections. User tasks remain intact.
  const systemPrompts = new Map()
  for (const action of ordered) {
    if (action.kind !== 'block') continue
    const block = blocks.get(action.id)
    if (block.kind !== 'prompt' || block.role !== 'system' || block.fallback
      || block.images?.length || dispositions.get(block.id).action === 'remove') continue
    if (block.label === 'Delegation instructions' && linked.size) {
      remove(block, 'Captured delegation policy is unnecessary in the single coordinator scenario.')
      continue
    }
    const key = serialize([block.role, content(block).trim()])
    const previous = systemPrompts.get(key)
    if (previous) remove(block, 'Repeated captured system section is already retained once in the coordinator history.', [previous.id])
    else systemPrompts.set(key, block)
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
  // Rebase every removal proof through deleted relay text and prompt duplicates.
  // If a chain is cyclic, missing or moves an earlier substitute past its consumer,
  // keep that consumer instead. Spawn-to-task dependencies intentionally point ahead.
  const retainedDependencies = (id, active = new Set()) => {
    if (!blocks.has(id) || !position.has(id) || active.has(id)) return null
    const disposition = dispositions.get(id)
    if (disposition.action !== 'remove') return [id]
    const next = new Set([...active, id])
    const replacements = disposition.dependencies.map(dependency => retainedDependencies(dependency, next))
    return replacements.some(value => value === null) ? null : [...new Set(replacements.flat())]
  }
  let restored = true
  while (restored) {
    restored = false
    for (const disposition of dispositions.values()) {
      if (disposition.action !== 'remove') continue
      const invalid = disposition.dependencies.some(id => {
        const replacements = retainedDependencies(id, new Set([disposition.blockId]))
        return replacements === null || (position.get(id) < position.get(disposition.blockId)
          && replacements.some(dependency => position.get(dependency) >= position.get(disposition.blockId)))
      })
      if (!invalid) continue
      const block = blocks.get(disposition.blockId)
      dispositions.set(block.id, { blockId: block.id, action: 'retain',
        reason: 'Retained because the proposed removal no longer has an available dependency-safe substitute.',
        sources: block.sources, dependencies: [...block.dependencies] })
      restored = true
    }
  }
  for (const disposition of dispositions.values()) {
    if (disposition.action !== 'remove') continue
    const dependencies = [...new Set(disposition.dependencies.flatMap(id => retainedDependencies(id)))]
    const rebased = serialize(dependencies) !== serialize(disposition.dependencies)
    dispositions.set(disposition.blockId, { ...disposition, dependencies,
      ...(rebased ? { originalDependencies: disposition.dependencies,
        reason: `${disposition.reason} Substitutes are expanded through removed wrappers or estimated relay output to retained evidence.` } : {}) })
  }
  const estimatedOverhead = new Set(overheadTurns.map(turn => turn.turnId))
  for (const turn of evidence.turns) {
    const generated = turn.blocks.map(id => blocks.get(id)).filter(block => block.generated)
    if (!generated.length) continue
    const retained = generated.filter(block => dispositions.get(block.id).action !== 'remove')
    if (!retained.length && generated.every(block => dispositions.get(block.id).action === 'remove')) {
      turnDispositions.set(turn.id, { turnId: turn.id, action: 'remove',
        reason: estimatedOverhead.has(turn.id)
          ? 'All generated blocks are removed under the explicit delegation-only response estimate. Boundary confidence remains separate evidence.'
          : 'All recorded generated content has an explicit delegation/read removal substitute. Boundary confidence remains separate evidence.',
        sources: turn.sources, dependencies: generated.flatMap(block => dispositions.get(block.id).dependencies) })
    }
  }

  const removedOverheadTurns = overheadTurns.filter(turn => turnDispositions.get(turn.turnId).action === 'remove')
  if (overheadTurns.length) gap('Delegation-only language and relay excerpts are classified heuristically, not proven semantically equivalent.',
    { turnIds: overheadTurns.map(turn => turn.turnId) })
  gap('Captured prompts do not establish complete provider prefixes, tool schemas or provider message framing. Tokenized visible context is a point estimate with an unknown upper bound.')
  if (evidence.blocks.some(block => block.visibility === 'provider-dependent')) {
    gap('Provider-dependent reasoning is excluded from visible replay input and output. Its cost and retention in a hypothetical coordinator execution are unknown.')
  }
  const entryAccounting = []
  const estimates = []
  const retainedHistory = []
  const visible = new Set()
  const charged = new Set()
  const requested = new Set()
  const retainedOutputs = []
  for (const action of ordered) {
    if (action.kind === 'container') continue
    if (action.kind === 'block') {
      const block = blocks.get(action.id)
      if (dispositions.get(block.id).action === 'remove' || visible.has(block.id)) continue
      if (block.kind === 'boundary') {
        gap('Original context boundaries do not specify the single coordinator context. Retained visible history is carried forward without inventing compaction or replacement text.',
          { blockId: block.id, boundary: block.boundary })
        continue
      }
      if (block.visibility === 'provider-dependent' || block.kind === 'thinking') continue
      if (block.generated && !requested.has(block.turnId)) {
        gap('Generated content has no surviving preceding request at its insertion point.', { blockId: block.id })
        continue
      }
      const missing = block.dependencies.filter(id => !visible.has(id) && dispositions.get(id)?.action !== 'remove')
      if (missing.length) gap('A block dependency is not yet available at its insertion point.', { blockId: block.id, dependencies: missing })
      retainedHistory.push(block)
      visible.add(block.id)
      if (block.generated) retainedOutputs.push({ turnId: block.turnId, blockId: block.id,
        tokens: tokenizer.output([block], action.targetModel).tokens, synthetic: false })
      continue
    }
    const turn = turns.get(action.id)
    if (turnDispositions.get(turn.id).action === 'remove') continue
    requested.add(turn.id)
    const generated = turn.blocks.map(id => blocks.get(id)).filter(block => block.generated
      && block.visibility !== 'provider-dependent' && block.kind !== 'thinking'
      && dispositions.get(block.id).action !== 'remove' && !charged.has(block.id))
    generated.forEach(block => charged.add(block.id))
    const request = tokenizer.request(retainedHistory, action.targetModel)
    const response = tokenizer.output(generated, action.targetModel)
    if (!turn.blocks.length) gap('Recorded request has no captured generated content. No output or response text is fabricated.', { turnId: turn.id })
    if (request.identity.approximation) gap('Coordinator model uses a proxy tokenizer, so token counts are approximate.', { turnId: turn.id, model: action.targetModel })
    if (request.identity.unavailable) gap(request.identity.unavailable, { turnId: turn.id })
    const limits = evidence.turns.filter(item => item.sessionId === root?.id && item.model === action.targetModel
      && position.get(item.id) <= position.get(turn.id)).map(item => item.contextLimit).filter(known)
    const contextLimit = limits.at(-1) ?? null
    const contextLimitExceeded = contextLimit === null || request.tokens === null || response.tokens === null
      ? null : request.tokens + response.tokens > contextLimit
    if (contextLimit === null) gap('Coordinator context limit is unavailable for this replay turn.', { turnId: turn.id })
    if (contextLimitExceeded) gap('Rebuilt visible context and output exceed the recorded coordinator context limit. No synthetic compaction is invented.',
      { turnId: turn.id, limit: contextLimit })
    const outputContributions = generated.map(block => ({ turnId: turn.id, blockId: block.id,
      tokens: tokenizer.output([block], action.targetModel).tokens, synthetic: false }))
    const entry = { turnId: turn.id, sessionId: turn.sessionId, runId: turn.runId, confidence: turn.confidence,
      disposition: 'retain', sources: turn.sources,
      attributedOriginalInput: turn.measuredUsage?.inputTokens ?? null,
      attributedOriginalOutput: turn.measuredUsage?.outputTokens ?? null,
      retainedEntryInput: request.tokens, retainedOutput: response.tokens, outputContributions,
      basis: 'Tokenized retained visible context and generated output. Original usage is audit evidence only.' }
    entryAccounting.push(entry)
    estimates.push({ turnId: turn.id, sessionId: turn.sessionId, runId: turn.runId, model: action.targetModel,
      originalModel: turn.model, confidence: turn.confidence, sources: turn.sources,
      requestFingerprint: request.fingerprint, requestEntryIds: [...requested],
      requestOutputContributions: [...retainedOutputs], requestBlockIds: retainedHistory.map(block => block.id),
      generatedBlockIds: generated.map(block => block.id),
      inputAdjustment: { attributedOriginalInput: entry.attributedOriginalInput, cumulativeRequestInput: request.tokens,
        basis: 'Each unique retained message/tool enters history at its recorded position. The whole history is tokenized once for this request.' },
      outputAdjustment: { attributedOriginalOutput: entry.attributedOriginalOutput, generatedOutput: response.tokens,
        outputContributions, basis: 'Retained visible generated output is charged once, then enters later requests at its transcript position.' },
      input: range(request.tokens, 0, false), output: range(response.tokens, 0, false),
      contextLimit, contextLimitExceeded, supported: false,
      uncertainty: 'Visible-context scenario only. Provider framing, hidden reasoning, missing context and alternative single-agent behavior are not measured.' })
  }
  for (const turn of evidence.turns.filter(item => turnDispositions.get(item.id).action === 'remove')) {
    entryAccounting.push({ turnId: turn.id, sessionId: turn.sessionId, runId: turn.runId,
      confidence: turn.confidence, disposition: 'remove', sources: turn.sources,
      attributedOriginalInput: turn.measuredUsage?.inputTokens ?? null,
      attributedOriginalOutput: turn.measuredUsage?.outputTokens ?? null,
      retainedEntryInput: 0, retainedOutput: 0, outputContributions: [],
      basis: 'Removed response has no request or generated output charge. Retained history is unchanged.' })
  }
  const input = range(sum(estimates.map(item => item.input.estimate)), 0, false)
  const output = range(sum(estimates.map(item => item.output.estimate)), 0, false)
  const total = range(sum([input.estimate, output.estimate]), 0, false)
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
  const measuredTotal = measured.combined.total.value
  const compare = estimate => ({
    estimate: estimate.estimate !== null && measuredTotal !== null ? estimate.estimate - measuredTotal : null,
    lower: estimate.lower !== null && measuredTotal !== null ? estimate.lower - measuredTotal : null,
    upper: estimate.upper !== null && measuredTotal !== null ? estimate.upper - measuredTotal : null,
    meaning: 'Estimated whole coordinator replay minus measured coordinator and descendant usage. Positive means more tokens in this scenario.',
  })
  const difference = compare(total)
  const ignoredAssumptions = Object.keys(assumptions).map(key => `${key}=${assumptions[key]}`)
  if (ignoredAssumptions.length) gap(`Legacy scalar overrides are recorded but not applied to ordered replay: ${ignoredAssumptions.join(', ')}.`)
  const finalRootText = finalBlocks.get(root?.id)?.at(-1)
  const finalAnswer = finalRootText ? { originalBlockId: finalRootText.id,
    retainedBlockIds: (retainedDependencies(finalRootText.id) || []).filter(id => blocks.get(id)?.kind === 'text'),
    substituted: dispositions.get(finalRootText.id).action === 'remove' } : null
  const gapReasons = [...new Set(gaps.map(item => item.reason))].map(reason => ({ reason,
    count: gaps.filter(item => item.reason === reason).length }))
  return freeze({ version: 4, cutoff: data.cutoff, sourceSessionId: root?.id || null,
    measured, finalAnswer, measuredRuns: data.agents.flatMap(agent => agent.rows.map(row => ({ sessionId: row.sessionId, runId: row.id,
      provider: row.provider, model: row.model, source: row.usageSource, status: row.status,
      usage: Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'fresh', 'reasoning', 'total', 'requests'].map(field => [field, row[field]])) }))),
    estimate: { input, output, total, difference,
      scope: 'One coordinator conversation containing placed recorded work, tokenized at surviving observed or transcript-inferred requests through cutoff.' },
    sensitivity: { withoutAllocatedRequests: {
      excludedRequests: 0, input, output, total, difference, replayTurns: estimates,
      assumption: 'No requests are allocated from token totals or missing counts. This compatibility view equals the primary replay.' } },
    coverage: { complete: estimates.length > 0 && !gaps.length && estimates.every(item => item.supported && item.output.upper !== null), gaps, gapReasons, unplacedSessions: unplaced,
      cutoff: data.cutoff, measuredUsageComplete: measured.combined.total.value !== null && !data.warnings.length,
      firstUnsupportedTurn: estimates.find(item => !item.supported || item.output.upper === null)?.turnId || null },
    confidenceCounts: Object.fromEntries(['measured', 'inferred', 'allocated'].map(confidence => [confidence,
      evidence.turns.filter(turn => turn.confidence === confidence).length])),
    removed: { blocks: [...dispositions.values()].filter(item => item.action === 'remove').length,
      turns: [...turnDispositions.values()].filter(item => item.action === 'remove').length,
      estimatedDelegationTurns: removedOverheadTurns },
    ordering: { policy: 'Original transcript order, recursively insert each child immediately after its spawn call. Siblings use creation time then session ID. Missing anchors are explicit gaps.',
      insertions: [...insertions.values()].flat(), actions: ordered.map((action, index) => ({ ...action, index })) },
    tokenizer: { identities: tokenizer.identities(), cachedRequestsAndOutputs: tokenizer.cacheSize(),
      cacheKey: 'Content SHA-256 + encoding + tokenizer version + serialization version.' },
    calibration, entryAccounting, assumptions: [
      'Rebuild the same recorded work as one sequential coordinator conversation. This does not claim an exact alternate execution.',
      'Measured combined usage remains the actual coordinator plus descendant usage. It is never added as text to replay history.',
      'Retain observed request identities and infer requests only from generated content and prompt/tool-result boundaries. Missing counts or boundaries are reported, never synthesized from token volume.',
      'Recursively insert child work at captured spawn calls. Unplaced children remain explicit gaps, not guessed end-of-run insertions.',
      'Each retained prompt, message and tool result enters history once at its transcript position. Each surviving request tokenizes that complete visible history once.',
      'Generated output is charged once and enters context only after the request that generated it. Removing a handoff prompt does not erase earlier history.',
      'Captured system sections are deduplicated by role and content. Captured delegation policy sections are removed. No scalar startup deduction or proportional run-budget allocation is applied.',
      'Hidden/provider-dependent reasoning is not known visible context and is excluded from the point estimate. Its counterfactual cost and context retention remain unknown.',
      'Retain visible history across recorded resets and compaction as an explicit scenario. Replacement summaries, hidden prefixes and lost context are not invented.',
      'Tokenization uses an approximate message serialization and a proxy encoding where the coordinator tokenizer is unknown. Missing tool schemas, prefixes and context prevent a supported bounded total.',
      'Calibration remains per original session/model/region using reconciled response usage. Signed residuals are diagnostic only, never new context or overhead deductions.',
      'Remove delegation wrappers only with retained task/findings evidence. Remove relay-only requests when every generated block is supported coordination or repeated findings, including a redundant final root relay.',
      'Useful mixed responses and novel synthesis remain. Retained child findings can supply the final answer instead of charging a duplicate coordinator relay.',
      'Coordination and relay classification is heuristic and explicitly recorded. Unmatched substantive text is retained.',
      'Removal proofs resolve to retained evidence. Invalid dependency chains restore the original content.',
      'Request fingerprints represent serialized retained visible content, not original provider requests. Point estimates have unknown upper bounds where evidence is incomplete.',
      ...(ignoredAssumptions.length ? [`Unapplied legacy assumptions: ${ignoredAssumptions.join(', ')}`] : []),
    ],
    turns: evidence.turns, blocks: evidence.blocks, blockDispositions: [...dispositions.values()],
    turnDispositions: [...turnDispositions.values()], replayTurns: estimates, runAccounting: evidence.runAccounting,
    sourceEvents: data.agents.map(agent => ({ sessionId: agent.id, events: agent.events })),
  })
}

module.exports = { createSubagentReplay }
