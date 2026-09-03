import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ENGINE_BINDING_SCHEMA_VERSION,
  LayoutEngineBindingError,
  assertLayoutEngineBinding,
  createLayoutEngineBindingId,
  engineNodeIdForLayoutElement,
  layoutElementIdForEngineNode,
  mapEngineSelection,
} from './index.mjs'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const hasCode = code => error => error instanceof LayoutEngineBindingError && error.code === code

function fixture() {
  return {
    schemaVersion: ENGINE_BINDING_SCHEMA_VERSION,
    layoutEngineBindingId: 'layout_engine_binding_01992a80-0000-7000-8000-000000000901',
    layoutPageId: 'layout_page_01992a80-0000-7000-8000-000000000101',
    engine: 'openpencil',
    engineAdapterVersion: '0.2.0-alpha.2',
    engineDocumentRef: {
      provider: 'openpencil',
      documentId: 'document-001',
      contentHash: null,
    },
    rootEngineNodeId: 'op-root-001',
    generatedFromRevision: 18,
    sourceStateHash: `sha256:${'a'.repeat(64)}`,
    nodeMap: [
      {
        layoutElementId: 'layout_element_01992a80-0000-7000-8000-000000000201',
        engineNodeId: 'op-node-title',
        bindingKey: 'rs_el_1111111111111111',
      },
      {
        layoutElementId: 'layout_element_01992a80-0000-7000-8000-000000000202',
        engineNodeId: 'op-node-image',
        bindingKey: 'rs_el_2222222222222222',
      },
    ],
  }
}

test('layout engine binding ids use typed lowercase UUIDv7 values', () => {
  const id = createLayoutEngineBindingId({
    now: 1_757_000_000_000,
    randomBytes: length => Buffer.alloc(length, 0x22),
  })
  assert.match(id, /^layout_engine_binding_/u)
  assert.match(id.slice('layout_engine_binding_'.length), UUID_V7)
})

test('valid OpenPencil engine binding is accepted without mutation', () => {
  const binding = fixture()
  const before = structuredClone(binding)
  assert.equal(assertLayoutEngineBinding(binding), binding)
  assert.deepEqual(binding, before)
})

test('duplicate layout element identities are rejected', () => {
  const binding = fixture()
  binding.nodeMap[1].layoutElementId = binding.nodeMap[0].layoutElementId
  assert.throws(() => assertLayoutEngineBinding(binding), hasCode('layout_engine_binding_duplicate_layout_element'))
})

test('duplicate engine node identities are rejected', () => {
  const binding = fixture()
  binding.nodeMap[1].engineNodeId = binding.nodeMap[0].engineNodeId
  assert.throws(() => assertLayoutEngineBinding(binding), hasCode('layout_engine_binding_duplicate_engine_node'))
})

test('duplicate transaction binding keys are rejected', () => {
  const binding = fixture()
  binding.nodeMap[1].bindingKey = binding.nodeMap[0].bindingKey
  assert.throws(() => assertLayoutEngineBinding(binding), hasCode('layout_engine_binding_duplicate_binding_key'))
})

test('layout element identities resolve to private engine node identities', () => {
  const binding = fixture()
  assert.equal(engineNodeIdForLayoutElement(binding, binding.nodeMap[0].layoutElementId), 'op-node-title')
  assert.equal(engineNodeIdForLayoutElement(binding, 'layout_element_missing'), null)
})

test('engine node identities resolve back to layout element identities', () => {
  const binding = fixture()
  assert.equal(layoutElementIdForEngineNode(binding, 'op-node-image'), binding.nodeMap[1].layoutElementId)
  assert.equal(layoutElementIdForEngineNode(binding, 'op-node-unknown'), null)
})

test('engine selection reports mapped and unmapped nodes without guessing', () => {
  const binding = fixture()
  assert.deepEqual(mapEngineSelection(binding, ['op-node-image', 'op-root-001', 'op-node-unknown']), {
    layoutElementIds: [binding.nodeMap[1].layoutElementId],
    unmappedEngineNodeIds: ['op-root-001', 'op-node-unknown'],
  })
})
