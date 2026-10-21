const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { resolveRoot } = require('../store/workspaceRoot')

const MAX_BYTES = 5 * 1024 * 1024
const SNIFF_BYTES = 8192
const CONCURRENCY = 32
const NEWLINE = 10

const LANGUAGES = [
  ['javascript', 'JavaScript', ['.js', '.mjs', '.cjs']],
  ['jsx', 'JSX', ['.jsx']],
  ['typescript', 'TypeScript', ['.ts', '.mts', '.cts']],
  ['tsx', 'TSX', ['.tsx']],
  ['css', 'CSS', ['.css']],
  ['scss', 'SCSS', ['.scss', '.sass']],
  ['less', 'Less', ['.less']],
  ['html', 'HTML', ['.html', '.htm']],
  ['vue', 'Vue', ['.vue']],
  ['svelte', 'Svelte', ['.svelte']],
  ['json', 'JSON', ['.json', '.jsonc']],
  ['yaml', 'YAML', ['.yml', '.yaml']],
  ['toml', 'TOML', ['.toml']],
  ['xml', 'XML', ['.xml']],
  ['svg', 'SVG', ['.svg']],
  ['markdown', 'Markdown', ['.md', '.mdx']],
  ['text', 'Text', ['.txt']],
  ['shell', 'Shell', ['.sh', '.bash', '.zsh']],
  ['python', 'Python', ['.py']],
  ['go', 'Go', ['.go']],
  ['rust', 'Rust', ['.rs']],
  ['ruby', 'Ruby', ['.rb']],
  ['java', 'Java', ['.java']],
  ['kotlin', 'Kotlin', ['.kt', '.kts']],
  ['swift', 'Swift', ['.swift']],
  ['c', 'C', ['.c', '.h']],
  ['cpp', 'C++', ['.cc', '.cpp', '.cxx', '.hpp', '.hh']],
  ['csharp', 'C#', ['.cs']],
  ['php', 'PHP', ['.php']],
  ['lua', 'Lua', ['.lua']],
  ['sql', 'SQL', ['.sql']],
  ['makefile', 'Makefile', ['.mk']],
  ['dockerfile', 'Dockerfile', []],
]

const FILENAMES = {
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
  Dockerfile: 'dockerfile',
}

const OTHER = 'other'

const BY_EXTENSION = new Map(
  LANGUAGES.flatMap(([id, , extensions]) => extensions.map((ext) => [ext, id])),
)

const LANGUAGE_NAMES = Object.fromEntries([
  ...LANGUAGES.map(([id, name]) => [id, name]),
  [OTHER, 'Other'],
])

const languageOf = (rel) => {
  const base = path.posix.basename(rel)
  if (FILENAMES[base]) return FILENAMES[base]
  return BY_EXTENSION.get(path.posix.extname(base).toLowerCase()) || OTHER
}

const countLines = (buffer) => {
  if (!buffer.length) return 0
  let count = 0
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === NEWLINE) count += 1
  }
  return buffer[buffer.length - 1] === NEWLINE ? count : count + 1
}

// Respects .gitignore even outside a git repo, skips hidden files, and never
// follows symlinks, so every listed path stays inside the root.
const listFiles = (root) => new Promise((resolve, reject) => {
  const child = spawn('rg', [
    '--files',
    '--null',
    '--no-require-git',
    '--glob', '!**/node_modules/**',
    '--glob', '!**/.git/**',
    '--glob', '!**/package.json',
    '--glob', '!**/package-lock.json',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('error', (err) => {
    if (err && err.code === 'ENOENT') reject(Object.assign(new Error('ripgrep (rg) is not installed'), { httpStatus: 500 }))
    else reject(err)
  })
  child.on('close', (code) => {
    if (code !== 0 && code !== 1) {
      reject(Object.assign(new Error(stderr.trim() || 'File listing failed'), { httpStatus: 500 }))
      return
    }
    const files = stdout
      .split('\0')
      .map((rel) => rel.replace(/^\.\//, '').split(path.sep).join('/'))
      .filter((rel) => rel && !rel.split('/').includes('..'))
    resolve(files.sort())
  })
})

const mapLimit = async (items, limit, fn) => {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const measure = async (root, rel) => {
  try {
    const full = path.join(root, rel)
    const stat = await fs.promises.lstat(full)
    if (!stat.isFile()) return null
    if (stat.size > MAX_BYTES) return { skipped: 'large' }
    const buffer = await fs.promises.readFile(full)
    if (buffer.subarray(0, SNIFF_BYTES).includes(0)) return { skipped: 'binary' }
    return { path: rel, language: languageOf(rel), lines: countLines(buffer), bytes: stat.size }
  } catch {
    return null
  }
}

const codeStats = async ({ workspace }) => {
  const root = await resolveRoot(workspace)
  const measured = await mapLimit(await listFiles(root), CONCURRENCY, (rel) => measure(root, rel))
  const skipped = { binary: 0, large: 0 }
  const files = []
  measured.forEach((entry) => {
    if (!entry) return
    if (entry.skipped) skipped[entry.skipped] += 1
    else files.push(entry)
  })
  return { root, files, skipped, languages: LANGUAGE_NAMES }
}

module.exports = { codeStats, languageOf, countLines }
