import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DSH_PLUGIN_VENDOR_ENTRIES } from './dsh-plugin-vendor-manifest.mjs'

const execFileAsync = promisify(execFile)
const EXPECTED_SCHEMA_HASH = '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc'
const EXPECTED_PLUGIN_NAME = '@architectureworld/report-studio-dsh'
const EXPECTED_PLUGIN_VERSION = '0.1.1'

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function listFiles(root) {
  const found = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...await listFiles(path))
    else if (entry.isFile()) found.push(path)
  }
  return found.sort()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function aggregateFiles(root, files) {
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    const name = relative(root, file).split(sep).join('/')
    hash.update(name)
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

export async function resolveRequiredPluginPackage(configured, root = process.cwd()) {
  const value = configured?.trim()
  if (!value) throw new Error('REPORT_STUDIO_PLUGIN_PACKAGE is required; dist and source fallbacks are forbidden')
  const target = resolve(root, value)
  await access(target, constants.R_OK)
  return target
}

export async function verifyReleaseConfiguration(root) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  for (const [name, version] of Object.entries({ ajv: '8.17.1', 'ajv-formats': '3.0.1' })) {
    assertCondition(packageJson.devDependencies?.[name] === version, `root package must pin ${name}@${version}`)
    assertCondition(packageLock.packages?.['']?.devDependencies?.[name] === version, `root lockfile must pin ${name}@${version}`)
  }

  const oldWorkflow = join(root, '.github', 'workflows', 'report-studio-v0.1.0-ci.yml')
  assertCondition(!await exists(oldWorkflow), 'legacy Report Studio v0.1.0 workflow must be removed')
  const workflowPath = join(root, '.github', 'workflows', 'report-studio-v0.1.1-ci.yml')
  const workflow = await readFile(workflowPath, 'utf8')
  const requiredPaths = [
    'apps/studio-local/**',
    'packages/studio-contracts/**',
    'packages/studio-core/**',
    'packages/studio-standard-adapter/**',
    'packages/studio-dsh-plugin/**',
    'contracts/presentation-standard-project/**',
    'scripts/verify-v0.1.1.mjs',
    'scripts/verify-e2e-v0.1.1.mjs',
    'scripts/verify-responsive-ui.mjs',
    'scripts/verify-dsh-plugin.mjs',
    'scripts/build-dsh-plugin-vendor.mjs',
    'scripts/dsh-plugin-vendor-manifest.mjs',
    'scripts/smoke-dsh-native.mjs',
    'package.json',
    'package-lock.json',
    'README.md',
    'DSH_INSTALL.md',
    '.github/workflows/report-studio-v0.1.1-ci.yml',
  ]
  assertCondition(/^name:\s*Report Studio v0\.1\.1 CI\s*$/m.test(workflow), 'workflow name must be Report Studio v0.1.1 CI')
  assertCondition(/^\s*push:\s*$/m.test(workflow) && /^\s*pull_request:\s*$/m.test(workflow), 'workflow must run for pushes and pull requests')
  const workflowLines = workflow.split(/\r?\n/)
  for (const trigger of ['push', 'pull_request']) {
    const triggerIndex = workflowLines.indexOf(`  ${trigger}:`)
    const pathsIndex = triggerIndex + 1
    assertCondition(triggerIndex >= 0 && workflowLines[pathsIndex] === '    paths:', `workflow ${trigger} paths block is missing`)
    const triggerPaths = new Set()
    for (let index = pathsIndex + 1; index < workflowLines.length; index += 1) {
      const match = workflowLines[index].match(/^      - '([^']+)'$/)
      if (!match) break
      triggerPaths.add(match[1])
    }
    for (const path of requiredPaths) {
      assertCondition(triggerPaths.has(path), `workflow ${trigger} path filter missing ${path}`)
    }
  }
  for (const command of [
    'npm ci',
    'npm ci --prefix contracts/presentation-standard-project --ignore-scripts --no-audit --no-fund',
    'npm run verify:all',
    'npm run sync:vendor',
    'git diff --exit-code -- packages/studio-dsh-plugin/vendor',
    'npm pack ./packages/studio-dsh-plugin',
    'REPORT_STUDIO_PLUGIN_PACKAGE',
  ]) assertCondition(workflow.includes(command), `workflow is missing ${command}`)

  const platforms = ['ubuntu-latest', 'windows-latest'].filter(platform => workflow.includes(platform))
  assertCondition(platforms.length === 2, 'workflow must verify ubuntu-latest and windows-latest')
  return { workflowName: 'Report Studio v0.1.1 CI', platforms }
}

export async function verifyVendorTree(root) {
  const pluginRoot = join(root, 'packages', 'studio-dsh-plugin')
  const vendorRoot = join(pluginRoot, 'vendor')
  const expectedVendorFiles = new Set()
  for (const entry of DSH_PLUGIN_VENDOR_ENTRIES) {
    const source = join(root, ...entry.split('/'))
    const sourceInfo = await stat(source)
    const sourceFiles = sourceInfo.isDirectory() ? await listFiles(source) : [source]
    for (const sourceFile of sourceFiles) {
      const sourceRelative = relative(root, sourceFile)
      const vendorFile = join(vendorRoot, sourceRelative)
      expectedVendorFiles.add(resolve(vendorFile))
      const [sourceBytes, vendorBytes] = await Promise.all([readFile(sourceFile), readFile(vendorFile)])
      assertCondition(sourceBytes.equals(vendorBytes), `vendor drift detected for ${sourceRelative}`)
    }
  }
  const actualVendorFiles = await listFiles(vendorRoot)
  for (const vendorFile of actualVendorFiles) {
    assertCondition(expectedVendorFiles.has(resolve(vendorFile)), `unexpected vendor file ${relative(vendorRoot, vendorFile)}`)
  }
  assertCondition(actualVendorFiles.length === expectedVendorFiles.size, 'vendor file inventory does not match authoritative sources')
  return {
    vendorSourceHash: await aggregateFiles(vendorRoot, actualVendorFiles),
    fileCount: actualVendorFiles.length,
  }
}

