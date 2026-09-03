
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeSchemaSetHash, PACKAGE_NAME, STANDARD_NAME, STANDARD_VERSION, validateProjectDirectoryWithAjv } from '../src/index.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = path.resolve(packageRoot, '../..')
const npmInvocation = process.platform === 'win32'
  ? { command: process.execPath, prefix: [process.env.npm_execpath].filter(Boolean) }
  : { command: 'npm', prefix: [] }
function run(command, args, options = {}) { return execFileSync(command, args, { cwd: options.cwd ?? packageRoot, encoding: 'utf8', stdio: options.stdio ?? 'pipe', env: process.env }) }
function requireCondition(value, message) { if (!value) throw new Error(message) }
function findPython() {
  const candidates = process.platform === 'win32'
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]]
  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, '--version'], { stdio: 'ignore' })
    if (!probe.error && probe.status === 0) return { command, prefix }
  }
  throw new Error('Python 3 is required for JSON Schema metaschema verification')
}

const forbiddenGovernance = ['snapshotRevision','lastModifiedRevision','syncOrigin','baseRevision','presentationRevision','UpstreamSyncRecord','assessUpstreamRefresh']
const schemaRoot = path.join(packageRoot, 'schemas', STANDARD_VERSION)
const schemas = (await readdir(schemaRoot)).filter(name => name.endsWith('.schema.json')).sort()
requireCondition(STANDARD_NAME === 'Presentation Standard Project Directory', 'standard name contains an obsolete version suffix')
requireCondition(STANDARD_VERSION === '0.1.0', 'standard version mismatch')
const schemaText = (await Promise.all(schemas.map(name => readFile(path.join(schemaRoot, name), 'utf8')))).join('\n')
for (const token of forbiddenGovernance) requireCondition(!schemaText.includes(`"${token}"`), `canonical schemas contain governance field ${token}`)
for (const token of ['font','fontSize','color','"x"','"y"','"w"','"h"','templateName','layoutName','pptMaster','css']) {
  const draft = await readFile(path.join(schemaRoot, 'draft-page-document.schema.json'), 'utf8')
  requireCondition(!draft.includes(`"${token}"`), `DraftPageDocument contains layout property ${token}`)
}

const actualHash = await computeSchemaSetHash(schemaRoot)
const expectedHash = (await readFile(path.join(packageRoot, 'SCHEMASET.sha256'), 'utf8')).trim().split(/\s+/)[0]
requireCondition(actualHash === expectedHash, 'schema-set SHA-256 mismatch')
console.log(`versions=PASS standard=${STANDARD_VERSION}`)
console.log(`schemaSet=PASS sha256=${actualHash}`)
const python = findPython()
process.stdout.write(run(python.command, [...python.prefix, path.join(packageRoot, 'scripts/verify-json-schema.py')]))

const projects = [
  ['minimalProject', path.join(packageRoot, 'fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project')],
  ['fullExample', path.join(packageRoot, 'examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief')],
]
for (const [label, project] of projects) {
  const result = await validateProjectDirectoryWithAjv(project, { allowGitKeep: true })
  requireCondition(result.valid, `${label} failed: ${JSON.stringify(result.errors)}`)
  console.log(`${label}=PASS documents=${result.checkedDocuments} managedFiles=${result.checkedManagedFiles}`)
}

const testFiles = (await readdir(path.join(packageRoot, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join('tests', name))
const tests = run(process.execPath, ['--test', ...testFiles], { cwd: packageRoot })
const count = tests.match(/(?:#|ℹ) tests (\d+)/u)?.[1] ?? 'unknown'
console.log(`nodeTests=PASS tests=${count}`)

requireCondition(process.platform !== 'win32' || npmInvocation.prefix.length === 1, 'npm_execpath is required for Windows verification')
const packResult = JSON.parse(run(npmInvocation.command, [...npmInvocation.prefix, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: packageRoot }))
const files = new Set(packResult[0].files.map(item => item.path))
for (const required of ['STANDARD_VERSION','SCHEMASET.sha256','contract-manifest.json','src/index.mjs','src/index.d.ts','bin/presentation-contracts.mjs','fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project/project.json','examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/project.json']) requireCondition(files.has(required), `npm pack omits ${required}`)
console.log(`npmPack=PASS files=${files.size}`)

const temp = await mkdtemp(path.join(os.tmpdir(), 'presentation-consumer-'))
try {
  const packed = JSON.parse(run(npmInvocation.command, [...npmInvocation.prefix, 'pack', '--json', '--ignore-scripts', '--pack-destination', temp], { cwd: packageRoot }))
  const tarball = path.join(temp, packed[0].filename)
  await writeFile(path.join(temp, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  run(npmInvocation.command, [...npmInvocation.prefix, 'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: temp })
  await writeFile(path.join(temp, 'consumer.mjs'), `import { STANDARD_VERSION, createProjectDirectoryPlan } from '${PACKAGE_NAME}'\nif (STANDARD_VERSION !== '0.1.0') process.exit(1)\nconst plan=createProjectDirectoryPlan({name:'Consumer',projectSlug:'consumer'})\nif(Object.keys(plan.documents).length!==6) process.exit(2)\n`)
  run(process.execPath, ['consumer.mjs'], { cwd: temp })
  console.log('independentConsumer=PASS')
} finally { await rm(temp, { recursive: true, force: true }) }

const manifest = JSON.parse(await readFile(path.join(packageRoot, 'contract-manifest.json'), 'utf8'))
requireCondition(manifest.standardVersion === STANDARD_VERSION && manifest.packageVersion === STANDARD_VERSION && manifest.schemaSetSha256 === actualHash, 'contract manifest version/hash mismatch')
const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
requireCondition(packageJson.version === STANDARD_VERSION && packageJson.name === PACKAGE_NAME, 'npm package identity mismatch')
console.log('manifestAndPackage=PASS')
console.log('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS')
