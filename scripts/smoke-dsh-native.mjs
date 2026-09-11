import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { resolveRequiredPluginPackage } from './release-integrity.mjs'

const DSH_PACKAGE = process.env.REPORT_STUDIO_DSH_PACKAGE || '@deepseek-ai/dsh@0.1.1-rc.2'
const DSH_BIN = process.env.REPORT_STUDIO_DSH_BIN?.trim() || ''
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const smokeWorkspace = resolve(root, 'contracts', 'presentation-standard-project', 'examples', 'unformatted-project', 'project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief')

async function resolveDshCommand() {
  if (DSH_BIN) {
    await access(DSH_BIN, constants.X_OK)
    if (process.platform === 'win32' && /\.(?:cmd|ps1|bat)$/i.test(DSH_BIN)) {
      const entry = join(dirname(DSH_BIN), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      await access(entry, constants.R_OK)
      return {
        command: process.execPath,
        prefix: [entry],
        label: `${process.execPath} ${entry}`,
        packageResolution: false,
      }
    }
    return { command: DSH_BIN, prefix: [], label: DSH_BIN, packageResolution: false }
  }
  if (process.platform === 'win32') {
    const prefixes = [process.env.npm_config_prefix, process.env.APPDATA && join(process.env.APPDATA, 'npm')]
      .map(value => value?.trim())
      .filter(Boolean)
    for (const prefix of prefixes) {
      const entry = join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      try {
        await access(entry, constants.R_OK)
        return {
          command: process.execPath,
          prefix: [entry],
          label: `${process.execPath} ${entry}`,
          packageResolution: false,
        }
      } catch {}
    }
    throw new Error('Windows 未找到全局 DSH，请先安装 @deepseek-ai/dsh@0.1.1-rc.2')
  }
  return {
    command: 'npx',
    prefix: ['--yes', DSH_PACKAGE],
    label: `npx --yes ${DSH_PACKAGE}`,
    packageResolution: true,
  }
}

function run(command, args, { timeoutMs = 180000, ...options } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 3000).unref()
      settled = true
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms\n${stdout}\n${stderr}`))
    }, timeoutMs)
    timeout.unref()

    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stdout}\n${stderr}`))
    })
  })
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const port = server.address().port
  await new Promise(resolvePromise => server.close(resolvePromise))
  return port
}

async function waitForHealth(url, child, logs, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`DSH exited before health check (${child.exitCode})\n${logs()}`)
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  }
  throw new Error(`Timed out waiting for ${url}\n${logs()}`)
}

