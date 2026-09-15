import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'))
const integrity = await import('./release-integrity.mjs').catch(() => null)
const DSH_VERSION = '0.1.5-rc.1'
const REPORT_STUDIO_WORKFLOW = 'report-studio-v0.2.0-runtime-ci.yml'
const REPORT_STUDIO_WORKFLOW_NAME = 'Report Studio v0.2.0 Runtime CI'
const STANDARD_WORKFLOW = 'presentation-standard-project-v0.1.0-ci.yml'

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

async function workflowFixture(t, prefix = 'report-studio-release-config-') {
  const configurationRoot = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(configurationRoot, { recursive: true, force: true }))
  await mkdir(join(configurationRoot, '.github', 'workflows'), { recursive: true })
  const [packageJson, packageLock, reportStudioWorkflow, standardWorkflow] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8'),
    readFile(join(root, 'package-lock.json'), 'utf8'),
    readFile(join(root, '.github', 'workflows', REPORT_STUDIO_WORKFLOW), 'utf8'),
    readFile(join(root, '.github', 'workflows', STANDARD_WORKFLOW), 'utf8'),
  ])
  async function write({ report = reportStudioWorkflow, standard = standardWorkflow } = {}) {
    await Promise.all([
      writeFile(join(configurationRoot, 'package.json'), packageJson, 'utf8'),
      writeFile(join(configurationRoot, 'package-lock.json'), packageLock, 'utf8'),
      writeFile(join(configurationRoot, '.github', 'workflows', REPORT_STUDIO_WORKFLOW), report, 'utf8'),
      writeFile(join(configurationRoot, '.github', 'workflows', STANDARD_WORKFLOW), standard, 'utf8'),
    ])
  }
  return { configurationRoot, reportStudioWorkflow, standardWorkflow, write }
}

test('release integrity API is available to enforce the packaging boundary', () => {
  assert.ok(integrity, 'scripts/release-integrity.mjs must exist')
})

