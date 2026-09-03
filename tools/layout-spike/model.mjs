const FRAME_CHANGE_SCHEMA = 'report-studio.layout-spike.frame-changes.v0.2.0-alpha.1'
const MIN_FRAME_SIZE = 40

const clone = value => structuredClone(value)

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export const SPIKE_RENDER_PLAN = deepFreeze({
  layoutPageId: 'layout_page_01a0666c-aeac-7ec4-852a-a71fc0f06902',
  projectId: 'project_layout_spike',
  pageId: 'page_layout_spike',
  canvas: { width: 1600, height: 900, unit: 'studio_unit' },
  elements: [
    {
      layoutElementId: 'layout_element_01a0666c-aeac-7ec4-852a-a71fc0f06903',
      type: 'text',
      frame: { x: 88, y: 70, width: 760, height: 132, rotation: 0 },
      style: { fontSize: 58, fontWeight: 760, lineHeight: 1.12, textAlign: 'left' },
      zIndex: 10,
      syncPolicy: 'live',
      elementState: 'normal',
      sourceKey: 'content-block:content_block_title_fixture',
      payload: '从草案语义到可控排版',
    },
    {
      layoutElementId: 'layout_element_01a0666c-aeac-7ec4-852a-a71fc0f06904',
      type: 'image',
      frame: { x: 928, y: 108, width: 560, height: 470, rotation: 0 },
      style: { fit: 'cover', cornerRadius: 30 },
      zIndex: 8,
      syncPolicy: 'live',
      elementState: 'normal',
      sourceKey: 'page-asset:page_asset_fixture',
      payload: { kind: 'image-placeholder', label: '项目空间关系图', note: 'ObjectRef-backed asset later' },
    },
    {
      layoutElementId: 'layout_element_01a0666c-aeac-7ec4-852a-a71fc0f06905',
      type: 'shape',
      frame: { x: 88, y: 284, width: 760, height: 440, rotation: 0 },
      style: { fill: '#151b28', stroke: '#30384c', cornerRadius: 28 },
      zIndex: 2,
      syncPolicy: 'detached',
      elementState: 'normal',
      sourceKey: null,
      payload: { kind: 'panel', label: '排版几何保持独立', note: '拖动或缩放不会复制、覆盖草案正文。' },
    },
    {
      layoutElementId: 'layout_element_01a0666c-aeac-7ec4-852a-a71fc0f06906',
      type: 'shape',
      frame: { x: 934, y: 646, width: 548, height: 92, rotation: 0 },
      style: { fill: '#7357f5', stroke: '#9a86ff', cornerRadius: 46 },
      zIndex: 6,
      syncPolicy: 'detached',
      elementState: 'normal',
      sourceKey: null,
      payload: { kind: 'accent', label: 'FRAME-ONLY SPIKE' },
    },
  ],
})

function initialFrames() {
  return Object.fromEntries(SPIKE_RENDER_PLAN.elements.map(element => [element.layoutElementId, clone(element.frame)]))
}

function assertState(state) {
  if (!state?.renderPlan || !Array.isArray(state.renderPlan.elements) || !state.initialFrames) {
    throw new TypeError('Invalid layout spike state')
  }
  return state
}

function findSelectedElement(state) {
  if (!state.selectedElementId) throw new Error('No layout element is selected')
  const element = state.renderPlan.elements.find(item => item.layoutElementId === state.selectedElementId)
  if (!element) throw new Error(`Layout element not found: ${state.selectedElementId}`)
  return element
}

function finiteDelta(value, field) {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number)) throw new TypeError(`${field} must be finite`)
  return number
}

export function createSpikeState() {
  return {
    renderPlan: clone(SPIKE_RENDER_PLAN),
    selectedElementId: SPIKE_RENDER_PLAN.elements[0].layoutElementId,
    initialFrames: initialFrames(),
  }
}

export function selectElement(state, layoutElementId) {
  assertState(state)
  if (!state.renderPlan.elements.some(element => element.layoutElementId === layoutElementId)) {
    throw new Error(`Layout element not found: ${layoutElementId}`)
  }
  const next = clone(state)
  next.selectedElementId = layoutElementId
  return next
}

export function moveSelectedElement(state, delta = {}) {
  assertState(state)
  const selected = findSelectedElement(state)
  const next = clone(state)
  const element = next.renderPlan.elements.find(item => item.layoutElementId === selected.layoutElementId)
  element.frame.x += finiteDelta(delta.x, 'delta.x')
  element.frame.y += finiteDelta(delta.y, 'delta.y')
  return next
}

export function resizeSelectedElement(state, delta = {}) {
  assertState(state)
  const selected = findSelectedElement(state)
  const next = clone(state)
  const element = next.renderPlan.elements.find(item => item.layoutElementId === selected.layoutElementId)
  element.frame.width = Math.max(MIN_FRAME_SIZE, element.frame.width + finiteDelta(delta.width, 'delta.width'))
  element.frame.height = Math.max(MIN_FRAME_SIZE, element.frame.height + finiteDelta(delta.height, 'delta.height'))
  return next
}

function sameFrame(left, right) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
    && left.rotation === right.rotation
}

export function serializeFrameChanges(state) {
  assertState(state)
  return {
    schemaVersion: FRAME_CHANGE_SCHEMA,
    layoutPageId: state.renderPlan.layoutPageId,
    changes: state.renderPlan.elements
      .filter(element => !sameFrame(element.frame, state.initialFrames[element.layoutElementId]))
      .map(element => ({ layoutElementId: element.layoutElementId, frame: clone(element.frame) })),
  }
}
