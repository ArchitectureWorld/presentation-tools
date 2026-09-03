import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDetachedLayoutElement,
  addLiveLayoutElement,
  createLayoutPage,
  createLayoutRenderPlan,
  detachLayoutElement,
  markLayoutDraftAdvanced,
  reconcileLayoutSources,
  updateLayoutElementFrame,
} from './index.mjs'
import { sourceRefKey } from '../studio-layout-contracts/index.mjs'

const projectId = 'project_001'
const pageId = 'page_001'
const sourceRef = { kind: 'content-block', contentBlockId: 'content_block_title_001' }

function createPage() {
  return createLayoutPage({ projectId, pageId, baseDraftRevision: 7 })
}

test('createLayoutPage establishes an engine-neutral 16:9 document', () => {
  const layout = createPage()
  assert.equal(layout.projectId, projectId)
  assert.equal(layout.pageId, pageId)
  assert.deepEqual(layout.canvas, { width: 1600, height: 900, unit: 'studio_unit' })
  assert.equal(layout.baseDraftRevision, 7)
  assert.equal(layout.lastSyncedDraftRevision, 7)
  assert.equal(layout.syncState, 'synced')
  assert.deepEqual(layout.elements, [])
})

test('live elements store source identity without duplicating source payload', () => {
  const layout = addLiveLayoutElement(createPage(), {
    type: 'text',
    sourceRef,
    frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
    style: { fontSize: 52 },
  })
  assert.equal(layout.elements.length, 1)
  assert.deepEqual(layout.elements[0].sourceRef, sourceRef)
  assert.equal('localPayload' in layout.elements[0], false)
  assert.equal(layout.elements[0].lastSyncedSourceRevision, 7)
})

test('frame edits preserve source binding style and synchronization metadata', () => {
  let layout = addLiveLayoutElement(createPage(), {
    type: 'text',
    sourceRef,
    frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
    style: { fontSize: 52 },
    zIndex: 4,
  })
  const before = structuredClone(layout.elements[0])
  layout = updateLayoutElementFrame(layout, before.layoutElementId, { x: 120, width: 680 })
  assert.deepEqual(layout.elements[0].frame, { x: 120, y: 72, width: 680, height: 96, rotation: 0 })
  assert.deepEqual(layout.elements[0].sourceRef, before.sourceRef)
  assert.deepEqual(layout.elements[0].style, before.style)
  assert.equal(layout.elements[0].lastSyncedSourceRevision, before.lastSyncedSourceRevision)
})

test('detaching a live element removes writable sourceRef and stores local content', () => {
  let layout = addLiveLayoutElement(createPage(), {
    type: 'text',
    sourceRef,
    frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
  })
  const elementId = layout.elements[0].layoutElementId
  layout = detachLayoutElement(layout, elementId, { text: '独立排版文字' })
  assert.equal(layout.elements[0].syncPolicy, 'detached')
  assert.equal('sourceRef' in layout.elements[0], false)
  assert.deepEqual(layout.elements[0].localPayload, { text: '独立排版文字' })
  assert.equal(layout.elements[0].lastSyncedSourceRevision, null)
})

test('draft advancement marks layout stale without changing geometry', () => {
  let layout = addLiveLayoutElement(createPage(), {
    type: 'text',
    sourceRef,
    frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
  })
  const frame = structuredClone(layout.elements[0].frame)
  layout = markLayoutDraftAdvanced(layout, 8)
  assert.equal(layout.syncState, 'stale')
  assert.equal(layout.lastSyncedDraftRevision, 7)
  assert.deepEqual(layout.elements[0].frame, frame)
})

test('reconciliation updates source metadata and marks missing live sources orphaned', () => {
  let layout = addLiveLayoutElement(createPage(), {
    type: 'text',
    sourceRef,
    frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
  })
  layout = addDetachedLayoutElement(layout, {
    type: 'shape',
    localPayload: { shape: 'rect' },
    frame: { x: 80, y: 80, width: 400, height: 240, rotation: 0 },
  })
  const originalFrames = layout.elements.map(element => structuredClone(element.frame))
  const missing = reconcileLayoutSources(layout, {}, 8)
  assert.equal(missing.syncState, 'orphaned')
  assert.equal(missing.elements[0].elementState, 'orphaned')
  assert.equal(missing.elements[0].lastSyncedSourceRevision, 7)
  assert.equal(missing.elements[1].elementState, 'normal')
  assert.deepEqual(missing.elements.map(element => element.frame), originalFrames)

  const sources = { [sourceRefKey(sourceRef)]: { kind: 'text', text: '技术方案' } }
  const restored = reconcileLayoutSources(missing, sources, 8)
  assert.equal(restored.syncState, 'synced')
  assert.equal(restored.lastSyncedDraftRevision, 8)
  assert.equal(restored.elements[0].elementState, 'normal')
  assert.equal(restored.elements[0].lastSyncedSourceRevision, 8)
  assert.deepEqual(restored.elements.map(element => element.frame), originalFrames)
})

test('render plan resolves live payloads and detached payloads without mutating canonical layout', () => {
  let layout = addLiveLayoutElement(createPage(), {
    type: 'text',
    sourceRef,
    frame: { x: 96, y: 72, width: 720, height: 96, rotation: 0 },
  })
  layout = addDetachedLayoutElement(layout, {
    type: 'shape',
    localPayload: { shape: 'line', strokeWidth: 2 },
    frame: { x: 80, y: 210, width: 500, height: 2, rotation: 0 },
  })
  const before = structuredClone(layout)
  const plan = createLayoutRenderPlan(layout, {
    [sourceRefKey(sourceRef)]: { kind: 'text', text: '技术方案' },
  })
  assert.equal(plan.elements[0].payload.text, '技术方案')
  assert.deepEqual(plan.elements[1].payload, { shape: 'line', strokeWidth: 2 })
  assert.deepEqual(layout, before)
})
