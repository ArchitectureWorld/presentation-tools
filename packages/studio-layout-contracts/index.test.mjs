import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LAYOUT_SCHEMA_VERSION,
  LayoutContractError,
  assertLayoutPageDocument,
  createLayoutId,
  sourceRefKey,
} from './index.mjs'

const revision = 12

function liveTextElement(overrides = {}) {
  return {
    layoutElementId: createLayoutId('layoutElement'),
    type: 'text',
    sourceRef: { kind: 'content-block', contentBlockId: 'content_block_001' },
    frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
    style: { fontSize: 52, fontWeight: 700 },
    zIndex: 10,
    syncPolicy: 'live',
    lastSyncedSourceRevision: revision,
    elementState: 'normal',
    ...overrides,
  }
}

function detachedShapeElement(overrides = {}) {
  return {
    layoutElementId: createLayoutId('layoutElement'),
    type: 'shape',
    localPayload: { shape: 'rect', fill: '#7357f5' },
    frame: { x: 80, y: 80, width: 400, height: 240, rotation: 0 },
    style: { opacity: 1 },
    zIndex: 1,
    syncPolicy: 'detached',
    lastSyncedSourceRevision: null,
    elementState: 'normal',
    ...overrides,
  }
}

function page(elements = [liveTextElement(), detachedShapeElement()]) {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutPageId: createLayoutId('layoutPage'),
    projectId: 'project_001',
    pageId: 'page_001',
    canvas: { width: 1600, height: 900, unit: 'studio_unit' },
    baseDraftRevision: revision,
    lastSyncedDraftRevision: revision,
    syncState: 'synced',
    elements,
  }
}

test('layout ids use typed lowercase UUIDv7 values', () => {
  assert.match(createLayoutId('layoutPage'), /^layout_page_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.match(createLayoutId('layoutElement'), /^layout_element_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('canonical layout accepts live sources and detached local payloads', () => {
  const value = page()
  assert.equal(assertLayoutPageDocument(value), value)
})

test('live elements cannot duplicate source content in localPayload', () => {
  assert.throws(
    () => assertLayoutPageDocument(page([liveTextElement({ localPayload: { text: 'duplicate' } })])),
    error => error instanceof LayoutContractError && error.code === 'layout_live_payload_forbidden',
  )
})

test('detached elements require localPayload and cannot keep a writable sourceRef', () => {
  assert.throws(
    () => assertLayoutPageDocument(page([detachedShapeElement({ localPayload: undefined })])),
    error => error instanceof LayoutContractError && error.code === 'layout_detached_payload_required',
  )
  assert.throws(
    () => assertLayoutPageDocument(page([detachedShapeElement({ sourceRef: { kind: 'content-block', contentBlockId: 'content_block_001' } })])),
    error => error instanceof LayoutContractError && error.code === 'layout_detached_source_forbidden',
  )
})

test('layout rejects duplicate element ids and invalid frames', () => {
  const id = createLayoutId('layoutElement')
  assert.throws(
    () => assertLayoutPageDocument(page([liveTextElement({ layoutElementId: id }), liveTextElement({ layoutElementId: id })])),
    error => error instanceof LayoutContractError && error.code === 'layout_duplicate_element_id',
  )
  assert.throws(
    () => assertLayoutPageDocument(page([liveTextElement({ frame: { x: 0, y: 0, width: 0, height: 10, rotation: 0 } })])),
    error => error instanceof LayoutContractError && error.code === 'layout_invalid_frame',
  )
})

test('sourceRefKey is deterministic for every supported source kind', () => {
  assert.equal(sourceRefKey({ kind: 'content-block', contentBlockId: 'cb_1' }), 'content-block:cb_1')
  assert.equal(sourceRefKey({ kind: 'script-block', scriptBlockId: 'sb_1' }), 'script-block:sb_1')
  assert.equal(sourceRefKey({ kind: 'page-asset', pageAssetId: 'pa_1' }), 'page-asset:pa_1')
  assert.equal(
    sourceRefKey({ kind: 'content-item', contentBlockId: 'cb_1', itemKind: 'list-item', itemId: 'li_1' }),
    'content-item:cb_1:list-item:li_1',
  )
})
