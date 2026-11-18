export const assumptionFields = [
  { key: 'shared', label: 'Shared tokens', min: 0, max: Number.MAX_SAFE_INTEGER },
  { key: 'requests', label: 'Request count', min: 1, max: Number.MAX_SAFE_INTEGER },
  { key: 'output', label: 'Output tokens', min: 0, max: Number.MAX_SAFE_INTEGER },
]

// Index server evidence for navigation only. All estimator decisions and counts
// come from the replay, including the exact joined order and request histories.
export const createReplayModel = replay => {
  const blocks = new Map(replay.blocks.map(block => [block.id, block]))
  const turns = new Map(replay.turns.map(turn => [turn.id, turn]))
  const ordered = new Map(replay.ordering.actions.map(action => [action.id, action]))
  const blockDispositions = new Map(replay.blockDispositions.map(item => [item.blockId, item]))
  const turnDispositions = new Map(replay.turnDispositions.map(item => [item.turnId, item]))
  const estimates = new Map(replay.replayTurns.map(item => [item.turnId, item]))
  const accounting = new Map(replay.entryAccounting.map(item => [item.turnId, item]))
  const insertions = new Map()
  replay.ordering.insertions.forEach(item => {
    if (!insertions.has(item.anchorId)) insertions.set(item.anchorId, [])
    insertions.get(item.anchorId).push(item)
  })
  const sessionIds = [...new Set([
    replay.sourceSessionId,
    ...replay.sourceEvents.map(item => item.sessionId),
    ...replay.measuredRuns.map(item => item.sessionId),
    ...replay.blocks.map(item => item.sessionId),
    ...replay.turns.map(item => item.sessionId),
    ...replay.coverage.unplacedSessions,
  ].filter(Boolean))]
  const sessions = sessionIds.map(id => {
    const sessionBlocks = replay.blocks.filter(block => block.sessionId === id)
    const sessionTurns = replay.turns.filter(turn => turn.sessionId === id)
    const placedActions = replay.ordering.actions.filter(action => action.sessionId === id)
    const unplaced = replay.coverage.unplacedSessions.includes(id)
    // Filtering the joined stream restores each placed session's original order.
    // Unplaced runs have no join order, so preserve their captured evidence order
    // and use recorded event positions only within each run.
    const runIds = [...new Set([
      ...replay.measuredRuns.filter(run => run.sessionId === id).map(run => run.runId),
      ...sessionBlocks.map(block => block.runId),
      ...sessionTurns.map(turn => turn.runId),
    ])]
    const runOrder = new Map(runIds.map((runId, index) => [runId, index]))
    const localActions = placedActions.length ? placedActions : [
      ...sessionBlocks.map(block => ({ kind: 'block', id: block.id, sessionId: id, runId: block.runId,
        order: block.kind === 'tool_result' ? block.lastOrder : block.order, sectionIndex: block.sectionIndex })),
      ...sessionTurns.map(turn => ({ kind: 'request', id: turn.id, sessionId: id, runId: turn.runId, order: turn.order })),
    ].sort((left, right) => runOrder.get(left.runId) - runOrder.get(right.runId)
      || left.order - right.order || (left.sectionIndex ?? 0) - (right.sectionIndex ?? 0) || left.id.localeCompare(right.id))
    return { id, root: id === replay.sourceSessionId, unplaced, actions: localActions,
      blockCount: sessionBlocks.length, turnCount: sessionTurns.length,
      inferredCount: sessionTurns.filter(turn => turn.confidence === 'inferred').length,
      eventCount: replay.sourceEvents.find(item => item.sessionId === id)?.events.length || 0 }
  })
  return { blocks, turns, ordered, blockDispositions, turnDispositions, estimates, accounting, insertions, sessions }
}
