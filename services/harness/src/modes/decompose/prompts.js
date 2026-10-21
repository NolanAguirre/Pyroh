// The only file to edit decompose copy. Placeholders: {{sourcePlan}},
// {{currentPhase}}, {{totalPhases}}, {{planBody}}.

const countPhases = `You are counting implementation phases in a top-level plan.

Read the plan below and decide how many sequential phases (todos/tasks/phases/steps/stages) it contains. Do not count the todos at the bottom of the plan.
Return JSON only, with no markdown fences and no commentary:

{"count": N}

count must be a positive integer.

Top-level plan:

{{sourcePlan}}
`

const planPhase = `Create a plan for phase {{currentPhase}}/{{totalPhases}}.

Phases before {{currentPhase}} are already implemented in the working tree; do not re-plan or re-verify them unless this phase depends on them.
A separate agent with no access to this conversation will execute your plan. Make it self-contained: include the ground rules, file paths and decisions it needs. Do not implement it.

Top-level plan:

{{sourcePlan}}
`

const executePhase = `Execute this plan. It was written by a separate planning agent; you have no other context.

{{planBody}}
`

module.exports = { countPhases, planPhase, executePhase }
