import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OPENPENCIL_ADAPTER_VERSION,
  OpenPencilAdapterError,
  compileOpenPencilCreateTransaction,
  compileOpenPencilFramePatchTransaction,
  createOpenPencilEngineBinding,
  mapOpenPencilSelection,
} from './index.mjs'

const hasCode = code => error => error instanceof OpenPencilAdapterError && error.code === code
const hash = value => `sha256:${value.repeat(64).slice(0, 64)}`

const ids = {
  layoutPage: 'layout_page_01992a80-0000-7000-8000-000000000101',
  title: 'layout_element_01992a80-0000-7000-8000-000000000201',
  image: 'layout_element_01992a80-0000-7000-8000-000000000202',
  shape: 'layout_element_01992a80-0000-7000-8000-000000000203',
  group: 'layout_element_01992a80-0000-7000-8000-000000000204',
}

function renderPlan() {
  return {
    layoutPageId: ids.layoutPage,
    projectId: 'project_01992a80-0000-7000-8000-000000000001',
    pageId: 'page_01992a80-0000-7000-8000-000000000002',
    canvas: { width: 1600, height: 900, unit: 'studio_unit' },
    elements: [
      {
        layoutElementId: ids.title,
        type: 'text',
        frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
        style: {
          fontFamily: 'Source Han Sans SC',
          fontSize: 52,
          fontWeight: 700,
          textAlign: 'left',
          textColor: '#111827',
          dangerousPrivateStyle: 'must-not-pass',
        },
        zIndex: 10,
        syncPolicy: 'live',
        elementState: 'normal',
        sourceKey: 'content-block:content_block_title',
        payload: { kind: 'text', sourceType: 'heading', role: 'page_title', content: '总体技术方案' },
      },
      {
        layoutElementId: ids.image,
        type: 'image',
        frame: { x: 900, y: 120, width: 560, height: 420, rotation: 0 },
        style: { fit: 'cover', cornerRadius: 24, opacity: 0.96 },
        zIndex: 8,
        syncPolicy: 'live',
        elementState: 'normal',
        sourceKey: 'page-asset:page_asset_001',
        payload: {
          kind: 'asset',
          pageAssetId: 'page_asset_001',
          assetId: 'asset_001',
          caption: '总体架构图',
          objectRef: { sha256: 'b'.repeat(64), sizeBytes: 1024, mimeType: 'image/png' },
          metadata: { widthPx: 2400, heightPx: 1350 },
        },
      },
      {
        layoutElementId: ids.shape,
        type: 'shape',
        frame: { x: 96, y: 720, width: 420, height: 4, rotation: 0 },
        style: { fill: '#7357F5', opacity: 1 },
        zIndex: 2,
        syncPolicy: 'detached',
        elementState: 'normal',
        sourceKey: null,
        payload: { shapeKind: 'rectangle' },
      },
      {
        layoutElementId: ids.group,
        type: 'group',
        frame: { x: 80, y: 56, width: 1440, height: 760, rotation: 0 },
        style: { opacity: 1 },
        zIndex: 0,
        syncPolicy: 'detached',
        elementState: 'normal',
        sourceKey: null,
        payload: { label: 'Page Group' },
      },
    ],
  }
}

const assetUrlResolver = payload => `http://127.0.0.1:3080/report-studio/assets/${payload.objectRef.sha256}`

function transaction() {
  return compileOpenPencilCreateTransaction(renderPlan(), { assetUrlResolver })
}

function executionResult(value = transaction()) {
  return {
    results: [
      { binding: value.rootBinding, nodeId: 'op-root-001' },
      ...value.expectedBindings.map((entry, index) => ({ binding: entry.bindingKey, nodeId: `op-node-${index + 1}` })),
    ],
    nodeCount: value.expectedBindings.length + 1,
  }
}

function bindingMetadata() {
  return {
    layoutPageId: ids.layoutPage,
    engineDocumentRef: { provider: 'openpencil', documentId: 'document-001', contentHash: null },
    generatedFromRevision: 18,
    sourceStateHash: hash('c'),
  }
}

test('OpenPencil create transaction is deterministic and does not mutate the render plan', () => {
  const plan = renderPlan()
  const before = structuredClone(plan)
  const first = compileOpenPencilCreateTransaction(plan, { assetUrlResolver })
  const second = compileOpenPencilCreateTransaction(plan, { assetUrlResolver })
  assert.equal(first.adapterVersion, OPENPENCIL_ADAPTER_VERSION)
  assert.deepEqual(first, second)
  assert.deepEqual(plan, before)
  assert.equal(first.operations.split('\n').length, 5)
})

