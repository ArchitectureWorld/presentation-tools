import { randomBytes as cryptoRandomBytes } from 'node:crypto'

export const LAYOUT_SCHEMA_VERSION = 'report-studio.layout.v0.2.0-alpha.1'
export const DEFAULT_LAYOUT_CANVAS = Object.freeze({ width: 1600, height: 900, unit: 'studio_unit' })

const ID_PREFIXES = Object.freeze({
  layoutPage: 'layout_page',
  layoutElement: 'layout_element',
})

const ELEMENT_TYPES = new Set(['text', 'image', 'shape', 'group'])
const SYNC_POLICIES = new Set(['live', 'detached'])
const SYNC_STATES = new Set(['synced', 'stale', 'orphaned'])
const ELEMENT_STATES = new Set(['normal', 'orphaned'])
const CONTENT_ITEM_KINDS = new Set(['list-item', 'metric', 'table-cell'])

export class LayoutContractError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'LayoutContractError'
    this.code = code
    this.details = details
  }
}

const clone = value => structuredClone(value)
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0
const isRevision = value => Number.isSafeInteger(value) && value >= 0
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)

function createUuidV7({ now = Date.now(), randomBytes = cryptoRandomBytes } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new LayoutContractError('layout_invalid_id_time', 'UUIDv7 timestamp must be a non-negative 48-bit integer')
  }
  const bytes = Buffer.alloc(16)
  let timestamp = BigInt(now)
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn)
    timestamp >>= 8n
  }
  const random = Buffer.from(randomBytes(10))
  if (random.length !== 10) throw new LayoutContractError('layout_invalid_random_source', 'UUIDv7 random source must return exactly 10 bytes')
  random.copy(bytes, 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createLayoutId(kind, options = {}) {
  const prefix = ID_PREFIXES[kind]
  if (!prefix) throw new LayoutContractError('layout_unknown_id_kind', `Unknown layout ID kind: ${kind}`, { kind })
  return `${prefix}_${createUuidV7(options)}`
}

function assertSourceRef(sourceRef) {
  if (!isObject(sourceRef)) throw new LayoutContractError('layout_invalid_source_ref', 'Live layout elements require a structured sourceRef')
  switch (sourceRef.kind) {
    case 'content-block':
      if (!isNonEmptyString(sourceRef.contentBlockId)) throw new LayoutContractError('layout_invalid_source_ref', 'content-block sourceRef requires contentBlockId')
      break
    case 'script-block':
      if (!isNonEmptyString(sourceRef.scriptBlockId)) throw new LayoutContractError('layout_invalid_source_ref', 'script-block sourceRef requires scriptBlockId')
      break
    case 'page-asset':
      if (!isNonEmptyString(sourceRef.pageAssetId)) throw new LayoutContractError('layout_invalid_source_ref', 'page-asset sourceRef requires pageAssetId')
      break
    case 'content-item':
      if (!isNonEmptyString(sourceRef.contentBlockId) || !CONTENT_ITEM_KINDS.has(sourceRef.itemKind) || !isNonEmptyString(sourceRef.itemId)) {
        throw new LayoutContractError('layout_invalid_source_ref', 'content-item sourceRef requires contentBlockId, supported itemKind and itemId')
      }
      break
    default:
      throw new LayoutContractError('layout_invalid_source_ref', `Unsupported sourceRef kind: ${sourceRef.kind}`)
  }
  return sourceRef
}

export function sourceRefKey(sourceRef) {
  assertSourceRef(sourceRef)
  switch (sourceRef.kind) {
    case 'content-block': return `content-block:${sourceRef.contentBlockId}`
    case 'script-block': return `script-block:${sourceRef.scriptBlockId}`
    case 'page-asset': return `page-asset:${sourceRef.pageAssetId}`
    case 'content-item': return `content-item:${sourceRef.contentBlockId}:${sourceRef.itemKind}:${sourceRef.itemId}`
    default: throw new LayoutContractError('layout_invalid_source_ref', 'Unsupported sourceRef')
  }
}

function assertFrame(frame) {
  if (!isObject(frame)
    || !isFiniteNumber(frame.x)
    || !isFiniteNumber(frame.y)
    || !isFiniteNumber(frame.width)
    || !isFiniteNumber(frame.height)
    || !isFiniteNumber(frame.rotation)
    || frame.width <= 0
    || frame.height <= 0) {
    throw new LayoutContractError('layout_invalid_frame', 'Frame requires finite x/y/rotation and positive width/height', { frame })
  }
  return frame
}

function assertCanvas(canvas) {
  if (!isObject(canvas)
    || !isFiniteNumber(canvas.width)
    || !isFiniteNumber(canvas.height)
    || canvas.width <= 0
    || canvas.height <= 0
    || canvas.unit !== 'studio_unit') {
    throw new LayoutContractError('layout_invalid_canvas', 'Canvas requires positive width/height and unit=studio_unit', { canvas })
  }
  return canvas
}

function assertElement(element) {
  if (!isObject(element) || !isNonEmptyString(element.layoutElementId)) {
    throw new LayoutContractError('layout_invalid_element', 'Layout element requires layoutElementId')
  }
  if (!ELEMENT_TYPES.has(element.type)) throw new LayoutContractError('layout_invalid_element_type', `Unsupported layout element type: ${element.type}`)
  assertFrame(element.frame)
  if (!isObject(element.style)) throw new LayoutContractError('layout_invalid_style', 'Layout element style must be an object')
  if (!Number.isSafeInteger(element.zIndex)) throw new LayoutContractError('layout_invalid_z_index', 'Layout element zIndex must be an integer')
  if (!SYNC_POLICIES.has(element.syncPolicy)) throw new LayoutContractError('layout_invalid_sync_policy', `Unsupported syncPolicy: ${element.syncPolicy}`)
  if (!ELEMENT_STATES.has(element.elementState)) throw new LayoutContractError('layout_invalid_element_state', `Unsupported elementState: ${element.elementState}`)

  if (element.syncPolicy === 'live') {
    assertSourceRef(element.sourceRef)
    if (Object.hasOwn(element, 'localPayload')) {
      throw new LayoutContractError('layout_live_payload_forbidden', 'Live elements resolve content through sourceRef and must not duplicate localPayload')
    }
    if (!isRevision(element.lastSyncedSourceRevision)) {
      throw new LayoutContractError('layout_invalid_source_revision', 'Live elements require lastSyncedSourceRevision')
    }
  } else {
    if (Object.hasOwn(element, 'sourceRef') && element.sourceRef !== undefined) {
      throw new LayoutContractError('layout_detached_source_forbidden', 'Detached elements cannot retain a writable sourceRef')
    }
    if (!isObject(element.localPayload)) {
      throw new LayoutContractError('layout_detached_payload_required', 'Detached elements require a structured localPayload')
    }
    if (element.lastSyncedSourceRevision !== null) {
      throw new LayoutContractError('layout_invalid_source_revision', 'Detached elements require lastSyncedSourceRevision=null')
    }
  }
  return element
}

export function assertLayoutPageDocument(layout) {
  if (!isObject(layout)) throw new LayoutContractError('layout_invalid_document', 'LayoutPageDocument must be an object')
  if (layout.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    throw new LayoutContractError('layout_unsupported_schema', `Expected ${LAYOUT_SCHEMA_VERSION}`, { schemaVersion: layout.schemaVersion })
  }
  if (!isNonEmptyString(layout.layoutPageId) || !isNonEmptyString(layout.projectId) || !isNonEmptyString(layout.pageId)) {
    throw new LayoutContractError('layout_invalid_identity', 'LayoutPageDocument requires layoutPageId, projectId and pageId')
  }
  assertCanvas(layout.canvas)
  if (!isRevision(layout.baseDraftRevision) || !isRevision(layout.lastSyncedDraftRevision) || layout.lastSyncedDraftRevision < layout.baseDraftRevision) {
    throw new LayoutContractError('layout_invalid_revision', 'Layout revisions must be non-negative and lastSyncedDraftRevision cannot precede baseDraftRevision')
  }
  if (!SYNC_STATES.has(layout.syncState)) throw new LayoutContractError('layout_invalid_sync_state', `Unsupported syncState: ${layout.syncState}`)
  if (!Array.isArray(layout.elements)) throw new LayoutContractError('layout_invalid_elements', 'LayoutPageDocument elements must be an array')

  const ids = new Set()
  for (const element of layout.elements) {
    assertElement(element)
    if (ids.has(element.layoutElementId)) {
      throw new LayoutContractError('layout_duplicate_element_id', `Duplicate layoutElementId: ${element.layoutElementId}`)
    }
    ids.add(element.layoutElementId)
  }
  return layout
}

export function cloneLayoutPageDocument(layout) {
  assertLayoutPageDocument(layout)
  return clone(layout)
}
