import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyLayoutOpenPencilRuntime } from './verify-layout-openpencil-runtime-v0.2.0.mjs'

test('runtime verifier explicitly reports skipped when no fixed runtime is installed outside the release gate', async () => {
  const result = await verifyLayoutOpenPencilRuntime({
    env: {},
    resolveRuntime: async () => { throw Object.assign(new Error('missing runtime'), { code: 'layout_engine_unavailable' }) },
  })
  assert.deepEqual(result, {
    status: 'skipped',
    required: false,
    code: 'layout_engine_unavailable',
    message: 'missing runtime',
  })
})

test('runtime verifier fails closed when REQUIRE_REAL_OPENPENCIL=1', async () => {
  await assert.rejects(
    verifyLayoutOpenPencilRuntime({
      env: { REQUIRE_REAL_OPENPENCIL: '1' },
      resolveRuntime: async () => { throw Object.assign(new Error('missing runtime'), { code: 'layout_engine_unavailable' }) },
    }),
    error => error.code === 'layout_engine_unavailable',
  )
})

test('runtime verifier returns real smoke evidence when the pinned runtime is available', async () => {
  const runtime = { root: '/runtime' }
  const evidence = { status: 'passed', editor: true }
  const result = await verifyLayoutOpenPencilRuntime({
    env: { REQUIRE_REAL_OPENPENCIL: '1' },
    resolveRuntime: async options => { assert.equal(options.packageRoot, '/fixed'); return runtime },
    runSmoke: async options => { assert.equal(options.runtime, runtime); return evidence },
    packageRoot: '/fixed',
  })
  assert.equal(result, evidence)
})