async function createSmokeSession(baseUrl, child, logs, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  let lastResponse = 'DSH API 尚未响应'
  const request = {
    type: 'client-request',
    rpcId: 'report-studio-smoke-session-create',
    method: 'session.create',
    payload: { sessionId: 'smoke-session', cwd: smokeWorkspace },
  }
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`DSH exited before Session creation (${child.exitCode})\n${logs()}`)
    let response
    try {
      response = await fetch(`${baseUrl}/api/session.create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
    } catch (error) {
      lastResponse = String(error)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
      continue
    }
    if (!response.ok) {
      lastResponse = `HTTP ${response.status}: ${await response.text()}`
      await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
      continue
    }
    const payload = await response.json()
    if (payload?.result?.ok === true && payload.result.value?.sessionId === 'smoke-session') return payload.result.value
    throw new Error(`DSH Session creation failed: ${JSON.stringify(payload)}\n${logs()}`)
  }
  throw new Error(`Timed out creating smoke-session at ${baseUrl}: ${lastResponse}\n${logs()}`)
}

const home = await mkdtemp(join(tmpdir(), 'report-studio-dsh-home-'))
const env = { ...process.env, DSH_HOME: home, CI: '1', NO_COLOR: '1' }
const plugin = await resolveRequiredPluginPackage(process.env.REPORT_STUDIO_PLUGIN_PACKAGE, root)
const dsh = await resolveDshCommand()
const invoke = args => [dsh.command, [...dsh.prefix, ...args]]
let child
try {
  console.log(`DSH smoke 1/5: resolve CLI (${dsh.label})`)
  const [versionCommand, versionArgs] = invoke(['--version'])
  const version = await run(versionCommand, versionArgs, {
    cwd: root,
    env,
    timeoutMs: dsh.packageResolution ? 600000 : 30000,
  })

  console.log(`DSH smoke 2/5: install Report Studio bundle into an isolated web profile (${plugin})`)
  const [addCommand, addArgs] = invoke(['plugin', '--profile', 'web', 'add', '--workspace-root', plugin])
  await run(addCommand, addArgs, { cwd: root, env, timeoutMs: 600000 })

  console.log('DSH smoke 3/5: verify composed profile')
  const [dumpCommand, dumpArgs] = invoke(['--profile', 'web', '--dump-config'])
  const dumped = await run(dumpCommand, dumpArgs, { cwd: root, env, timeoutMs: 180000 })
  if (!dumped.stdout.includes('@architectureworld/report-studio-dsh')) {
    throw new Error(`DSH composed config does not contain Report Studio plugin.\n${dumped.stdout}`)
  }

  const port = await freePort()
  let stdout = ''
  let stderr = ''
  const [startCommand, startArgs] = invoke(['--profile', 'web', '--port', String(port), '--no-open'])
  console.log(`DSH smoke 4/5: start web profile on 127.0.0.1:${port}`)
  child = spawn(startCommand, startArgs, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => {
    const text = chunk.toString()
    stdout += text
    process.stdout.write(text)
  })
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    stderr += text
    process.stderr.write(text)
  })
  const logs = () => `${stdout}\n${stderr}`
  const baseUrl = `http://127.0.0.1:${port}`
  await createSmokeSession(baseUrl, child, logs)
  const healthUrl = `${baseUrl}/report-studio/api/health?sessionId=smoke-session`
  const health = await waitForHealth(healthUrl, child, logs)
  if (health.version !== 'v0.1.1' || health.agentMode !== 'dsh-native' || health.agentConfigured !== true || health.migrationStatus !== 'ready' || health.securityMode !== 'local-single-user-only' || health.listenHost !== '127.0.0.1' || health.networkSharedSecurity !== false) {
    throw new Error(`Unexpected native health payload: ${JSON.stringify(health)}`)
  }

  console.log('DSH smoke 5/5: verify production UI and native browser bridge')
  const shellResponse = await fetch(`http://127.0.0.1:${port}/`)
  const pageResponse = await fetch(`http://127.0.0.1:${port}/report-studio/?sessionId=smoke-session`)
  const runtimeResponse = await fetch(`http://127.0.0.1:${port}/report-studio/dsh-native-runtime.js`)
  if (!shellResponse.ok || !pageResponse.ok || !runtimeResponse.ok) {
    throw new Error(`DSH route failed: shell=${shellResponse.status}, page=${pageResponse.status}, runtime=${runtimeResponse.status}`)
  }
  const shell = await shellResponse.text()
  const page = await pageResponse.text()
  const nativeRuntime = await runtimeResponse.text()
  if (!shell.includes('<!doctype html>') || !page.includes('report-studio-standalone-notice') || !nativeRuntime.includes('report-studio.prompt')) {
    throw new Error('DSH route did not serve the production Report Studio UI.')
  }

  console.log('Report Studio native DSH runtime smoke PASS')
  console.log(`dsh=${version.stdout.trim()}`)
  console.log('profile=web')
  console.log(`health=${healthUrl}`)
  console.log('plugin=@architectureworld/report-studio-dsh')
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise(resolvePromise => child.once('exit', resolvePromise)),
      new Promise(resolvePromise => setTimeout(resolvePromise, 5000)),
    ])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  await rm(home, { recursive: true, force: true })
}
