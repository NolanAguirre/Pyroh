// Use the last resolved provider model when the session leaves model selection
// to the provider. Do not borrow settings from a different provider.
const sessionModel = (session) => {
  if (session?.model && session.model !== 'default') return session.model
  const configuration = session?.providerConfiguration
  const inherited = session?.fork?.sourceConfiguration
  return (configuration?.provider === session?.provider && configuration?.settings?.model)
    || (inherited?.provider === session?.provider && inherited?.settings?.model)
    || session?.model
}

const sessionContext = (session, mode = session?.mode) => ({ model: sessionModel(session), mode })

module.exports = { sessionModel, sessionContext }