if (integrity) {
  test('release configuration enforces clean installs and the active runtime workflow', async () => {
    const result = await integrity.verifyReleaseConfiguration(root)
    assert.equal(result.workflowName, REPORT_STUDIO_WORKFLOW_NAME)
    assert.equal(result.platforms.sort().join(','), 'ubuntu-latest,windows-latest')
  })

  test('release configuration requires the vendor manifest to trigger push verification', async t => {
    const fixture = await workflowFixture(t)
    const manifestPathLine = "      - 'scripts/dsh-plugin-vendor-manifest.mjs'"
    const report = fixture.reportStudioWorkflow.replace(
      new RegExp(`${manifestPathLine.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}\\r?\\n`),
      '',
    )
    assert.notEqual(report, fixture.reportStudioWorkflow, 'fixture must remove the push path filter')
    await fixture.write({ report })
    await assert.rejects(
      integrity.verifyReleaseConfiguration(fixture.configurationRoot),
      /push path filter missing scripts\/dsh-plugin-vendor-manifest\.mjs/,
    )
  })

  test('release configuration keeps Report Studio checks available on every pull request', async t => {
    const fixture = await workflowFixture(t, 'report-studio-unconditional-pr-test-')
    const report = fixture.reportStudioWorkflow.replace(
      /^  pull_request:\r?\n/m,
      "  pull_request:\n    paths:\n      - 'package.json'\n",
    )
    await fixture.write({ report })
    await assert.rejects(
      integrity.verifyReleaseConfiguration(fixture.configurationRoot),
      /Report Studio workflow pull_request must run without path filters/,
    )
  })

  test('release configuration rejects the Standard Project workflow when root dependencies are absent before verify:all', async t => {
    const fixture = await workflowFixture(t, 'report-studio-standard-workflow-test-')
    const standard = fixture.standardWorkflow.replace(
      /^          npm ci --ignore-scripts --no-audit --no-fund\r?\n/m,
      '',
    )
    await fixture.write({ standard })
    await assert.rejects(
      integrity.verifyReleaseConfiguration(fixture.configurationRoot),
      /Standard Project workflow must install root dependencies before verify:all/,
    )
  })

  test('release configuration requires pinned Python Contract dependencies before verify:all', async t => {
    const fixture = await workflowFixture(t, 'report-studio-python-workflow-test-')
    await fixture.write({
      report: fixture.reportStudioWorkflow.replace(
        /      - uses: actions\/setup-python@v5\r?\n        with:\r?\n          python-version: '3\.12'\r?\n/,
        '',
      ),
    })
    await assert.rejects(
      integrity.verifyReleaseConfiguration(fixture.configurationRoot),
      /Report Studio workflow must set up Python 3\.12 before verify:all/,
    )

    await fixture.write({
      report: fixture.reportStudioWorkflow.replace(
        /^          python -m pip install --disable-pip-version-check --no-input jsonschema==4\.26\.0 referencing==0\.37\.0\r?\n/m,
        '',
      ),
    })
    await assert.rejects(
      integrity.verifyReleaseConfiguration(fixture.configurationRoot),
      /Report Studio workflow must install pinned Python Contract dependencies before verify:all/,
    )
  })

  test('release configuration accepts CRLF workflow files', async t => {
    const fixture = await workflowFixture(t, 'report-studio-crlf-workflow-test-')
    await fixture.write({
      report: fixture.reportStudioWorkflow.replace(/\r?\n/g, '\n').replace(/\n/g, '\r\n'),
      standard: fixture.standardWorkflow.replace(/\r?\n/g, '\n').replace(/\n/g, '\r\n'),
    })
    const result = await integrity.verifyReleaseConfiguration(fixture.configurationRoot)
    assert.equal(result.workflowName, REPORT_STUDIO_WORKFLOW_NAME)
  })

  test('release configuration rejects a Report Studio workflow that omits pinned pnpm before DSH smoke', async t => {
    const fixture = await workflowFixture(t, 'report-studio-pnpm-workflow-test-')
    const report = fixture.reportStudioWorkflow.replace(
      /      - uses: pnpm\/action-setup@v4\r?\n        with:\r?\n          version: '9\.15\.4'\r?\n/,
      '',
    )
    await fixture.write({ report })
    await assert.rejects(
      integrity.verifyReleaseConfiguration(fixture.configurationRoot),
      /Report Studio workflow must install pnpm 9\.15\.4 before DSH smoke/,
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

  test('vendor tree and a freshly packed plugin are tied to the current source commit and DSH baseline', async t => {
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
      dshVersion: DSH_VERSION,
      buildCommand: 'npm pack ./packages/studio-dsh-plugin',
    })

    assert.equal(artifact.sourceCommit, head)
    assert.equal(artifact.dshVersion, DSH_VERSION)
    assert.equal(artifact.vendorSourceHash, vendor.vendorSourceHash)
    assert.equal(artifact.contractSchemaHash, '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc')
    assert.ok(artifact.fileCount > 0)
    assert.ok(artifact.sizeBytes > 0)
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/)
  })
}

test('package verification treats a colon in an archive name as a local path, not a remote host', async t => {
  if (process.platform === 'win32') { t.skip('Windows drive paths are covered by the full pack verification'); return }
  const output = await mkdtemp(join(tmpdir(), 'studio-colon-archive-'))
  t.after(() => rm(output, { recursive: true, force: true }))
  const packed = await run('npm', ['pack', './packages/studio-dsh-plugin', '--pack-destination', output, '--json'], { cwd: root })
  assert.equal(packed.code, 0, packed.stderr)
  const filename = JSON.parse(packed.stdout.slice(packed.stdout.search(/\[\s*\{\s*"id"/)))[0].filename
  const packagePath = join(output, 'C:archive.tgz')
  await copyFile(join(output, filename), packagePath)
  const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  const previous = process.cwd()
  try {
    process.chdir(output)
    const artifact = await integrity.verifyPackedPlugin({
      root,
      packagePath: 'C:archive.tgz',
      sourceCommit: head,
      dshVersion: DSH_VERSION,
      buildCommand: 'npm pack',
      allowDirtySource: true,
    })
    assert.equal(artifact.dshVersion, DSH_VERSION)
    assert.ok(artifact.fileCount > 0)
  } finally {
    process.chdir(previous)
  }
})
