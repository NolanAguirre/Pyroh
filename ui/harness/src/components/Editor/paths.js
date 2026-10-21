export const parentOf = (path) => {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

export const baseName = (path) => {
  const trimmed = (path || '').replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name)

export const isWithin = (path, base) => base === '' || path === base || path.startsWith(`${base}/`)

export const isBelow = (path, base) => path !== base && isWithin(path, base)

export const replacePrefix = (path, from, to) =>
  path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path

export const absolutePath = (root, path) => {
  if (!root) return path
  if (!path) return root
  return `${root.replace(/\/+$/, '')}/${path}`
}

const LANGUAGES = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript JSX',
  ts: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', tsx: 'TypeScript JSX',
  json: 'JSON', jsonc: 'JSON with Comments', md: 'Markdown', markdown: 'Markdown',
  css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML', htm: 'HTML', xml: 'XML', svg: 'SVG',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', c: 'C', h: 'C',
  cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#', php: 'PHP', swift: 'Swift', lua: 'Lua',
  sh: 'Shell Script', bash: 'Shell Script', zsh: 'Shell Script', sql: 'SQL',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'INI', conf: 'Config', env: 'Properties',
  txt: 'Plain Text', log: 'Log', csv: 'CSV', vue: 'Vue', svelte: 'Svelte',
}

const LANGUAGE_NAMES = {
  Makefile: 'Makefile', makefile: 'Makefile', Dockerfile: 'Dockerfile', '.gitignore': 'Ignore',
  '.dockerignore': 'Ignore', '.env': 'Properties', '.editorconfig': 'EditorConfig',
}

const MEDIA_TYPES = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  bmp: 'image', avif: 'image', ico: 'image', jfif: 'image', apng: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', opus: 'audio',
}

export const mediaFor = (name) => {
  const index = (name || '').lastIndexOf('.')
  if (index <= 0) return null
  return MEDIA_TYPES[name.slice(index + 1).toLowerCase()] || null
}

export const languageFor = (name) => {
  if (!name) return 'Plain Text'
  if (LANGUAGE_NAMES[name]) return LANGUAGE_NAMES[name]
  const index = name.lastIndexOf('.')
  if (index <= 0) return 'Plain Text'
  return LANGUAGES[name.slice(index + 1).toLowerCase()] || 'Plain Text'
}
