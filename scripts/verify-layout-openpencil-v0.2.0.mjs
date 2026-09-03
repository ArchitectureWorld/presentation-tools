#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  compileOpenPencilCreateTransaction,
  compileOpenPencilFramePatchTransaction,
  createOpenPencilEngineBinding,
  mapOpenPencilSelection,
} from '../packages/studio-layout-openpencil/index.mjs'

const baseline = JSON.parse(await readFile(new URL('../packages/studio-layout-openpencil/compatibility/openpencil-baseline.json', import.meta.url), 'utf8'))
assert.equal(baseline.openPencil.commit, 'e6c9bcef45c5b48b38f42824d56b5513178e1a0b')
assert.equal(baseline.dshOpenPencil.commit, '99e05cdbae5e26c920cc20e0793c66446685b0cd')
assert.equal(baseline.dshOpenPencil.version, '0.1.0-rc.9')

const ids = {
  page: 'layout_page_01992a80-0000-7000-8000-000000000101',
  title: 'layout_element_01992a80-0000-7000-8000-000000000201',
  image: 'layout_element_01992a80-0000-7000-8000-000000000202',
  shape: 'layout_element_01992a80-0000-7000-8000-000000000203',
  group: 'layout_element_01992a80-0000-7000-8000-000000000204',
}

const renderPlan = {
  layoutPageId: ids.page,
  projectId: 'project_01992a80-0000-7000-8000-000000000001',
  pageId: 'page_01992a80-0000-7000-8000-000000000002',
  canvas: { width: 1600, height: 900, unit: 'studio_unit' },
  elements: [
    {
      layoutElementId: ids.title,
      type: 'text',
      frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
      style: { fontSize: 52, fontWeight: 700, textColor: '#111827' },
      zIndex: 10,
      syncPolicy: 'live',
      elementState: 'normal',
      sourceKey: 'content-block:title',
      payload: { kind: 'text', role: 'page_title', content: '总体技术方案' },
    },
    {
      layoutElementId: ids.image,
      type: 'image',
      frame: { x: 900, y: 120, width: 560, height: 420, rotation: 0 },
      style: { fit: 'cover', cornerRadius: 24 },
      zIndex: 8,
      syncPolicy: 'live',
      elementState: 'normal',
      sourceKey: 'page-asset:architecture',
      payload: {
        kind: 'asset',
        pageAssetId: 'page_asset_architecture',
        assetId: 'asset_architecture',
        caption: '总体架构图',
        objectRef: { sha256: 'b'.repeat(64), sizeBytes: 1024, mimeType: 'image/png' },
      },
    },
    {
      layoutElementId: ids.shape,
      type: 'shape',
      frame: { x: 96, y: 720, width: 420, height: 4, rotation: 0 },
      style: { fill: '#7357F5' },
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
const before = structuredClone(renderPlan)
const options = {
  assetUrlResolver: payload => `http://127.0.0.1:3080/report-studio/assets/${payload.objectRef.sha256}`,
}
const first = compileOpenPencilCreateTransaction(renderPlan, options)
const second = compileOpenPencilCreateTransaction(renderPlan, options)
assert.deepEqual(first, second)
assert.deepEqual(renderPlan, before)
assert.equal(first.expectedBindings.length, 4)

const result = {
  results: [
    { binding: first.rootBinding, nodeId: 'op-root-verified' },
    ...first.expectedBindings.map((entry, index) => ({ binding: entry.bindingKey, nodeId: `op-node-verified-${index + 1}` })),
  ],
  nodeCount: 5,
}
const binding = createOpenPencilEngineBinding(first, result, {
  layoutEngineBindingId: 'layout_engine_binding_01992a80-0000-7000-8000-000000000901',
  layoutPageId: ids.page,
  engineDocumentRef: { provider: 'openpencil', documentId: 'verification-document', contentHash: null },
  generatedFromRevision: 18,
  sourceStateHash: `sha256:${'c'.repeat(64)}`,
})
assert.equal(binding.nodeMap.length, 4)

const patch = compileOpenPencilFramePatchTransaction(binding, [
  { layoutElementId: ids.title, frame: { x: 120, y: 80, width: 760, height: 100, rotation: 0 } },
])
assert.match(patch.operations, /^U\("op-node-verified-/u)
assert.deepEqual(Object.keys(patch.changes[0]).sort(), ['frame', 'layoutElementId'])

const selectedNode = binding.nodeMap[1].engineNodeId
assert.deepEqual(mapOpenPencilSelection(binding, [selectedNode, binding.rootEngineNodeId, 'engine-private-child']), {
  layoutElementIds: [binding.nodeMap[1].layoutElementId],
  unmappedEngineNodeIds: [binding.rootEngineNodeId, 'engine-private-child'],
})

console.log('REPORT_STUDIO_OPENPENCIL_ADAPTER_V0_2_0_PASS')
console.log(`bindings=${binding.nodeMap.length}`)
console.log(`patches=${patch.changes.length}`)
console.log(`openpencil=${baseline.openPencil.commit}`)
console.log(`dsh-openpencil=${baseline.dshOpenPencil.commit}`)