export async function verifyFilesAtCommit(root, files, sourceCommit) {
  for (const file of files) {
    const normalized = file.split(sep).join('/')
    try {
      await execFileAsync('git', ['ls-files', '--error-unmatch', '--', normalized], { cwd: root })
      await execFileAsync('git', ['diff', '--quiet', sourceCommit, '--', normalized], { cwd: root })
    } catch {
      throw new Error(`${normalized} does not match source commit ${sourceCommit}`)
    }
  }
}

async function tar(commandArgs, encoding = 'utf8') {
  const result = await execFileAsync('tar', commandArgs, { encoding, maxBuffer: 32 * 1024 * 1024 })
  return result.stdout
}

async function expectedPackageFiles(pluginRoot, packageJson) {
  const result = new Set(['package/package.json'])
  for (const pattern of packageJson.files) {
    const normalized = pattern.replace(/\/\*\*$/, '')
    const target = join(pluginRoot, normalized)
    const info = await stat(target)
    const files = info.isDirectory() ? await listFiles(target) : [target]
    for (const file of files) result.add(`package/${relative(pluginRoot, file).split(sep).join('/')}`)
  }
  return [...result].sort()
}

export async function verifyPackedPlugin({ root, packagePath, sourceCommit, dshVersion, buildCommand, artifactManifestPath, allowDirtySource = false }) {
  assertCondition(/^[a-f0-9]{40}$/i.test(sourceCommit), 'source commit must be a full Git SHA')
  const { stdout: headOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  assertCondition(headOutput.trim().toLowerCase() === sourceCommit.toLowerCase(), 'tarball source commit does not match current HEAD')
  const pluginRoot = join(root, 'packages', 'studio-dsh-plugin')
  const pluginPackage = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'))
  const entries = String(await tar(['-tf', packagePath])).split(/\r?\n/).filter(line => line && !line.endsWith('/')).sort()
  const expected = await expectedPackageFiles(pluginRoot, pluginPackage)
  assertCondition(JSON.stringify(entries) === JSON.stringify(expected), 'tarball file inventory does not match the declared package files')
  if (!allowDirtySource) {
    await verifyFilesAtCommit(root, expected.map(entry => join('packages', 'studio-dsh-plugin', entry.slice('package/'.length))), sourceCommit)
  }

  for (const entry of entries) {
    const relativeName = entry.slice('package/'.length)
    const packedBytes = await tar(['-xOf', packagePath, entry], null)
    const sourceBytes = await readFile(join(pluginRoot, relativeName))
    assertCondition(Buffer.from(packedBytes).equals(sourceBytes), `tarball content does not match current source: ${relativeName}`)
  }

  const packedPackage = JSON.parse(String(await tar(['-xOf', packagePath, 'package/package.json'])))
  assertCondition(packedPackage.name === EXPECTED_PLUGIN_NAME, `unexpected package name ${packedPackage.name}`)
  assertCondition(packedPackage.version === EXPECTED_PLUGIN_VERSION, `unexpected package version ${packedPackage.version}`)
  assertCondition(packedPackage.dependencies?.ajv === '8.17.1', 'tarball must pin ajv@8.17.1')
  assertCondition(packedPackage.dependencies?.['ajv-formats'] === '3.0.1', 'tarball must pin ajv-formats@3.0.1')
  for (const required of [
    'package/lib/index.js',
    'package/lib/client.js',
    'package/lib/runtime.js',
    'package/vendor/apps/studio-local/public/index.html',
    'package/vendor/apps/studio-local/public/app.js',
    'package/vendor/apps/studio-local/public/styles.css',
    'package/vendor/contracts/presentation-standard-project/SCHEMASET.sha256',
  ]) assertCondition(entries.includes(required), `tarball missing required runtime file ${required}`)

  const schemaHash = String(await tar(['-xOf', packagePath, 'package/vendor/contracts/presentation-standard-project/SCHEMASET.sha256'])).trim().split(/\s+/)[0]
  assertCondition(schemaHash === EXPECTED_SCHEMA_HASH, `unexpected Contract Schema Hash ${schemaHash}`)
  const vendor = await verifyVendorTree(root)
  const bytes = await readFile(packagePath)
  const artifact = {
    sourceCommit: sourceCommit.toLowerCase(),
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    fileCount: entries.length,
    nodeVersion: process.version,
    dshVersion,
    buildCommand,
    vendorSourceHash: vendor.vendorSourceHash,
    contractSchemaHash: schemaHash,
  }
  if (artifactManifestPath) {
    await writeFile(artifactManifestPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  }
  return artifact
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    options[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return options
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const args = parseArgs(process.argv.slice(2))
  if (args.configuration !== undefined) {
    const result = await verifyReleaseConfiguration(root)
    console.log(`Release configuration verification PASS platforms=${result.platforms.join(',')}`)
  } else {
    const packagePath = await resolveRequiredPluginPackage(args.package, root)
    const artifact = await verifyPackedPlugin({
      root,
      packagePath,
      sourceCommit: args['source-commit'],
      dshVersion: args['dsh-version'],
      buildCommand: args['build-command'],
      artifactManifestPath: args.manifest && resolve(root, args.manifest),
    })
    console.log(`Report Studio package integrity PASS ${JSON.stringify(artifact)}`)
  }
}
