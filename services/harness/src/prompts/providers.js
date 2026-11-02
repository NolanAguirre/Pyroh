// Provider versions only supply language. All providers use the same prompt
// ids and triggers; omitted versions inherit the current shared text.
const noNativeSpawning = (shared) => `${shared}\nNative spawning cannot be fully blocked by this provider. Do not use native spawning.`

const PROVIDER_VERSIONS = {
  grok: {
    delegationParent: noNativeSpawning,
    delegationChild: noNativeSpawning,
  },
}

module.exports = { PROVIDER_VERSIONS }
