import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  OpenPencilRuntimeSmokeError,
  assertCapabilityUrl,
  assertIsolatedRuntimeContext,
  assertLoopbackUrl,
  assertPinnedDependency,
  createCapabilityServer,
  validateDocumentLifecycle,
  validateRealExecutionResult,
} from './index.mjs'

const expectCode = code => error => error instanceof OpenPencilRuntimeSmokeError && error.code === code
const temporaryRoots = new Set()

after(async () => {
  await Promise.all([...temporaryRoots].map(root => rm(root, { recursive: true, force: true })))
})

async function runtimeContext() {
  const root = await mkdtemp(join(tmpdir(), 'rs-runtime-contract-'))
  temporaryRoots.add(root)
  const dirs = {}
  for (const name of ['runtime', 'dshHome', 'config', 'data', 'cache', 'documents', 'logs', 'browserProfile', 'artifacts']) {
    dirs[name] = join(root, name)
    await mkdir(dirs[name], { recursive: true })
  }
  return {
    root,
    productionDshHome: join(tmpdir(), 'production-dsh-home'),
    ...dirs,
    environment: {
      USERPROFILE: dirs.dshHome,
      APPDATA: dirs.config,
      LOCALAPPDATA: dirs.data,
      TEMP: dirs.cache,
      TMP: dirs.cache,
      npm_config_cache: join(dirs.cache, 'npm'),
    },
  }
}

const transaction = {
  rootBinding: 'rs_page',
  expectedBindings: [
    { bindingKey: 'rs_el_aaaaaaaaaaaaaaaa', layoutElementId: 'layout_element_title' },
  ],
}

test('rejects a runtime context that can write outside the ephemeral root', async () => {
  const context = await runtimeContext()
  context.environment.USERPROFILE = resolve(context.root, '..', 'outside')
  assert.throws(() => assertIsolatedRuntimeContext(context), expectCode('runtime_non_isolated_home'))
})

test('rejects non-loopback service addresses', () => {
  assert.throws(() => assertLoopbackUrl('http://0.0.0.0:43123'), expectCode('runtime_non_loopback_address'))
  assert.throws(() => assertLoopbackUrl('https://example.test:43123'), expectCode('runtime_non_loopback_address'))
  assert.equal(assertLoopbackUrl('http://127.0.0.1:43123/path').hostname, '127.0.0.1')
})

test('rejects floating dependency coordinates', () => {
  assert.throws(() => assertPinnedDependency({ dependencies: { demo: '^1.2.3' } }, 'demo', '1.2.3'), expectCode('runtime_floating_dependency'))
  assert.throws(() => assertPinnedDependency({ dependencies: {} }, 'demo', '1.2.3'), expectCode('runtime_dependency_missing'))
  assert.doesNotThrow(() => assertPinnedDependency({ dependencies: { demo: '1.2.3' } }, 'demo', '1.2.3'))
})

test('rejects forged or incomplete execution results before binding', () => {
  assert.throws(
    () => validateRealExecutionResult(transaction, { results: [] }, { real: false, runtime: 'mock', capability: 'batch_design' }),
    expectCode('runtime_forged_result'),
  )
  assert.throws(
    () => validateRealExecutionResult(transaction, { results: [] }, { real: true, runtime: 'dsh-openpencil', capability: 'selection' }),
    expectCode('runtime_capability_mismatch'),
  )
  assert.throws(
    () => validateRealExecutionResult(transaction, { results: [] }, { real: true, runtime: 'dsh-openpencil', capability: 'batch_design' }),
    expectCode('runtime_missing_binding'),
  )
})

test('rejects duplicate and unknown result bindings', () => {
  const meta = { real: true, runtime: 'dsh-openpencil', capability: 'batch_design' }
  const base = { results: [
    { binding: 'rs_page', nodeId: 'node-root' },
    { binding: 'rs_el_aaaaaaaaaaaaaaaa', nodeId: 'node-title' },
  ] }
  assert.deepEqual(validateRealExecutionResult(transaction, base, meta), {
    rootNodeId: 'node-root',
    nodeIds: ['node-title'],
  })
  assert.throws(() => validateRealExecutionResult(transaction, {
    results: [...base.results, { binding: 'rs_el_aaaaaaaaaaaaaaaa', nodeId: 'node-extra' }],
  }, meta), expectCode('runtime_duplicate_binding'))
  assert.throws(() => validateRealExecutionResult(transaction, {
    results: [...base.results, { binding: 'unknown', nodeId: 'node-extra' }],
  }, meta), expectCode('runtime_unknown_binding'))
})

test('capability server only exposes a temporary fixture through a short-lived loopback URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rs-capability-contract-'))
  temporaryRoots.add(root)
  const assetPath = join(root, 'fixture.png')
  await writeFile(assetPath, Buffer.from('fixture'))
  const server = await createCapabilityServer({ root, assetPath, ttlMs: 250 })
  try {
    const url = server.url
    assert.equal(assertCapabilityUrl(url, server.origin).origin, server.origin)
    assert.equal((await fetch(url)).status, 200)
    assert.equal((await fetch(`${server.origin}/cap/${encodeURIComponent('..\\fixture.png')}`)).status, 404)
    assert.throws(() => assertCapabilityUrl('data:image/png;base64,AA==', server.origin), expectCode('runtime_capability_url_forbidden'))
    assert.throws(() => assertCapabilityUrl(`${server.origin}/../fixture.png`, server.origin), expectCode('runtime_capability_url_forbidden'))
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal((await fetch(url)).status, 410)
  } finally {
    await server.close()
  }
})

test('frame patch changes geometry only and preserves content, style, other nodes and binding ids', () => {
  const before = {
    documentId: 'doc-1',
    nodes: [
      { id: 'node-title', x: 10, y: 20, width: 100, height: 30, rotation: 0, content: 'Title', style: { color: '#111' } },
      { id: 'node-body', x: 40, y: 80, width: 200, height: 50, rotation: 0, content: 'Body', style: { color: '#222' } },
    ],
    binding: { nodeMap: [
      { layoutElementId: 'layout_element_title', engineNodeId: 'node-title' },
      { layoutElementId: 'layout_element_body', engineNodeId: 'node-body' },
    ] },
  }
  const after = structuredClone(before)
  Object.assign(after.nodes[0], { x: 16, y: 24, width: 120, height: 36, rotation: 2 })
  const patch = { changes: [{ layoutElementId: 'layout_element_title', frame: { x: 16, y: 24, width: 120, height: 36, rotation: 2 } }] }
  assert.equal(validateDocumentLifecycle(before, after, patch), true)
  after.nodes[0].content = 'Changed'
  assert.throws(() => validateDocumentLifecycle(before, after, patch), expectCode('runtime_document_content_changed'))
})
