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

test('DSH smoke installs the plugin explicitly at the profile workspace root', async t => {
  const fakeRoot = await mkdtemp(join(tmpdir(), 'report-studio-fake-dsh-'))
  t.after(() => rm(fakeRoot, { recursive: true, force: true }))

  const fakeSource = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log('0.1.1-rc.2')
  process.exit(0)
}
console.log('FAKE_DSH_ARGS=' + JSON.stringify(args))
process.exit(23)
`
  let fakeBin
  if (process.platform === 'win32') {
    fakeBin = join(fakeRoot, 'dsh.cmd')
    const fakeEntry = join(fakeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await mkdir(join(fakeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    await Promise.all([
      writeFile(fakeBin, '@echo off\r\n', 'utf8'),
      writeFile(fakeEntry, fakeSource, 'utf8'),
    ])
  } else {
    fakeBin = join(fakeRoot, 'dsh')
    await writeFile(fakeBin, fakeSource, 'utf8')
    await chmod(fakeBin, 0o755)
  }

  const result = await run(process.execPath, ['scripts/smoke-dsh-native.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      REPORT_STUDIO_DSH_BIN: fakeBin,
      REPORT_STUDIO_PLUGIN_PACKAGE: 'package.json',
    },
  })

  assert.equal(result.code, 1)
  assert.match(`${result.stdout}\n${result.stderr}`, /FAKE_DSH_ARGS=.*"add","--workspace-root"/)
})
