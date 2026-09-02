import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const DSH_PACKAGE = process.env.REPORT_STUDIO_DSH_PACKAGE || '@deepseek-ai/dsh@0.1.1-rc.2'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const plugin = join(root, 'packages', 'studio-dsh-plugin')

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => {
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

async function waitForHealth(url, child, logs, timeoutMs = 90000) {
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

const home = await mkdtemp(join(tmpdir(), 'report-studio-dsh-home-'))
const env = { ...process.env, DSH_HOME: home, CI: '1', NO_COLOR: '1' }
let child
try {
  const npxPrefix = ['--yes', '--package', DSH_PACKAGE, 'dsh']
  const version = await run('npx', [...npxPrefix, '--version'], { cwd: root, env })
  await run('npx', [...npxPrefix, 'plugin', '--profile', 'web', 'add', plugin], { cwd: root, env })
  const dumped = await run('npx', [...npxPrefix, '--profile', 'web', '--dump-config'], { cwd: root, env })
  if (!dumped.stdout.includes('@architectureworld/report-studio-dsh')) throw new Error(`DSH composed config does not contain Report Studio plugin.\n${dumped.stdout}`)
  const port = await freePort()
  let stdout = ''
  let stderr = ''
  child = spawn('npx', [...npxPrefix, '--profile', 'web', '--port', String(port), '--no-open'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const logs = () => `${stdout}\n${stderr}`
  const healthUrl = `http://127.0.0.1:${port}/report-studio/api/health?sessionId=smoke-session`
  const health = await waitForHealth(healthUrl, child, logs)
  if (health.agentMode !== 'dsh-native' || health.agentConfigured !== true) throw new Error(`Unexpected native health payload: ${JSON.stringify(health)}`)
  const page = await fetch(`http://127.0.0.1:${port}/report-studio/?sessionId=smoke-session`).then(response => response.text())
  const nativeRuntime = await fetch(`http://127.0.0.1:${port}/report-studio/dsh-native-runtime.js`).then(response => response.text())
  if (!page.includes('Report Studio') || !nativeRuntime.includes('report-studio.prompt')) throw new Error('DSH route did not serve the production Report Studio UI.')
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
