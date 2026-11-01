// `##xxxxxxx` DevScope tokens. The server appends the files that contain the
// id; the lookahead skips tokens already followed by a path.
export const devIdPaths = {
  id: 'devIdPaths',
  label: 'Dev id paths',
  description: 'Appends the file:line locations of each ##id.',
  steer: true,
  patterns: [/##([a-z0-9]{7})\b(?!\s+\/)/g],
}
