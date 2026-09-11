import { createHash } from 'node:crypto'
import {
  ENGINE_BINDING_SCHEMA_VERSION,
  assertLayoutEngineBinding,
  createLayoutEngineBindingId,
  engineNodeIdForLayoutElement,
  mapEngineSelection,
} from '../studio-layout-engine-binding/index.mjs'

export const OPENPENCIL_ADAPTER_VERSION = '0.2.0-alpha.3'

const ROOT_BINDING = 'rs_page'
const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'line'])
const TEXT_STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'textColor', 'opacity']
const SHAPE_STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'cornerRadius', 'opacity']
const IMAGE_STYLE_KEYS = ['cornerRadius', 'opacity', 'fit']
const GROUP_STYLE_KEYS = ['fill', 'opacity', 'cornerRadius']

export class OpenPencilAdapterError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'OpenPencilAdapterError'
    this.code = code
    this.details = details
  }
}

const clone = value => structuredClone(value)
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)

function fail(code, message, details = undefined) {
  throw new OpenPencilAdapterError(code, message, details)
}

function assertFrame(frame, path = 'frame') {
  if (!isObject(frame)
    || !isFiniteNumber(frame.x)
    || !isFiniteNumber(frame.y)
    || !isFiniteNumber(frame.width)
    || !isFiniteNumber(frame.height)
    || !isFiniteNumber(frame.rotation)
    || frame.width <= 0
    || frame.height <= 0) {
    fail('openpencil_invalid_render_plan', `${path} requires finite x/y/rotation and positive width/height`, { path, frame })
  }
  return {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    rotation: frame.rotation,
  }
}

function assertRenderPlan(plan) {
  if (!isObject(plan)
    || !isNonEmptyString(plan.layoutPageId)
    || !isNonEmptyString(plan.projectId)
    || !isNonEmptyString(plan.pageId)
    || !isObject(plan.canvas)
    || !isFiniteNumber(plan.canvas.width)
    || !isFiniteNumber(plan.canvas.height)
    || plan.canvas.width <= 0
    || plan.canvas.height <= 0
    || plan.canvas.unit !== 'studio_unit'
    || !Array.isArray(plan.elements)) {
    fail('openpencil_invalid_render_plan', 'Engine-neutral Render Plan is invalid')
  }
  const ids = new Set()
  for (const [index, element] of plan.elements.entries()) {
    if (!isObject(element)
      || !isNonEmptyString(element.layoutElementId)
      || !isNonEmptyString(element.type)
      || !Number.isSafeInteger(element.zIndex)
      || !isObject(element.style)) {
      fail('openpencil_invalid_render_plan', `Invalid element at index ${index}`, { index, element })
    }
    assertFrame(element.frame, `elements[${index}].frame`)
    if (ids.has(element.layoutElementId)) {
      fail('openpencil_invalid_render_plan', `Duplicate layoutElementId: ${element.layoutElementId}`, {
        layoutElementId: element.layoutElementId,
      })
    }
    ids.add(element.layoutElementId)
  }
  return plan
}

function bindingKeyForLayoutElement(layoutElementId) {
  return `rs_el_${createHash('sha256').update(layoutElementId, 'utf8').digest('hex').slice(0, 16)}`
}

function copyWhitelistedStyle(node, style, keys) {
  for (const key of keys) {
    if (Object.hasOwn(style, key) && style[key] !== undefined) node[key] = clone(style[key])
  }
  return node
}

function nameForElement(element, fallback) {
  const payload = isObject(element.payload) ? element.payload : {}
  for (const candidate of [payload.label, payload.caption, payload.role, fallback]) {
    if (isNonEmptyString(candidate)) return candidate.trim()
  }
  return fallback
}

function textNode(element) {
  if (!isObject(element.payload) || typeof element.payload.content !== 'string' || element.payload.content.length === 0) {
    fail('openpencil_invalid_render_plan', `Text element ${element.layoutElementId} requires resolved text content`, {
      layoutElementId: element.layoutElementId,
    })
  }
  const node = {
    type: 'text',
    name: nameForElement(element, 'Text'),
    ...assertFrame(element.frame),
    content: element.payload.content,
  }
  return copyWhitelistedStyle(node, element.style, TEXT_STYLE_KEYS)
}

