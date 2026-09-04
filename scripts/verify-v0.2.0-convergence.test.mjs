import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const layoutPackages = [
  'studio-layout-contracts',
  'studio-layout-core',
  'studio-layout-adapter',
  'studio-layout-integration',
  'studio-layout-engine-binding',
  'studio-layout-openpencil',
]

async function json(path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'))
}

async function exists(path) {
  try {
    await access(join(root, path), constants.F_OK)
    return true
  } catch {
    return false
  }
}

test('v0.2.0 convergence uses the OpenPencil Node floor and deterministic repository verification', async () => {
  const packageJson = await json('package.json')
  const packageLock = await json('package-lock.json')

  assert.equal(packageJson.version, '0.2.0-alpha.3')
  assert.equal(packageJson.engines?.node, '>=24.11.0')
  assert.equal(packageLock.version, '0.2.0-alpha.3')
  assert.equal(packageLock.packages?.['']?.version, '0.2.0-alpha.3')
  assert.equal(packageLock.packages?.['']?.engines?.node, '>=24.11.0')
  assert.match(packageJson.scripts?.test ?? '', /--test-concurrency=1/u)
  assert.match(packageJson.scripts?.['verify:all'] ?? '', /npm run verify:layout/u)
  assert.match(packageJson.scripts?.['verify:layout'] ?? '', /studio-layout-integration/u)

  for (const packageName of layoutPackages) {
    const manifest = await json(`packages/${packageName}/package.json`)
    assert.equal(manifest.version, '0.2.0-alpha.3', packageName)
    assert.equal(manifest.engines?.node, '>=24.11.0', packageName)
  }
})

test('all v0.2.0 CI execution paths use Node 24.11 or newer', async () => {
  const productWorkflow = await readFile(join(root, '.github/workflows/report-studio-v0.1.1-ci.yml'), 'utf8')
  const layoutWorkflow = await readFile(join(root, '.github/workflows/report-studio-v0.2.0-layout-ci.yml'), 'utf8')
  assert.match(productWorkflow, /node-version:\s*'24\.11\.0'/u)
  assert.match(layoutWorkflow, /node-version:\s*'24\.11\.0'/u)
  assert.match(productWorkflow, /Run the complete v0\.2\.0 convergence gate/u)
})

test('pre-design Contract remains frozen while Presentation owns the project-to-layout bridge', async () => {
  assert.equal(await exists('contracts/presentation-standard-project/STANDARD_VERSION'), true)
  assert.equal((await readFile(join(root, 'contracts/presentation-standard-project/STANDARD_VERSION'), 'utf8')).trim(), '0.1.0')
  const schemaHash = (await readFile(join(root, 'contracts/presentation-standard-project/SCHEMASET.sha256'), 'utf8')).trim().split(/\s+/u)[0]
  assert.equal(schemaHash, '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc')

  const contract = await readFile(join(root, 'docs/architecture/report-studio-v0.2.0-layout-integration-contract.md'), 'utf8')
  assert.match(contract, /PROJECT_ID_STANDARD_IMPACT=NO_SCHEMA_CHANGE/u)
  assert.match(contract, /PRE_DESIGN_CHANGE_REQUIRED=NO/u)
  assert.match(contract, /CanonicalSnapshot\.project\.projectId/u)
  assert.match(contract, /buildLayoutSourceProjection/u)
})
