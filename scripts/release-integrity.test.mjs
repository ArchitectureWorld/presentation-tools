import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'))
const integrity = await import('./release-integrity.mjs').catch(() => null)

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

test('release integrity API is available to enforce the packaging boundary', () => {
  assert.ok(integrity, 'scripts/release-integrity.mjs must exist')
})

if (integrity) {
  test('release configuration enforces clean installs and the single v0.1.1 workflow', async () => {
    const result = await integrity.verifyReleaseConfiguration(root)
    assert.equal(result.workflowName, 'Report Studio v0.1.1 CI')
    assert.equal(result.platforms.sort().join(','), 'ubuntu-latest,windows-latest')
  })

  test('release configuration requires the vendor manifest to trigger both push and pull request verification', async t => {
    const configurationRoot = await mkdtemp(join(tmpdir(), 'report-studio-release-configuration-test-'))
    t.after(() => rm(configurationRoot, { recursive: true, force: true }))
    await mkdir(join(configurationRoot, '.github', 'workflows'), { recursive: true })
    const [packageJson, packageLock, workflow] = await Promise.all([
      readFile(join(root, 'package.json'), 'utf8'),
      readFile(join(root, 'package-lock.json'), 'utf8'),
      readFile(join(root, '.github', 'workflows', 'report-studio-v0.1.1-ci.yml'), 'utf8'),
    ])
    const manifestPathLine = "      - 'scripts/dsh-plugin-vendor-manifest.mjs'"
    const workflowMissingPushPath = workflow.replace(new RegExp(`${manifestPathLine.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}\\r?\\n`), '')
    assert.notEqual(workflowMissingPushPath, workflow, 'fixture must remove the push path filter')
    assert.ok(workflowMissingPushPath.includes(manifestPathLine), 'fixture must retain the pull_request path filter')
    await Promise.all([
      writeFile(join(configurationRoot, 'package.json'), packageJson, 'utf8'),
      writeFile(join(configurationRoot, 'package-lock.json'), packageLock, 'utf8'),
      writeFile(join(configurationRoot, '.github', 'workflows', 'report-studio-v0.1.1-ci.yml'), workflowMissingPushPath, 'utf8'),
    ])

    await assert.rejects(
      integrity.verifyReleaseConfiguration(configurationRoot),
      /push path filter missing scripts\/dsh-plugin-vendor-manifest\.mjs/,
    )
  })

  test('release configuration rejects the Standard Project workflow when root dependencies are absent before verify:all', async t => {
    const configurationRoot = await mkdtemp(join(tmpdir(), 'report-studio-standard-workflow-test-'))
    t.after(() => rm(configurationRoot, { recursive: true, force: true }))
    await mkdir(join(configurationRoot, '.github', 'workflows'), { recursive: true })
    const [packageJson, packageLock, reportStudioWorkflow, standardWorkflow] = await Promise.all([
      readFile(join(root, 'package.json'), 'utf8'),
      readFile(join(root, 'package-lock.json'), 'utf8'),
      readFile(join(root, '.github', 'workflows', 'report-studio-v0.1.1-ci.yml'), 'utf8'),
      readFile(join(root, '.github', 'workflows', 'presentation-standard-project-v0.1.0-ci.yml'), 'utf8'),
    ])
    const rootlessStandardWorkflow = standardWorkflow.replace(
      /^          npm ci --ignore-scripts --no-audit --no-fund\r?\n/m,
      '',
    )
    await Promise.all([
      writeFile(join(configurationRoot, 'package.json'), packageJson, 'utf8'),
      writeFile(join(configurationRoot, 'package-lock.json'), packageLock, 'utf8'),
      writeFile(join(configurationRoot, '.github', 'workflows', 'report-studio-v0.1.1-ci.yml'), reportStudioWorkflow, 'utf8'),
      writeFile(join(configurationRoot, '.github', 'workflows', 'presentation-standard-project-v0.1.0-ci.yml'), rootlessStandardWorkflow, 'utf8'),
    ])

    await assert.rejects(
      integrity.verifyReleaseConfiguration(configurationRoot),
      /Standard Project workflow must install root dependencies before verify:all/,
    )
  })

  test('release configuration requires the Report Studio workflow to prepare pinned Python Contract dependencies before verify:all', async t => {
    const configurationRoot = await mkdtemp(join(tmpdir(), 'report-studio-python-workflow-test-'))
    t.after(() => rm(configurationRoot, { recursive: true, force: true }))
    await mkdir(join(configurationRoot, '.github', 'workflows'), { recursive: true })
    const [packageJson, packageLock, reportStudioWorkflow, standardWorkflow] = await Promise.all([
      readFile(join(root, 'package.json'), 'utf8'),
      readFile(join(root, 'package-lock.json'), 'utf8'),
      readFile(join(root, '.github', 'workflows', 'report-studio-v0.1.1-ci.yml'), 'utf8'),
      readFile(join(root, '.github', 'workflows', 'presentation-standard-project-v0.1.0-ci.yml'), 'utf8'),
    ])
    const writeConfiguration = async workflow => {
      await Promise.all([
        writeFile(join(configurationRoot, 'package.json'), packageJson, 'utf8'),
        writeFile(join(configurationRoot, 'package-lock.json'), packageLock, 'utf8'),
        writeFile(join(configurationRoot, '.github', 'workflows', 'report-studio-v0.1.1-ci.yml'), workflow, 'utf8'),
        writeFile(join(configurationRoot, '.github', 'workflows', 'presentation-standard-project-v0.1.0-ci.yml'), standardWorkflow, 'utf8'),
      ])
    }

    await writeConfiguration(reportStudioWorkflow.replace(
      /      - uses: actions\/setup-python@v5\r?\n        with:\r?\n          python-version: '3\.12'\r?\n/,
      '',
    ))
    await assert.rejects(
      integrity.verifyReleaseConfiguration(configurationRoot),
      /Report Studio workflow must set up Python 3\.12 before verify:all/,
    )

    await writeConfiguration(reportStudioWorkflow.replace(
      /^          python -m pip install --disable-pip-version-check --no-input jsonschema==4\.26\.0 referencing==0\.37\.0\r?\n/m,
      '',
    ))
    await assert.rejects(
      integrity.verifyReleaseConfiguration(configurationRoot),
      /Report Studio workflow must install pinned Python Contract dependencies before verify:all/,
    )
  })

  test('smoke package resolution refuses implicit dist or source fallbacks', async () => {
    await assert.rejects(
      integrity.resolveRequiredPluginPackage('', root),
      /REPORT_STUDIO_PLUGIN_PACKAGE is required/,
    )
  })

  test('source commit verification rejects bytes changed after the commit', async t => {
    const repository = await mkdtemp(join(tmpdir(), 'report-studio-source-commit-test-'))
    t.after(() => rm(repository, { recursive: true, force: true }))
    assert.equal((await run('git', ['init'], { cwd: repository })).code, 0)
    assert.equal((await run('git', ['config', 'user.name', 'Report Studio Test'], { cwd: repository })).code, 0)
    assert.equal((await run('git', ['config', 'user.email', 'report-studio-test@example.invalid'], { cwd: repository })).code, 0)
    await writeFile(join(repository, 'artifact.txt'), 'committed\n', 'utf8')
    assert.equal((await run('git', ['add', 'artifact.txt'], { cwd: repository })).code, 0)
    assert.equal((await run('git', ['commit', '-m', 'fixture'], { cwd: repository })).code, 0)
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()
    await writeFile(join(repository, 'artifact.txt'), 'changed\n', 'utf8')

    await assert.rejects(
      integrity.verifyFilesAtCommit(repository, ['artifact.txt'], head),
      /does not match source commit/,
    )
  })

  test('vendor tree and a freshly packed plugin are tied to the current source commit', async t => {
    const output = await mkdtemp(join(tmpdir(), 'report-studio-pack-test-'))
    t.after(() => rm(output, { recursive: true, force: true }))

    const npmCommand = process.platform === 'win32' ? process.execPath : 'npm'
    const npmPrefix = process.platform === 'win32'
      ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : []
    const packed = await run(npmCommand, [...npmPrefix, 'pack', './packages/studio-dsh-plugin', '--pack-destination', output, '--json'], { cwd: root })
    assert.equal(packed.code, 0, packed.stderr || packed.stdout)
    const jsonStart = packed.stdout.search(/\[\s*\{\s*"id"/)
    assert.notEqual(jsonStart, -1, packed.stdout)
    const packageName = JSON.parse(packed.stdout.slice(jsonStart))[0].filename
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
    const vendor = await integrity.verifyVendorTree(root)
    const artifact = await integrity.verifyPackedPlugin({
      root,
      packagePath: join(output, packageName),
      sourceCommit: head,
      dshVersion: '0.1.1-rc.2',
      buildCommand: 'npm pack ./packages/studio-dsh-plugin',
    })

    assert.equal(artifact.sourceCommit, head)
    assert.equal(artifact.vendorSourceHash, vendor.vendorSourceHash)
    assert.equal(artifact.contractSchemaHash, '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc')
    assert.ok(artifact.fileCount > 0)
    assert.ok(artifact.sizeBytes > 0)
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/)
  })
}
