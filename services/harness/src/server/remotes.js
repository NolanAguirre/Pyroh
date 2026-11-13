const fs = require('fs/promises')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { readSource, validate, renderConf, renderPublic } = require('../../../nginx/render-machines')

const nginxDir = path.resolve(__dirname, '../../../nginx')
const execute = promisify(execFile)
let saving = false

const read = () => readSource()

const replace = async (name, content) => {
  const destination = path.join(nginxDir, name)
  const temporary = `${destination}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporary, content)
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

const nginxRunning = async () => {
  let pid
  try {
    pid = Number((await fs.readFile(path.join(nginxDir, 'nginx.pid'), 'utf8')).trim())
  } catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
  }
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err.code === 'ESRCH') return false
    throw err
  }
}

const save = async (body) => {
  if (saving) throw Object.assign(new Error('A remote config save is already in progress'), { status: 409 })
  let config
  try {
    config = validate(body)
  } catch (err) {
    err.status = 400
    throw err
  }
  saving = true
  const previous = new Map()
  try {
    const files = {
      'machines.json': `${JSON.stringify(config, null, 2)}\n`,
      'machines.conf': renderConf(config),
      'machines.public.json': renderPublic(config),
    }
    for (const name of Object.keys(files)) {
      try {
        previous.set(name, await fs.readFile(path.join(nginxDir, name)))
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
        previous.set(name, null)
      }
    }
    try {
      for (const [name, content] of Object.entries(files)) await replace(name, content)
      const running = await nginxRunning()
      if (running) {
        const args = ['-p', nginxDir, '-c', 'nginx.conf']
        await execute('nginx', [...args, '-t'], { timeout: 10000 })
        await execute('nginx', [...args, '-s', 'reload'], { timeout: 10000 })
      }
      return { config, applied: running }
    } catch (err) {
      const failures = []
      for (const [name, content] of previous) {
        try {
          if (content === null) await fs.rm(path.join(nginxDir, name), { force: true })
          else await replace(name, content)
        } catch (restoreError) {
          failures.push(`${name}: ${restoreError.message}`)
        }
      }
      throw new Error(`Could not apply remote config: ${err.message}${failures.length ? `. Could not restore ${failures.join('; ')}` : '. Previous config restored.'}`)
    }
  } finally {
    saving = false
  }
}

module.exports = { read, save }
