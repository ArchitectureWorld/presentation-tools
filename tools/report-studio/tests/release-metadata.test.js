const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { verifyReleaseMetadata } = require('../scripts/verify-release-metadata.js')

test('release metadata, package version, build metadata and artifact checksums are consistent', () => {
  const root = path.resolve(__dirname, '..')
  const result = verifyReleaseMetadata(root)

  assert.equal(result.version, '0.8.1')
  assert.equal(result.artifacts.length, 1)
  assert.equal(result.ok, true)
})
