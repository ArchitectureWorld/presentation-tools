import {
  DEFAULT_LAYOUT_CANVAS,
  LAYOUT_SCHEMA_VERSION,
  LayoutContractError,
  assertLayoutPageDocument,
  createLayoutId,
  sourceRefKey,
} from '../studio-layout-contracts/index.mjs'

const clone = value => structuredClone(value)
const isRevision = value => Number.isSafeInteger(value) && value >= 0

function assertRevision(value, field) {
  if (!isRevision(value)) throw new LayoutContractError('layout_invalid_revision', `${field} must be a non-negative safe integer`, { [field]: value })
}

function nextZIndex(layout) {
  return layout.elements.length ? Math.max(...layout.elements.map(element => element.zIndex)) + 1 : 0
}

function findElementIndex(layout, layoutElementId) {
  const index = layout.elements.findIndex(element => element.layoutElementId === layoutElementId)
  if (index < 0) throw new LayoutContractError('layout_element_not_found', `Layout element not found: ${layoutElementId}`, { layoutElementId })
  return index
}

export function createLayoutPage({
  projectId,
  pageId,
  baseDraftRevision,
  canvas = DEFAULT_LAYOUT_CANVAS,
  layoutPageId = createLayoutId('layoutPage'),
} = {}) {
  assertRevision(baseDraftRevision, 'baseDraftRevision')
  const layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutPageId,
    projectId,
    pageId,
    canvas: clone(canvas),
    baseDraftRevision,
    lastSyncedDraftRevision: baseDraftRevision,
    syncState: 'synced',
    elements: [],
  }
  assertLayoutPageDocument(layout)
  return layout
}

export function addLiveLayoutElement(layout, {
  layoutElementId = createLayoutId('layoutElement'),
  type,
  sourceRef,
  frame,
  style = {},
  zIndex = undefined,
  parentLayoutElementId = null,
} = {}) {
  assertLayoutPageDocument(layout)
  const next = clone(layout)
  next.elements.push({
    layoutElementId,
    type,
    sourceRef: clone(sourceRef),
    frame: clone(frame),
    style: clone(style),
    zIndex: zIndex ?? nextZIndex(next),
    parentLayoutElementId,
    syncPolicy: 'live',
    lastSyncedSourceRevision: next.lastSyncedDraftRevision,
    elementState: 'normal',
  })
  assertLayoutPageDocument(next)
  return next
}

export function addDetachedLayoutElement(layout, {
  layoutElementId = createLayoutId('layoutElement'),
  type,
  localPayload,
  frame,
  style = {},
  zIndex = undefined,
  parentLayoutElementId = null,
} = {}) {
  assertLayoutPageDocument(layout)
  const next = clone(layout)
  next.elements.push({
    layoutElementId,
    type,
    localPayload: clone(localPayload),
    frame: clone(frame),
    style: clone(style),
    zIndex: zIndex ?? nextZIndex(next),
    parentLayoutElementId,
    syncPolicy: 'detached',
    lastSyncedSourceRevision: null,
    elementState: 'normal',
  })
  assertLayoutPageDocument(next)
  return next
}

export function updateLayoutElementFrame(layout, layoutElementId, patch) {
  assertLayoutPageDocument(layout)
  const next = clone(layout)
  const index = findElementIndex(next, layoutElementId)
  next.elements[index].frame = { ...next.elements[index].frame, ...clone(patch ?? {}) }
  assertLayoutPageDocument(next)
  return next
}

export function updateLayoutElementStyle(layout, layoutElementId, patch) {
  assertLayoutPageDocument(layout)
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new LayoutContractError('layout_invalid_style', 'Layout style patch must be a plain object')
  }
  const next = clone(layout)
  const index = findElementIndex(next, layoutElementId)
  next.elements[index].style = { ...next.elements[index].style, ...clone(patch) }
  assertLayoutPageDocument(next)
  return next
}

export function reorderLayoutElement(layout, layoutElementId, zIndex) {
  assertLayoutPageDocument(layout)
  if (!Number.isSafeInteger(zIndex)) throw new LayoutContractError('layout_invalid_z_index', 'zIndex must be a safe integer', { zIndex })
  const next = clone(layout)
  next.elements[findElementIndex(next, layoutElementId)].zIndex = zIndex
  assertLayoutPageDocument(next)
  return next
}

