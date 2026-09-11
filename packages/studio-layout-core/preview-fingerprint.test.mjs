import assert from 'node:assert/strict'
import { test } from 'node:test'

test('preview fingerprint binds every verification input and ignores object key order', async () => {
  const module = await import('./preview-fingerprint.mjs').catch(() => ({}))
  assert.equal(typeof module.createPreviewFingerprint, 'function', 'shared preview fingerprint must exist')
  const input = { candidateSha: 'a'.repeat(64), sha256: 'b'.repeat(64), rendererVersion: 'renderer-v1', canvas: { width: 1600, height: 900 }, fonts: [{ family: 'Arial', sha256: 'c'.repeat(64) }], materials: [{ pageAssetId: 'p', assetId: 'a', sha256: 'd'.repeat(64), mimeType: 'image/png' }], checksVersion: 'checks-v1', sourceStateHash: 'e'.repeat(64) }
  const hash = module.createPreviewFingerprint(input)
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(hash, module.createPreviewFingerprint({ ...input, canvas: { height: 900, width: 1600 } }))
  for (const key of Object.keys(input)) assert.notEqual(hash, module.createPreviewFingerprint({ ...input, [key]: null }), `${key} must be bound`)
  assert.throws(() => module.createPreviewFingerprint({ ...input, canvas: { width: NaN } }), /finite|JSON/)
})
