import { spawn, spawnSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { chromium } from 'playwright-core'
import { resolveRequiredPluginPackage } from './release-integrity.mjs'

const DEFAULT_DSH_VERSION = '0.1.5-rc.1'
const DSH_PACKAGE = process.env.REPORT_STUDIO_DSH_PACKAGE || `@deepseek-ai/dsh@${DEFAULT_DSH_VERSION}`
const EXPECTED_DSH_VERSION = process.env.REPORT_STUDIO_DSH_VERSION?.trim() || DEFAULT_DSH_VERSION
const DSH_BIN = process.env.REPORT_STUDIO_DSH_BIN?.trim() || ''
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const smokeWorkspace = resolve(root, 'contracts', 'presentation-standard-project', 'examples', 'unformatted-project', 'project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief')

function assertRuntimeBaseline() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || (major === 24 && minor < 11)) {
    throw new Error(`Report Studio DSH smoke requires Node >=24.11.0; current ${process.version}`)
  }
}

function assertDshVersion(result) {
  const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const matched = lines.some(line => line === EXPECTED_DSH_VERSION || line === `dsh ${EXPECTED_DSH_VERSION}` || line.endsWith(` ${EXPECTED_DSH_VERSION}`))
  if (!matched) {
    throw new Error(`DSH version mismatch: expected ${EXPECTED_DSH_VERSION}, received ${lines.join(' | ') || '<empty output>'}`)
  }
}

function redactRuntimeSecrets(value) {
  return String(value).replace(
    /(https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/\?token=)[^\s]+/gi,
    '$1<redacted>',
  )
}

function launchUrlFromLogs(text, baseUrl) {
  const pattern = /dsh web:\s+(https?:\/\/[^\s]+)/g
  let match
  while ((match = pattern.exec(text))) {
    try {
      const url = new URL(match[1])
      if (url.origin === baseUrl && url.searchParams.get('token')) return url
    } catch {}
  }
  return null
}

function cookieHeader(headers) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean)
  const pair = values.map(value => value?.split(';', 1)[0]?.trim()).find(Boolean)
  if (!pair || !pair.includes('=')) throw new Error('DSH launch-token exchange did not return a browser-session cookie')
  return pair
}

function authenticatedHeaders(cookie, headers = {}) {
  const result = new Headers(headers)
  result.set('cookie', cookie)
  return result
}

function authenticatedFetch(url, cookie, options = {}) {
  return fetch(url, { ...options, headers: authenticatedHeaders(cookie, options.headers) })
}

async function waitForBrowserSession(baseUrl, child, rawLogs, logs, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'DSH launch URL 尚未出现'
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`DSH exited before browser authentication (${child.exitCode})\n${logs()}`)
    const launchUrl = launchUrlFromLogs(rawLogs(), baseUrl)
    if (!launchUrl) {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
      continue
    }
    try {
      const response = await fetch(launchUrl, { redirect: 'manual' })
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        lastError = `launch-token exchange returned HTTP ${response.status}`
        await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
        continue
      }
      const cookie = cookieHeader(response.headers)
      console.log('DSH browser authentication established through launch-token exchange')
      return cookie
    } catch (error) {
      lastError = redactRuntimeSecrets(error?.message || error)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
    }
  }
  throw new Error(`Timed out establishing DSH browser authentication: ${lastError}\n${logs()}`)
}

