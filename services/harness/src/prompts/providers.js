// Provider versions only supply language. All providers use the same prompt
// ids and triggers; omitted versions inherit the current shared text.
const { tools: delegationTools } = require('../harness/delegationTools')

const noNativeSpawning = (shared) => `${shared}\nNative spawning cannot be fully blocked by this provider. Do not use native spawning.`
const withDelegationSchemas = (shared) => `${shared}\n\nThe harness_agents MCP tools accept the following JSON argument schemas. Call these tools using their registered MCP names.\n${JSON.stringify(delegationTools.map(({ name, inputSchema }) => ({ name, inputSchema })), null, 2)}`

const PROVIDER_VERSIONS = {
  codex: {
    ask: (shared) => `${shared}\nCodex uses commandExecution for file reads such as rg and cat. You may use command execution only to inspect files and gather information needed to answer. Do not edit, create, or delete files; run builds, tests, installs, migrations, or services; or execute commands or tools that change local or external state. Command availability is not permission to make changes.`,
  },
  cursor: {
    delegationParent: withDelegationSchemas,
    delegationLeader: withDelegationSchemas,
  },
  grok: {
    delegationParent: noNativeSpawning,
    delegationChild: noNativeSpawning,
  },
}

module.exports = { PROVIDER_VERSIONS }