function resolveAssetUrl(element, assetUrlResolver) {
  if (typeof assetUrlResolver !== 'function') {
    fail('openpencil_asset_url_unavailable', `Image element ${element.layoutElementId} requires assetUrlResolver`, {
      layoutElementId: element.layoutElementId,
    })
  }
  let value
  try {
    value = assetUrlResolver(clone(element.payload), element.layoutElementId)
  } catch (error) {
    fail('openpencil_asset_url_unavailable', `Asset URL resolution failed for ${element.layoutElementId}`, {
      layoutElementId: element.layoutElementId,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  if (!isNonEmptyString(value)) {
    fail('openpencil_asset_url_unavailable', `Asset URL resolution returned no URL for ${element.layoutElementId}`, {
      layoutElementId: element.layoutElementId,
    })
  }
  const text = value.trim()
  if (/^(?:data|file|blob):/iu.test(text)
    || /^[a-z]:[\\/]/iu.test(text)
    || text.startsWith('/')
    || text.startsWith('\\')
    || text.includes('\\')) {
    fail('openpencil_asset_url_forbidden', 'OpenPencil image assets must use an HTTP(S) capability URL, never inline bytes or host paths', {
      layoutElementId: element.layoutElementId,
    })
  }
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    fail('openpencil_asset_url_forbidden', 'OpenPencil image asset URL must be absolute HTTP(S)', {
      layoutElementId: element.layoutElementId,
    })
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail('openpencil_asset_url_forbidden', 'OpenPencil image asset URL must use HTTP(S)', {
      layoutElementId: element.layoutElementId,
      protocol: parsed.protocol,
    })
  }
  return text
}

function imageNode(element, assetUrlResolver) {
  if (!isObject(element.payload) || element.payload.kind !== 'asset' || !isObject(element.payload.objectRef)) {
    fail('openpencil_invalid_render_plan', `Image element ${element.layoutElementId} requires an ObjectRef-backed asset payload`, {
      layoutElementId: element.layoutElementId,
    })
  }
  const node = {
    type: 'image',
    name: nameForElement(element, 'Image'),
    ...assertFrame(element.frame),
    src: resolveAssetUrl(element, assetUrlResolver),
  }
  return copyWhitelistedStyle(node, element.style, IMAGE_STYLE_KEYS)
}

function shapeNode(element) {
  const payload = isObject(element.payload) ? element.payload : {}
  const shapeKind = payload.shapeKind ?? 'rectangle'
  if (!SHAPE_TYPES.has(shapeKind)) {
    fail('openpencil_unsupported_shape_kind', `Unsupported OpenPencil shape kind: ${shapeKind}`, {
      layoutElementId: element.layoutElementId,
      shapeKind,
    })
  }
  const node = {
    type: shapeKind,
    name: nameForElement(element, 'Shape'),
    ...assertFrame(element.frame),
  }
  return copyWhitelistedStyle(node, element.style, SHAPE_STYLE_KEYS)
}

function groupNode(element) {
  const node = {
    type: 'frame',
    name: nameForElement(element, 'Group'),
    ...assertFrame(element.frame),
  }
  return copyWhitelistedStyle(node, element.style, GROUP_STYLE_KEYS)
}

function nodeForElement(element, options) {
  switch (element.type) {
    case 'text': return textNode(element)
    case 'image': return imageNode(element, options.assetUrlResolver)
    case 'shape': return shapeNode(element)
    case 'group': return groupNode(element)
    default:
      fail('openpencil_unsupported_element_type', `Unsupported layout element type: ${element.type}`, {
        layoutElementId: element.layoutElementId,
        type: element.type,
      })
  }
}

export function compileOpenPencilCreateTransaction(renderPlan, options = {}) {
  assertRenderPlan(renderPlan)
  const sortedElements = renderPlan.elements
    .slice()
    .sort((left, right) => left.zIndex - right.zIndex || left.layoutElementId.localeCompare(right.layoutElementId))
  const rootNode = {
    type: 'frame',
    name: options.rootName ?? 'Report Studio Page',
    x: 0,
    y: 0,
    width: renderPlan.canvas.width,
    height: renderPlan.canvas.height,
  }
  const operations = [`const ${ROOT_BINDING}=I(null,${JSON.stringify(rootNode)})`]
  const expectedBindings = []
  const bindingKeys = new Set()
  for (const element of sortedElements) {
    const bindingKey = bindingKeyForLayoutElement(element.layoutElementId)
    if (bindingKeys.has(bindingKey)) {
      fail('openpencil_invalid_render_plan', `LayoutElement binding hash collision: ${bindingKey}`, { bindingKey })
    }
    bindingKeys.add(bindingKey)
    expectedBindings.push({ bindingKey, layoutElementId: element.layoutElementId })
    operations.push(`const ${bindingKey}=I(${ROOT_BINDING},${JSON.stringify(nodeForElement(element, options))})`)
  }
  return {
    adapterVersion: OPENPENCIL_ADAPTER_VERSION,
    engine: 'openpencil',
    layoutPageId: renderPlan.layoutPageId,
    rootBinding: ROOT_BINDING,
    operations: operations.join('\n'),
    expectedBindings,
  }
}

function assertCreateTransaction(transaction) {
  if (!isObject(transaction)
    || transaction.adapterVersion !== OPENPENCIL_ADAPTER_VERSION
    || transaction.engine !== 'openpencil'
    || !isNonEmptyString(transaction.layoutPageId)
    || transaction.rootBinding !== ROOT_BINDING
    || !isNonEmptyString(transaction.operations)
    || !Array.isArray(transaction.expectedBindings)) {
    fail('openpencil_invalid_execution_result', 'OpenPencil create transaction is invalid')
  }
  const keys = new Set([transaction.rootBinding])
  const layoutIds = new Set()
  for (const entry of transaction.expectedBindings) {
    if (!isObject(entry) || !isNonEmptyString(entry.bindingKey) || !isNonEmptyString(entry.layoutElementId)) {
      fail('openpencil_invalid_execution_result', 'OpenPencil transaction expectedBindings entry is invalid')
    }
    if (keys.has(entry.bindingKey) || layoutIds.has(entry.layoutElementId)) {
      fail('openpencil_invalid_execution_result', 'OpenPencil transaction contains duplicate expected bindings')
    }
    keys.add(entry.bindingKey)
    layoutIds.add(entry.layoutElementId)
  }
}

function normalizeExecutionResults(transaction, results) {
  const expectedOrder = [transaction.rootBinding, ...transaction.expectedBindings.map(entry => entry.bindingKey)]
  const managed = results.length === expectedOrder.length
    && results.every(entry => isObject(entry) && /^b\d+$/u.test(String(entry.binding ?? '')))
  if (!managed) return results
  const byIndex = new Map()
  for (const entry of results) {
    const index = Number(String(entry.binding).slice(1))
    if (!Number.isSafeInteger(index) || index < 0 || index >= expectedOrder.length || byIndex.has(index)) {
      fail('openpencil_invalid_execution_result', 'Managed OpenPencil script returned a non-contiguous binding sequence.', { results })
    }
    byIndex.set(index, entry)
  }
  if (byIndex.size !== expectedOrder.length || expectedOrder.some((_, index) => !byIndex.has(index))) {
    fail('openpencil_invalid_execution_result', 'Managed OpenPencil script omitted an insertion binding.', { results })
  }
  return expectedOrder.map((binding, index) => ({ ...byIndex.get(index), binding }))
}

export function createOpenPencilEngineBinding(transaction, result, metadata = {}) {
  assertCreateTransaction(transaction)
  if (!isObject(result) || !Array.isArray(result.results)) {
    fail('openpencil_invalid_execution_result', 'OpenPencil execution result requires results[{binding,nodeId}]')
  }
  const normalizedResults = normalizeExecutionResults(transaction, result.results)
  const expected = new Set([transaction.rootBinding, ...transaction.expectedBindings.map(entry => entry.bindingKey)])
  const resultByBinding = new Map()
  const engineNodeIds = new Set()
  for (const [index, entry] of normalizedResults.entries()) {
    if (!isObject(entry) || !isNonEmptyString(entry.binding) || !isNonEmptyString(entry.nodeId)) {
      fail('openpencil_invalid_execution_result', `Invalid OpenPencil result at index ${index}`, { index, entry })
    }
    if (resultByBinding.has(entry.binding)) {
      fail('openpencil_duplicate_result_binding', `Duplicate OpenPencil result binding: ${entry.binding}`, {
        binding: entry.binding,
      })
    }
    if (!expected.has(entry.binding)) {
      fail('openpencil_unknown_binding', `Unknown OpenPencil result binding: ${entry.binding}`, { binding: entry.binding })
    }
    if (engineNodeIds.has(entry.nodeId)) {
      fail('openpencil_duplicate_engine_node', `Duplicate OpenPencil engine node: ${entry.nodeId}`, { nodeId: entry.nodeId })
    }
    resultByBinding.set(entry.binding, entry.nodeId)
    engineNodeIds.add(entry.nodeId)
  }
  for (const bindingKey of expected) {
    if (!resultByBinding.has(bindingKey)) {
      fail('openpencil_missing_binding', `OpenPencil result omitted binding: ${bindingKey}`, { binding: bindingKey })
    }
  }
  if (!isObject(metadata.engineDocumentRef)
    || !isNonEmptyString(metadata.layoutPageId)
    || metadata.layoutPageId !== transaction.layoutPageId
    || !Number.isSafeInteger(metadata.generatedFromRevision)
    || metadata.generatedFromRevision < 0
    || !isNonEmptyString(metadata.sourceStateHash)) {
    fail('openpencil_invalid_execution_result', 'OpenPencil binding metadata is invalid', { metadata })
  }

  const binding = {
    schemaVersion: ENGINE_BINDING_SCHEMA_VERSION,
    layoutEngineBindingId: metadata.layoutEngineBindingId ?? createLayoutEngineBindingId(),
    layoutPageId: transaction.layoutPageId,
    engine: 'openpencil',
    engineAdapterVersion: OPENPENCIL_ADAPTER_VERSION,
    engineDocumentRef: clone(metadata.engineDocumentRef),
    rootEngineNodeId: resultByBinding.get(transaction.rootBinding),
    generatedFromRevision: metadata.generatedFromRevision,
    sourceStateHash: metadata.sourceStateHash,
    nodeMap: transaction.expectedBindings.map(entry => ({
      layoutElementId: entry.layoutElementId,
      engineNodeId: resultByBinding.get(entry.bindingKey),
      bindingKey: entry.bindingKey,
    })),
  }
  assertLayoutEngineBinding(binding)
  return binding
}

export function compileOpenPencilFramePatchTransaction(binding, changes) {
  assertLayoutEngineBinding(binding)
  if (!Array.isArray(changes) || changes.length === 0) {
    fail('openpencil_empty_patch', 'OpenPencil frame patch requires at least one change')
  }
  const normalized = changes.map((change, index) => {
    if (!isObject(change) || !isNonEmptyString(change.layoutElementId)) {
      fail('openpencil_invalid_render_plan', `Invalid frame patch change at index ${index}`, { index, change })
    }
    return {
      layoutElementId: change.layoutElementId,
      frame: assertFrame(change.frame, `changes[${index}].frame`),
    }
  }).sort((left, right) => left.layoutElementId.localeCompare(right.layoutElementId))

  const seen = new Set()
  const operations = []
  for (const change of normalized) {
    if (seen.has(change.layoutElementId)) {
      fail('openpencil_invalid_render_plan', `Duplicate frame patch for ${change.layoutElementId}`, {
        layoutElementId: change.layoutElementId,
      })
    }
    seen.add(change.layoutElementId)
    const engineNodeId = engineNodeIdForLayoutElement(binding, change.layoutElementId)
    if (engineNodeId === null) {
      fail('openpencil_unmapped_layout_element', `LayoutElement has no OpenPencil engine mapping: ${change.layoutElementId}`, {
        layoutElementId: change.layoutElementId,
      })
    }
    operations.push(`U(${JSON.stringify(engineNodeId)},${JSON.stringify(change.frame)})`)
  }
  return {
    adapterVersion: OPENPENCIL_ADAPTER_VERSION,
    engine: 'openpencil',
    layoutEngineBindingId: binding.layoutEngineBindingId,
    operations: operations.join('\n'),
    changes: clone(normalized),
  }
}

export function mapOpenPencilSelection(binding, selectedEngineNodeIds) {
  return mapEngineSelection(binding, selectedEngineNodeIds)
}
