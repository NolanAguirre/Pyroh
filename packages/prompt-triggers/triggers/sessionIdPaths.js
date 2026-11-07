// Session IDs contain a base36 timestamp and six random hex characters.
// Skip paths, machine-qualified IDs, and IDs already followed by a path.
export const sessionIdPaths = {
  id: 'sessionIdPaths',
  label: 'Session id paths',
  description: 'Appends the session directory to each known session ID.',
  scope: 'message',
  patterns: [/(?<![\w/\\@])s_[a-z0-9]+[a-f0-9]{6}\b(?![/\\@]|\.[a-zA-Z0-9]|\s+\/)/g],
}