function findBrowser() {
  const configured = process.env.CHROMIUM_PATH?.trim()
  const windowsCandidates = process.platform === 'win32'
    ? [
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
    : []
  const candidates = [configured, ...windowsCandidates, 'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (!probe.error && probe.status === 0) return candidate
  }
  throw new Error('DSH browser smoke 未找到 Chromium/Chrome，请设置 CHROMIUM_PATH')
}

async function verifyWebClient(baseUrl, cookie) {
  const executablePath = findBrowser()
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
  })
  try {
    const separator = cookie.indexOf('=')
    if (separator <= 0) throw new Error('Invalid DSH browser-session cookie')
    const context = await browser.newContext()
    await context.addCookies([{
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: baseUrl,
    }])
    const page = await context.newPage()
    const pageErrors = []
    const clientErrors = []
    const failedPluginRequests = []
    page.on('pageerror', error => pageErrors.push(error?.stack || error?.message || String(error)))
    page.on('console', message => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (/report-studio|dsh-client-runtime|moduleloader|missing.+module|service.+unavailable|cannot get property|inject/i.test(text)) {
        clientErrors.push(text)
      }
    })
    page.on('requestfailed', request => {
      const url = request.url()
      if (/report-studio-dsh/i.test(decodeURIComponent(url))) {
        failedPluginRequests.push(`${url}: ${request.failure()?.errorText || 'request failed'}`)
      }
    })
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(1500)
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))
    const pluginResources = resources.filter(url => {
      try { return decodeURIComponent(url).includes('report-studio-dsh') } catch { return url.includes('report-studio-dsh') }
    })
    if (!pluginResources.length) {
      throw new Error(`DSH Web Client did not request the Report Studio client bundle. resources=${resources.slice(-30).join('\n')}`)
    }
    if (pageErrors.length || clientErrors.length || failedPluginRequests.length) {
      throw new Error([
        'DSH Web Client plugin composition failed.',
        ...pageErrors.map(value => `pageerror: ${value}`),
        ...clientErrors.map(value => `console: ${value}`),
        ...failedPluginRequests.map(value => `request: ${value}`),
      ].join('\n'))
    }
    return { executablePath, pluginResource: pluginResources[0] }
  } finally {
    await browser.close()
  }
}

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
    throw new Error(`Windows 未找到全局 DSH，请先安装 @deepseek-ai/dsh@${EXPECTED_DSH_VERSION}`)
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

async function waitForHealth(url, cookie, child, logs, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`DSH exited before health check (${child.exitCode})\n${logs()}`)
    try {
      const response = await authenticatedFetch(url, cookie)
      if (response.ok) return response.json()
    } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  }
  throw new Error(`Timed out waiting for ${url}\n${logs()}`)
}

async function createSmokeSession(baseUrl, cookie, child, logs, timeoutMs = 120000) {
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
      response = await authenticatedFetch(`${baseUrl}/api/session.create`, cookie, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
    } catch (error) {
      lastResponse = redactRuntimeSecrets(error?.message || error)
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

assertRuntimeBaseline()
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
  assertDshVersion(version)

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
    process.stdout.write(redactRuntimeSecrets(text))
  })
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    stderr += text
    process.stderr.write(redactRuntimeSecrets(text))
  })
  const rawLogs = () => `${stdout}\n${stderr}`
  const logs = () => redactRuntimeSecrets(rawLogs())
  const baseUrl = `http://127.0.0.1:${port}`
  const cookie = await waitForBrowserSession(baseUrl, child, rawLogs, logs)
  await createSmokeSession(baseUrl, cookie, child, logs)
  const healthUrl = `${baseUrl}/report-studio/api/health?sessionId=smoke-session`
  const health = await waitForHealth(healthUrl, cookie, child, logs)
  if (health.version !== 'v0.1.1' || health.agentMode !== 'dsh-native' || health.agentConfigured !== true || health.migrationStatus !== 'ready' || health.securityMode !== 'local-single-user-only' || health.listenHost !== '127.0.0.1' || health.networkSharedSecurity !== false) {
    throw new Error(`Unexpected native health payload: ${JSON.stringify(health)}`)
  }

  console.log('DSH smoke 5/5: verify production UI, native browser bridge and DSH Web Client composition')
  const shellResponse = await authenticatedFetch(`${baseUrl}/`, cookie)
  const pageResponse = await authenticatedFetch(`${baseUrl}/report-studio/?sessionId=smoke-session`, cookie)
  const runtimeResponse = await authenticatedFetch(`${baseUrl}/report-studio/dsh-native-runtime.js`, cookie)
  if (!shellResponse.ok || !pageResponse.ok || !runtimeResponse.ok) {
    throw new Error(`DSH route failed: shell=${shellResponse.status}, page=${pageResponse.status}, runtime=${runtimeResponse.status}`)
  }
  const shell = await shellResponse.text()
  const page = await pageResponse.text()
  const nativeRuntime = await runtimeResponse.text()
  if (!shell.includes('<!doctype html>') || !page.includes('report-studio-standalone-notice') || !nativeRuntime.includes('report-studio.prompt')) {
    throw new Error('DSH route did not serve the production Report Studio UI.')
  }
  const webClient = await verifyWebClient(baseUrl, cookie)

  console.log('Report Studio native DSH runtime smoke PASS')
  console.log(`dsh=${EXPECTED_DSH_VERSION}`)
  console.log('profile=web')
  console.log(`health=${healthUrl}`)
  console.log(`browser=${webClient.executablePath}`)
  console.log(`client=${webClient.pluginResource}`)
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
