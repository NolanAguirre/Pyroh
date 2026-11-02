// Provider versions only supply language. All providers use the same prompt
// ids and triggers; omitted versions inherit the current shared text.
const { tools: delegationTools } = require('../harness/delegationTools')

const noNativeSpawning = (shared) => `${shared}\nNative spawning cannot be fully blocked by this provider. Do not use native spawning.`
const withDelegationSchemas = (shared) => `${shared}\n\nThe harness_agents MCP tools accept the following JSON argument schemas. Call these tools using their registered MCP names.\n${JSON.stringify(delegationTools.map(({ name, inputSchema }) => ({ name, inputSchema })), null, 2)}`

const PROVIDER_VERSIONS = {
  cursor: {
    delegationParent: withDelegationSchemas,
  },
  grok: {
    delegationParent: noNativeSpawning,
    delegationChild: noNativeSpawning,
  },
}

module.exports = { PROVIDER_VERSIONS }
