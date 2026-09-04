import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const verifier = await import('./verify-workspace-live-link.mjs').catch(() => null)

test('Workspace Live Link verifier API exists', () => {
  assert.ok(verifier, 'scripts/verify-workspace-live-link.mjs must exist')
})

if (verifier) {
  test('Workspace Live Link verifier locks all 22 required acceptance gates', () => {
    assert.equal(verifier.REQUIRED_WORKSPACE_GATES.length, 22)
    assert.equal(new Set(verifier.REQUIRED_WORKSPACE_GATES.map(gate => gate.id)).size, 22)
    assert.deepEqual(
      verifier.REQUIRED_WORKSPACE_GATES.map(gate => gate.number),
      Array.from({ length: 22 }, (_, index) => index + 1),
    )
  })

  test('current repository satisfies fixed Contract, vendor, runtime, test and documentation configuration', async () => {
    const result = await verifier.verifyWorkspaceConfiguration(root)
    assert.equal(result.productVersion, '0.1.1')
    assert.equal(result.contractVersion, '0.1.0')
    assert.equal(result.contractCommit, '974668d308728386ea005c9e77d58ebff9372f0a')
    assert.equal(result.schemaSetSha256, '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc')
    assert.equal(result.gatesVerified, 22)
    assert.ok(result.vendorFileCount > 0)
  })
}