test('transaction creates one root frame and declares deterministic element bindings in one sandbox', () => {
  const value = transaction()
  assert.equal(value.rootBinding, 'rs_page')
  assert.match(value.operations.split('\n')[0], /^const rs_page=I\(null,/u)
  assert.equal(value.expectedBindings.length, 4)
  for (const [index, entry] of value.expectedBindings.entries()) {
    assert.match(entry.bindingKey, /^rs_el_[0-9a-f]{16}$/u)
    assert.match(value.operations.split('\n')[index + 1], new RegExp(`^const ${entry.bindingKey}=I\\(rs_page,`, 'u'))
  }
  assert.equal(new Set(value.expectedBindings.map(entry => entry.bindingKey)).size, 4)
})

test('text, image, shape and group map to explicit OpenPencil node types', () => {
  const operations = transaction().operations
  assert.match(operations, /"type":"text"/u)
  assert.match(operations, /"type":"image"/u)
  assert.match(operations, /"type":"rectangle"/u)
  assert.match(operations, /"type":"frame"/u)
  assert.match(operations, /"content":"总体技术方案"/u)
  assert.match(operations, /"src":"http:\/\/127\.0\.0\.1:3080\/report-studio\/assets\//u)
})

test('only whitelisted style fields enter OpenPencil operations', () => {
  const operations = transaction().operations
  assert.match(operations, /"fontSize":52/u)
  assert.doesNotMatch(operations, /dangerousPrivateStyle/u)
})

test('image compilation rejects Data URLs', () => {
  assert.throws(
    () => compileOpenPencilCreateTransaction(renderPlan(), { assetUrlResolver: () => 'data:image/png;base64,AA==' }),
    hasCode('openpencil_asset_url_forbidden'),
  )
})

test('image compilation rejects host file-system paths', () => {
  assert.throws(
    () => compileOpenPencilCreateTransaction(renderPlan(), { assetUrlResolver: () => 'C:\\private\\asset.png' }),
    hasCode('openpencil_asset_url_forbidden'),
  )
})

test('image compilation requires an asset URL resolver', () => {
  assert.throws(() => compileOpenPencilCreateTransaction(renderPlan()), hasCode('openpencil_asset_url_unavailable'))
})

test('unsupported layout element types fail instead of being guessed', () => {
  const plan = renderPlan()
  plan.elements[0].type = 'video'
  assert.throws(() => compileOpenPencilCreateTransaction(plan, { assetUrlResolver }), hasCode('openpencil_unsupported_element_type'))
})

test('complete OpenPencil execution result creates a one-to-one engine binding', () => {
  const value = transaction()
  const binding = createOpenPencilEngineBinding(value, executionResult(value), bindingMetadata())
  assert.equal(binding.engine, 'openpencil')
  assert.equal(binding.rootEngineNodeId, 'op-root-001')
  assert.equal(binding.nodeMap.length, value.expectedBindings.length)
  assert.equal(binding.nodeMap[0].layoutElementId, value.expectedBindings[0].layoutElementId)
})

test('execution result rejects missing, unknown and duplicate bindings', () => {
  const value = transaction()
  const missing = executionResult(value)
  missing.results.pop()
  assert.throws(() => createOpenPencilEngineBinding(value, missing, bindingMetadata()), hasCode('openpencil_missing_binding'))

  const unknown = executionResult(value)
  unknown.results.push({ binding: 'unknown_binding', nodeId: 'op-node-extra' })
  assert.throws(() => createOpenPencilEngineBinding(value, unknown, bindingMetadata()), hasCode('openpencil_unknown_binding'))

  const duplicate = executionResult(value)
  duplicate.results.push({ ...duplicate.results[1], nodeId: 'op-node-duplicate-binding' })
  assert.throws(() => createOpenPencilEngineBinding(value, duplicate, bindingMetadata()), hasCode('openpencil_duplicate_result_binding'))
})

test('execution result rejects duplicate private engine node identities', () => {
  const value = transaction()
  const result = executionResult(value)
  result.results[2].nodeId = result.results[1].nodeId
  assert.throws(() => createOpenPencilEngineBinding(value, result, bindingMetadata()), hasCode('openpencil_duplicate_engine_node'))
})

test('frame patch transaction updates only mapped geometry in deterministic order', () => {
  const value = transaction()
  const binding = createOpenPencilEngineBinding(value, executionResult(value), bindingMetadata())
  const patch = compileOpenPencilFramePatchTransaction(binding, [
    { layoutElementId: ids.title, frame: { x: 120, y: 80, width: 760, height: 100, rotation: 0 } },
    { layoutElementId: ids.shape, frame: { x: 100, y: 730, width: 440, height: 6, rotation: 0 } },
  ])
  assert.equal(patch.operations.split('\n').length, 2)
  assert.match(patch.operations, /^U\("op-node-/u)
  assert.doesNotMatch(patch.operations, /content|style|sourceRef/u)
  assert.deepEqual(patch.changes.map(change => Object.keys(change).sort()), [
    ['frame', 'layoutElementId'],
    ['frame', 'layoutElementId'],
  ])
})

test('frame patch rejects empty changes and unmapped layout elements', () => {
  const value = transaction()
  const binding = createOpenPencilEngineBinding(value, executionResult(value), bindingMetadata())
  assert.throws(() => compileOpenPencilFramePatchTransaction(binding, []), hasCode('openpencil_empty_patch'))
  assert.throws(() => compileOpenPencilFramePatchTransaction(binding, [
    { layoutElementId: 'layout_element_missing', frame: { x: 0, y: 0, width: 10, height: 10, rotation: 0 } },
  ]), hasCode('openpencil_unmapped_layout_element'))
})

test('OpenPencil selection maps back to LayoutElement identities without guessing', () => {
  const value = transaction()
  const binding = createOpenPencilEngineBinding(value, executionResult(value), bindingMetadata())
  assert.deepEqual(mapOpenPencilSelection(binding, ['op-node-2', 'op-root-001', 'engine-private-child']), {
    layoutElementIds: [value.expectedBindings[1].layoutElementId],
    unmappedEngineNodeIds: ['op-root-001', 'engine-private-child'],
  })
})
