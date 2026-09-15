import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'))

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => resolvePromise({ code, stdout, stderr }))
  })
}

async function fakeDsh(t, versionOutput) {
  const fakeRoot = await mkdtemp(join(tmpdir(), 'report-studio-fake-dsh-'))
  t.after(() => rm(fakeRoot, { recursive: true, force: true }))
  const fakeSource = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version') {
  ${versionOutput ? `console.log(${JSON.stringify(versionOutput)})` : ''}
  process.exit(0)
}
console.log('FAKE_DSH_ARGS=' + JSON.stringify(args))
process.exit(23)
`
  if (process.platform === 'win32') {
    const fakeBin = join(fakeRoot, 'dsh.cmd')
    const fakeEntry = join(fakeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await mkdir(join(fakeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    await Promise.all([
      writeFile(fakeBin, '@echo off\r\n', 'utf8'),
      writeFile(fakeEntry, fakeSource, 'utf8'),
    ])
    return fakeBin
  }
  const fakeBin = join(fakeRoot, 'dsh')
  await writeFile(fakeBin, fakeSource, 'utf8')
  await chmod(fakeBin, 0o755)
  return fakeBin
}

function smokeEnv(fakeBin) {
  return {
    ...process.env,
    REPORT_STUDIO_DSH_BIN: fakeBin,
    REPORT_STUDIO_PLUGIN_PACKAGE: 'package.json',
  }
}

test('DSH smoke accepts 0.1.5-rc.1 then installs the plugin at the profile workspace root', async t => {
  const fakeBin = await fakeDsh(t, '0.1.5-rc.1')
  const result = await run(process.execPath, ['scripts/smoke-dsh-native.mjs'], {
    cwd: root,
    env: smokeEnv(fakeBin),
  })
  assert.equal(result.code, 1)
  assert.match(`${result.stdout}\n${result.stderr}`, /FAKE_DSH_ARGS=.*"add","--workspace-root"/)
})

test('DSH smoke rejects a silent or mismatched CLI version before plugin installation', async t => {
  for (const versionOutput of ['', '0.1.1-rc.2']) {
    const fakeBin = await fakeDsh(t, versionOutput)
    const result = await run(process.execPath, ['scripts/smoke-dsh-native.mjs'], {
      cwd: root,
      env: smokeEnv(fakeBin),
    })
    assert.equal(result.code, 1)
    assert.match(`${result.stdout}\n${result.stderr}`, /DSH version mismatch/)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /FAKE_DSH_ARGS=.*"add","--workspace-root"/)
  }
})
