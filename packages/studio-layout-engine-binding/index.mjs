import { randomBytes as cryptoRandomBytes } from 'node:crypto'

export const ENGINE_BINDING_SCHEMA_VERSION = 'report-studio.layout-engine-binding.v0.2.0-alpha.2'
export const OPENPENCIL_ENGINE_ADAPTER_VERSION = '0.2.0-alpha.2'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const BINDING_ID = new RegExp(`^layout_engine_binding_${UUID_V7.source.slice(1, -1)}$`, 'u')
const BINDING_KEY = /^rs_el_[0-9a-f]{16}$/u
const SHA256_REF = /^sha256:[0-9a-f]{64}$/u

export class LayoutEngineBindingError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'LayoutEngineBindingError'
    this.code = code
    this.details = details
  }
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0
const isRevision = value => Number.isSafeInteger(value) && value >= 0

function fail(code, message, details = undefined) {
  throw new LayoutEngineBindingError(code, message, details)
}

function createUuidV7({ now = Date.now(), randomBytes = cryptoRandomBytes } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    fail('layout_engine_binding_invalid_id_time', 'UUIDv7 timestamp must be a non-negative 48-bit integer', { now })
  }
  const bytes = Buffer.alloc(16)
  let timestamp = BigInt(now)
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn)
    timestamp >>= 8n
  }
  const random = Buffer.from(randomBytes(10))
  if (random.length !== 10) {
    fail('layout_engine_binding_invalid_random_source', 'UUIDv7 random source must return exactly 10 bytes')
  }
  random.copy(bytes, 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createLayoutEngineBindingId(options = {}) {
  return `layout_engine_binding_${createUuidV7(options)}`
}

function assertDocumentRef(value) {
  if (!isObject(value)
    || value.provider !== 'openpencil'
    || !isNonEmptyString(value.documentId)
    || !(value.contentHash === null || (typeof value.contentHash === 'string' && SHA256_REF.test(value.contentHash)))) {
    fail('layout_engine_binding_invalid', 'engineDocumentRef must identify an OpenPencil document and optional sha256 content hash', {
      engineDocumentRef: value,
    })
  }
}

export function assertLayoutEngineBinding(binding) {
  if (!isObject(binding)) fail('layout_engine_binding_invalid', 'LayoutEngineBinding must be an object')
  if (binding.schemaVersion !== ENGINE_BINDING_SCHEMA_VERSION) {
    fail('layout_engine_binding_invalid', `Expected schemaVersion=${ENGINE_BINDING_SCHEMA_VERSION}`, {
      schemaVersion: binding.schemaVersion,
    })
  }
  if (!isNonEmptyString(binding.layoutEngineBindingId) || !BINDING_ID.test(binding.layoutEngineBindingId)) {
    fail('layout_engine_binding_invalid', 'layoutEngineBindingId must be a typed lowercase UUIDv7 value', {
      layoutEngineBindingId: binding.layoutEngineBindingId,
    })
  }
  if (!isNonEmptyString(binding.layoutPageId)
    || binding.engine !== 'openpencil'
    || binding.engineAdapterVersion !== OPENPENCIL_ENGINE_ADAPTER_VERSION
    || !isNonEmptyString(binding.rootEngineNodeId)
    || !isRevision(binding.generatedFromRevision)
    || typeof binding.sourceStateHash !== 'string'
    || !SHA256_REF.test(binding.sourceStateHash)
    || !Array.isArray(binding.nodeMap)) {
    fail('layout_engine_binding_invalid', 'LayoutEngineBinding identity, engine, revision, source hash or nodeMap is invalid')
  }
  assertDocumentRef(binding.engineDocumentRef)

  const layoutIds = new Set()
  const engineIds = new Set()
  const bindingKeys = new Set()
  for (const [index, entry] of binding.nodeMap.entries()) {
    if (!isObject(entry)
      || !isNonEmptyString(entry.layoutElementId)
      || !isNonEmptyString(entry.engineNodeId)
      || !isNonEmptyString(entry.bindingKey)
      || !BINDING_KEY.test(entry.bindingKey)) {
      fail('layout_engine_binding_invalid', `Invalid nodeMap entry at index ${index}`, { index, entry })
    }
    if (layoutIds.has(entry.layoutElementId)) {
      fail('layout_engine_binding_duplicate_layout_element', `Duplicate layoutElementId: ${entry.layoutElementId}`, {
        layoutElementId: entry.layoutElementId,
      })
    }
    if (engineIds.has(entry.engineNodeId)) {
      fail('layout_engine_binding_duplicate_engine_node', `Duplicate engineNodeId: ${entry.engineNodeId}`, {
        engineNodeId: entry.engineNodeId,
      })
    }
    if (bindingKeys.has(entry.bindingKey)) {
      fail('layout_engine_binding_duplicate_binding_key', `Duplicate bindingKey: ${entry.bindingKey}`, {
        bindingKey: entry.bindingKey,
      })
    }
    if (entry.engineNodeId === binding.rootEngineNodeId) {
      fail('layout_engine_binding_invalid', 'rootEngineNodeId cannot also represent a LayoutElement', {
        engineNodeId: entry.engineNodeId,
      })
    }
    layoutIds.add(entry.layoutElementId)
    engineIds.add(entry.engineNodeId)
    bindingKeys.add(entry.bindingKey)
  }
  return binding
}

export function engineNodeIdForLayoutElement(binding, layoutElementId) {
  assertLayoutEngineBinding(binding)
  if (!isNonEmptyString(layoutElementId)) return null
  return binding.nodeMap.find(entry => entry.layoutElementId === layoutElementId)?.engineNodeId ?? null
}

export function layoutElementIdForEngineNode(binding, engineNodeId) {
  assertLayoutEngineBinding(binding)
  if (!isNonEmptyString(engineNodeId)) return null
  return binding.nodeMap.find(entry => entry.engineNodeId === engineNodeId)?.layoutElementId ?? null
}

export function mapEngineSelection(binding, selectedEngineNodeIds) {
  assertLayoutEngineBinding(binding)
  if (!Array.isArray(selectedEngineNodeIds) || selectedEngineNodeIds.some(value => !isNonEmptyString(value))) {
    fail('layout_engine_binding_invalid', 'selectedEngineNodeIds must be an array of non-empty strings')
  }
  const reverse = new Map(binding.nodeMap.map(entry => [entry.engineNodeId, entry.layoutElementId]))
  const layoutElementIds = []
  const unmappedEngineNodeIds = []
  for (const engineNodeId of selectedEngineNodeIds) {
    const layoutElementId = reverse.get(engineNodeId)
    if (layoutElementId === undefined) unmappedEngineNodeIds.push(engineNodeId)
    else layoutElementIds.push(layoutElementId)
  }
  return { layoutElementIds, unmappedEngineNodeIds }
}
