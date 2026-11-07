const fs = require('fs')
const path = require('path')
const { resolveRoot } = require('./workspaceRoot')
const { isInsideRoot } = require('./fileSystem')

const candidatesFromText = (text) => {
  const candidates = new Set()
  // Keep quoted paths and Markdown destinations together, including spaces.
  const tokens = /`([^`\n]+)`|<([^<>\n]+)>|\]\(([^)\n]+)\)|"([^"\n]+)"|'([^'\n]+)'|[^\s`<>"'()[\]{}]+/g
  for (const match of text.matchAll(tokens)) {
    let value = (match[1] || match[2] || match[3] || match[4] || match[5] || match[0]).trim()
    if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1)
    value = value.replace(/^(\*{1,2}|__)(.+)\1$/, '$2')
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || value.startsWith('//')) continue
    try { value = decodeURIComponent(value) } catch { /* Keep literal percent signs. */ }
    value = value.replace(/[.,;!?]+$/, '').replace(/(?::\d+(?::\d+)?(?:-\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/, '')
    if (!value.includes('/') || !/\/[^/\r\n]+\.[a-z\d][a-z\d_-]*$/i.test(value)
      || value.includes('\0') || value.length > 4096) continue
    candidates.add(value)
    if (candidates.size >= 128) break
  }
  return [...candidates]
}

const messageFiles = async ({ workspace, text }) => {
  if (typeof text !== 'string' || text.length > 1024 * 1024) {
    throw Object.assign(new Error('Message must be a string of at most 1 MiB'), { httpStatus: 400 })
  }
  const candidates = candidatesFromText(text)
  if (!candidates.length) return { files: [] }
  const root = await resolveRoot(workspace)
  const files = new Map()
  for (const candidate of candidates) {
    // Try the absolute spelling (also accepting a missing leading slash),
    // then interpret it relative to the workspace. Keep editor root rules.
    const targets = [...new Set([
      path.resolve('/', candidate),
      path.resolve(root, candidate.replace(/^\/+/, '')),
    ])]
    for (const target of targets) {
      if (!isInsideRoot(target, root)) continue
      try {
        const stat = await fs.promises.stat(target)
        if (!stat.isFile()) continue
        const relative = path.relative(root, target)
        files.set(relative, { path: relative })
        break
      } catch (err) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ENAMETOOLONG', 'ELOOP'].includes(err.code)) throw err
      }
    }
  }
  return { files: [...files.values()] }
}

module.exports = { messageFiles }