export function detachLayoutElement(layout, layoutElementId, localPayload) {
  assertLayoutPageDocument(layout)
  const next = clone(layout)
  const index = findElementIndex(next, layoutElementId)
  const element = next.elements[index]
  if (element.syncPolicy !== 'live') throw new LayoutContractError('layout_element_already_detached', 'Only live elements can be detached', { layoutElementId })
  delete element.sourceRef
  element.localPayload = clone(localPayload)
  element.syncPolicy = 'detached'
  element.lastSyncedSourceRevision = null
  element.elementState = 'normal'
  assertLayoutPageDocument(next)
  return next
}

export function relinkLayoutElement(layout, layoutElementId, sourceRef, sourceRevision) {
  assertLayoutPageDocument(layout)
  assertRevision(sourceRevision, 'sourceRevision')
  const next = clone(layout)
  const element = next.elements[findElementIndex(next, layoutElementId)]
  delete element.localPayload
  element.sourceRef = clone(sourceRef)
  element.syncPolicy = 'live'
  element.lastSyncedSourceRevision = sourceRevision
  element.elementState = 'normal'
  assertLayoutPageDocument(next)
  return next
}

export function markLayoutDraftAdvanced(layout, draftRevision) {
  assertLayoutPageDocument(layout)
  assertRevision(draftRevision, 'draftRevision')
  const next = clone(layout)
  if (draftRevision > next.lastSyncedDraftRevision) next.syncState = 'stale'
  return next
}

export function reconcileLayoutSources(layout, sources, draftRevision) {
  assertLayoutPageDocument(layout)
  assertRevision(draftRevision, 'draftRevision')
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    throw new LayoutContractError('layout_invalid_source_index', 'Source index must be a plain object')
  }
  const next = clone(layout)
  let orphaned = false
  for (const element of next.elements) {
    if (element.syncPolicy !== 'live') continue
    const key = sourceRefKey(element.sourceRef)
    if (!Object.hasOwn(sources, key)) {
      element.elementState = 'orphaned'
      orphaned = true
      continue
    }
    element.elementState = 'normal'
    element.lastSyncedSourceRevision = draftRevision
  }
  next.lastSyncedDraftRevision = draftRevision
  next.syncState = orphaned ? 'orphaned' : 'synced'
  assertLayoutPageDocument(next)
  return next
}

function renderPayload(element, payload) {
  if (payload === null || element.type !== 'text' || typeof payload.content === 'string') return payload
  if (typeof payload.text === 'string') return { ...payload, content: payload.text }
  if (payload.kind === 'metric') return { ...payload, content: `${payload.label} ${String(payload.value)}${payload.unit ? ` ${payload.unit}` : ''}` }
  if (payload.kind === 'table-cell') return { ...payload, content: String(payload.content ?? '') }
  return payload
}

export function createLayoutRenderPlan(layout, sources) {
  assertLayoutPageDocument(layout)
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    throw new LayoutContractError('layout_invalid_source_index', 'Source index must be a plain object')
  }
  return {
    layoutPageId: layout.layoutPageId,
    projectId: layout.projectId,
    pageId: layout.pageId,
    canvas: clone(layout.canvas),
    elements: layout.elements
      .slice()
      .sort((left, right) => left.zIndex - right.zIndex || left.layoutElementId.localeCompare(right.layoutElementId))
      .map(element => {
        if (element.syncPolicy === 'detached') {
          return {
            layoutElementId: element.layoutElementId,
            type: element.type,
            frame: clone(element.frame),
            style: clone(element.style),
            zIndex: element.zIndex,
            parentLayoutElementId: element.parentLayoutElementId ?? null,
            syncPolicy: element.syncPolicy,
            elementState: element.elementState,
            sourceKey: null,
            payload: clone(element.localPayload),
          }
        }
        const sourceKey = sourceRefKey(element.sourceRef)
        const payload = Object.hasOwn(sources, sourceKey) ? clone(sources[sourceKey]) : null
        return {
          layoutElementId: element.layoutElementId,
          type: element.type,
          frame: clone(element.frame),
          style: clone(element.style),
          zIndex: element.zIndex,
          parentLayoutElementId: element.parentLayoutElementId ?? null,
          syncPolicy: element.syncPolicy,
          elementState: payload === null ? 'orphaned' : element.elementState,
          sourceKey,
          payload: renderPayload(element, payload),
        }
      }),
  }
}
