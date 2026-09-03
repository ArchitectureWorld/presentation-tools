import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSpikeState,
  moveSelectedElement,
  resizeSelectedElement,
  selectElement,
  serializeFrameChanges,
} from './model.mjs'

test('the layout spike starts from a fresh fixed fixture every time', () => {
  const first = createSpikeState()
  const selected = selectElement(first, first.renderPlan.elements[0].layoutElementId)
  const moved = moveSelectedElement(selected, { x: 120, y: 48 })
  const second = createSpikeState()

  assert.notDeepEqual(moved.renderPlan.elements[0].frame, second.renderPlan.elements[0].frame)
  assert.deepEqual(serializeFrameChanges(second).changes, [])
})

test('selection and dragging update only the selected element frame immutably', () => {
  const initial = createSpikeState()
  const target = initial.renderPlan.elements[0]
  const before = structuredClone(initial)
  const selected = selectElement(initial, target.layoutElementId)
  const moved = moveSelectedElement(selected, { x: 64, y: -20 })
  const updated = moved.renderPlan.elements.find(element => element.layoutElementId === target.layoutElementId)

  assert.deepEqual(initial, before)
  assert.equal(updated.frame.x, target.frame.x + 64)
  assert.equal(updated.frame.y, target.frame.y - 20)
  assert.deepEqual(updated.style, target.style)
  assert.equal(updated.payload, target.payload)
})

test('resizing enforces the minimum frame without changing position', () => {
  const initial = createSpikeState()
  const target = initial.renderPlan.elements[2]
  const selected = selectElement(initial, target.layoutElementId)
  const resized = resizeSelectedElement(selected, { width: -10_000, height: -10_000 })
  const updated = resized.renderPlan.elements.find(element => element.layoutElementId === target.layoutElementId)

  assert.equal(updated.frame.x, target.frame.x)
  assert.equal(updated.frame.y, target.frame.y)
  assert.equal(updated.frame.width, 40)
  assert.equal(updated.frame.height, 40)
})

test('frame serialization contains only changed element identities and frames', () => {
  const initial = createSpikeState()
  const target = initial.renderPlan.elements[1]
  const moved = moveSelectedElement(selectElement(initial, target.layoutElementId), { x: -80, y: 36 })
  const serialized = serializeFrameChanges(moved)

  assert.equal(serialized.layoutPageId, initial.renderPlan.layoutPageId)
  assert.deepEqual(serialized.changes, [{
    layoutElementId: target.layoutElementId,
    frame: { ...target.frame, x: target.frame.x - 80, y: target.frame.y + 36 },
  }])
  assert.deepEqual(Object.keys(serialized.changes[0]).sort(), ['frame', 'layoutElementId'])
})

test('unknown element selection is rejected explicitly', () => {
  assert.throws(() => selectElement(createSpikeState(), 'layout_element_missing'), /not found/i)
})
