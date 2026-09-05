import { sourceRefKey } from '../studio-layout-contracts/index.mjs'

const clone = value => structuredClone(value)
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0
const isOrder = value => Number.isSafeInteger(value) && value >= 0

export class LayoutSourceContractError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'LayoutSourceContractError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details = undefined) {
  throw new LayoutSourceContractError(code, message, details)
}

function sourceRefsOf(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail('layout_source_invalid_document', 'sourceRefs must be an array')
  return clone(value)
}

function optionalField(target, key, value) {
  if (value !== undefined) target[key] = clone(value)
  return target
}

function assertCanonicalDraft(draftPage) {
  if (!isObject(draftPage)) fail('layout_source_invalid_document', 'Draft source must be an object')
  const legacyKeys = ['heading', 'body', 'bullets', 'script', 'assets']
  if (!Array.isArray(draftPage.contentBlocks) && legacyKeys.some(key => Object.hasOwn(draftPage, key))) {
    fail(
      'layout_source_contract_unavailable',
      'Legacy simplified pages cannot be guessed into stable layout sources. Stabilized DraftPageDocument identities are required.',
      { required: ['contentBlocks', 'scriptBlocks', 'pageAssets'] },
    )
  }
  if (!isNonEmptyString(draftPage.draftDocumentId)
    || !isNonEmptyString(draftPage.projectId)
    || !isNonEmptyString(draftPage.pageId)
    || !Array.isArray(draftPage.contentBlocks)
    || !Array.isArray(draftPage.scriptBlocks)
    || !Array.isArray(draftPage.pageAssets)) {
    fail('layout_source_invalid_document', 'Draft source requires stable document/project/page identities and contentBlocks, scriptBlocks and pageAssets arrays')
  }
  return draftPage
}

function createIdentityRegistry() {
  const identities = new Map()
  return {
    add(kind, value, path) {
      if (!isNonEmptyString(value)) fail('layout_source_invalid_identity', `${kind} must be a non-empty stable identity`, { kind, value, path })
      const key = `${kind}:${value}`
      const previous = identities.get(key)
      if (previous) {
        fail('layout_source_duplicate_identity', `Duplicate ${kind}: ${value}`, { kind, value, previousPath: previous, path })
      }
      identities.set(key, path)
    },
  }
}

function addSource(index, sourceRef, payload) {
  const key = sourceRefKey(sourceRef)
  if (Object.hasOwn(index, key)) fail('layout_source_duplicate_identity', `Duplicate layout source key: ${key}`, { sourceKey: key })
  index[key] = payload
}

function assertBlockBase(block, path, identities) {
  if (!isObject(block)) fail('layout_source_invalid_document', `Content block at ${path} must be an object`, { path })
  identities.add('contentBlockId', block.contentBlockId, `${path}/contentBlockId`)
  if (!isNonEmptyString(block.type) || !isNonEmptyString(block.role) || !isOrder(block.order)) {
    fail('layout_source_invalid_document', `Content block at ${path} requires type, role and non-negative order`, { path })
  }
}

function textPayload(block) {
  if (typeof block.content !== 'string' || !block.content.length) fail('layout_source_invalid_document', 'Text-like content blocks require content')
  const payload = {
    kind: 'text',
    sourceType: block.type,
    role: block.role,
    order: block.order,
    content: block.content,
    sourceRefs: sourceRefsOf(block.sourceRefs),
  }
  optionalField(payload, 'contentNature', block.contentNature)
  return payload
}

function listPayload(block, path, identities, index) {
  if (!['ordered', 'unordered'].includes(block.listStyle) || !Array.isArray(block.items) || !block.items.length) {
    fail('layout_source_invalid_document', `List block at ${path} requires listStyle and at least one item`, { path })
  }
  const items = block.items.map((item, itemIndex) => {
    const itemPath = `${path}/items/${itemIndex}`
    if (!isObject(item) || typeof item.content !== 'string' || !item.content.length) {
      fail('layout_source_invalid_document', `List item at ${itemPath} requires content`, { path: itemPath })
    }
    identities.add('listItemId', item.listItemId, `${itemPath}/listItemId`)
    const order = item.order ?? itemIndex
    if (!isOrder(order)) fail('layout_source_invalid_document', `List item at ${itemPath} has invalid order`, { path: itemPath })
    const projected = {
      listItemId: item.listItemId,
      content: item.content,
      order,
      sourceRefs: sourceRefsOf(item.sourceRefs),
    }
    optionalField(projected, 'contentNature', item.contentNature)
    addSource(index, {
      kind: 'content-item',
      contentBlockId: block.contentBlockId,
      itemKind: 'list-item',
      itemId: item.listItemId,
    }, {
      kind: 'list-item',
      parentContentBlockId: block.contentBlockId,
      ...clone(projected),
    })
    return projected
  })
  return {
    kind: 'list',
    role: block.role,
    order: block.order,
    listStyle: block.listStyle,
    items,
    sourceRefs: sourceRefsOf(block.sourceRefs),
  }
}

function metricPayload(block, path, identities, index) {
  if (!Array.isArray(block.metrics) || !block.metrics.length) {
    fail('layout_source_invalid_document', `Metric group at ${path} requires at least one metric`, { path })
  }
  const metrics = block.metrics.map((metric, metricIndex) => {
    const metricPath = `${path}/metrics/${metricIndex}`
    if (!isObject(metric) || !isNonEmptyString(metric.label) || !Object.hasOwn(metric, 'value')) {
      fail('layout_source_invalid_document', `Metric at ${metricPath} requires label and value`, { path: metricPath })
    }
    identities.add('metricId', metric.metricId, `${metricPath}/metricId`)
    const order = metric.order ?? metricIndex
    if (!isOrder(order)) fail('layout_source_invalid_document', `Metric at ${metricPath} has invalid order`, { path: metricPath })
    const projected = {
      metricId: metric.metricId,
      label: metric.label,
      value: clone(metric.value),
      unit: metric.unit ?? null,
      note: metric.note ?? null,
      order,
      sourceRefs: sourceRefsOf(metric.sourceRefs),
    }
    optionalField(projected, 'contentNature', metric.contentNature)
    addSource(index, {
      kind: 'content-item',
      contentBlockId: block.contentBlockId,
      itemKind: 'metric',
      itemId: metric.metricId,
    }, {
      kind: 'metric',
      parentContentBlockId: block.contentBlockId,
      ...clone(projected),
    })
    return projected
  })
  return {
    kind: 'metric-group',
    role: block.role,
    order: block.order,
    metrics,
    sourceRefs: sourceRefsOf(block.sourceRefs),
  }
}

function tablePayload(block, path, identities, index) {
  if (!Array.isArray(block.columns) || !block.columns.length || !Array.isArray(block.rows) || !block.rows.length) {
    fail('layout_source_invalid_document', `Table block at ${path} requires columns and rows`, { path })
  }
  const columnIds = new Set()
  const columns = block.columns.map((column, columnIndex) => {
    const columnPath = `${path}/columns/${columnIndex}`
    if (!isObject(column) || !isNonEmptyString(column.label) || !isOrder(column.order)) {
      fail('layout_source_invalid_document', `Table column at ${columnPath} is invalid`, { path: columnPath })
    }
    identities.add('tableColumnId', column.tableColumnId, `${columnPath}/tableColumnId`)
    columnIds.add(column.tableColumnId)
    return { tableColumnId: column.tableColumnId, label: column.label, order: column.order }
  })
  const rows = block.rows.map((row, rowIndex) => {
    const rowPath = `${path}/rows/${rowIndex}`
    if (!isObject(row) || typeof row.label !== 'string' || !isOrder(row.order) || !Array.isArray(row.cells) || !row.cells.length) {
      fail('layout_source_invalid_document', `Table row at ${rowPath} is invalid`, { path: rowPath })
    }
    identities.add('tableRowId', row.tableRowId, `${rowPath}/tableRowId`)
    const cells = row.cells.map((cell, cellIndex) => {
      const cellPath = `${rowPath}/cells/${cellIndex}`
      if (!isObject(cell) || !Object.hasOwn(cell, 'content')) {
        fail('layout_source_invalid_document', `Table cell at ${cellPath} requires content`, { path: cellPath })
      }
      identities.add('tableCellId', cell.tableCellId, `${cellPath}/tableCellId`)
      if (!columnIds.has(cell.tableColumnId)) {
        fail('layout_source_reference_missing', `Table cell references a missing column: ${cell.tableColumnId}`, {
          kind: 'tableColumnId', id: cell.tableColumnId, path: `${cellPath}/tableColumnId`,
        })
      }
      const projected = {
        tableCellId: cell.tableCellId,
        tableColumnId: cell.tableColumnId,
        content: clone(cell.content),
        sourceRefs: sourceRefsOf(cell.sourceRefs),
      }
      optionalField(projected, 'contentNature', cell.contentNature)
      addSource(index, {
        kind: 'content-item',
        contentBlockId: block.contentBlockId,
        itemKind: 'table-cell',
        itemId: cell.tableCellId,
      }, {
        kind: 'table-cell',
        parentContentBlockId: block.contentBlockId,
        tableRowId: row.tableRowId,
        ...clone(projected),
      })
      return projected
    })
    return {
      tableRowId: row.tableRowId,
      label: row.label,
      order: row.order,
      cells,
      sourceRefs: sourceRefsOf(row.sourceRefs),
    }
  })
  return {
    kind: 'table',
    role: block.role,
    order: block.order,
    columns,
    rows,
    sourceRefs: sourceRefsOf(block.sourceRefs),
  }
}

function assertObjectRef(objectRef, pageAssetId) {
  if (!isObject(objectRef)) {
    fail('layout_source_object_ref_required', `Resolved PageAsset ${pageAssetId} requires an ObjectRef`, { pageAssetId })
  }
  if (!/^[0-9a-f]{64}$/iu.test(String(objectRef.sha256 ?? ''))
    || !Number.isSafeInteger(objectRef.sizeBytes)
    || objectRef.sizeBytes < 0
    || !isNonEmptyString(objectRef.mimeType)) {
    fail('layout_source_object_ref_required', `Resolved PageAsset ${pageAssetId} has an invalid ObjectRef`, { pageAssetId })
  }
  return {
    sha256: objectRef.sha256.toLowerCase(),
    sizeBytes: objectRef.sizeBytes,
    mimeType: objectRef.mimeType,
  }
}

function safeMetadata(metadata) {
  if (!isObject(metadata)) return {}
  const allowed = ['widthPx', 'heightPx', 'durationMs', 'pageCount', 'frameRate', 'colorSpace', 'altText']
  return Object.fromEntries(allowed.filter(key => Object.hasOwn(metadata, key)).map(key => [key, clone(metadata[key])]))
}

function resolvedAssetMap(resolvedPageAssets) {
  if (!Array.isArray(resolvedPageAssets)) fail('layout_source_invalid_document', 'Resolved PageAssets must be an array')
  const map = new Map()
  for (const [index, asset] of resolvedPageAssets.entries()) {
    if (!isObject(asset) || !isNonEmptyString(asset.pageAssetId) || !isNonEmptyString(asset.assetId)) {
      fail('layout_source_invalid_identity', 'Resolved PageAsset requires pageAssetId and assetId', { index })
    }
    if (map.has(asset.pageAssetId)) {
      fail('layout_source_duplicate_identity', `Duplicate resolved pageAssetId: ${asset.pageAssetId}`, { pageAssetId: asset.pageAssetId })
    }
    map.set(asset.pageAssetId, asset)
  }
  return map
}

export function buildLayoutSourceIndex(draftPage, resolvedPageAssets = []) {
  assertCanonicalDraft(draftPage)
  const index = {}
  const identities = createIdentityRegistry()
  const contentBlockIds = new Set()

  for (const [blockIndex, block] of draftPage.contentBlocks.entries()) {
    const path = `/contentBlocks/${blockIndex}`
    assertBlockBase(block, path, identities)
    contentBlockIds.add(block.contentBlockId)
    let payload
    switch (block.type) {
      case 'heading':
      case 'text':
        payload = textPayload(block)
        break
      case 'list':
        payload = listPayload(block, path, identities, index)
        break
      case 'metric_group':
        payload = metricPayload(block, path, identities, index)
        break
      case 'table':
        payload = tablePayload(block, path, identities, index)
        break
      default:
        fail('layout_source_contract_unavailable', `Unsupported canonical content block type: ${block.type}`, { type: block.type, path })
    }
    addSource(index, { kind: 'content-block', contentBlockId: block.contentBlockId }, payload)
  }

  const resolvedByPageAssetId = resolvedAssetMap(resolvedPageAssets)
  const availableAssetIds = new Set()
  for (const [pageAssetIndex, link] of draftPage.pageAssets.entries()) {
    const path = `/pageAssets/${pageAssetIndex}`
    if (!isObject(link) || !isNonEmptyString(link.assetId) || !isNonEmptyString(link.role) || !isOrder(link.order) || typeof link.caption !== 'string') {
      fail('layout_source_invalid_document', `PageAsset at ${path} is invalid`, { path })
    }
    identities.add('pageAssetId', link.pageAssetId, `${path}/pageAssetId`)
    const resolved = resolvedByPageAssetId.get(link.pageAssetId)
    if (!resolved) {
      fail('layout_source_reference_missing', `PageAsset content is unresolved: ${link.pageAssetId}`, {
        kind: 'pageAssetId', id: link.pageAssetId, path,
      })
    }
    if (resolved.assetId !== link.assetId) {
      fail('layout_source_reference_mismatch', `PageAsset ${link.pageAssetId} resolves to a different assetId`, {
        pageAssetId: link.pageAssetId,
        expectedAssetId: link.assetId,
        actualAssetId: resolved.assetId,
      })
    }
    const objectRef = assertObjectRef(resolved.objectRef, link.pageAssetId)
    availableAssetIds.add(link.assetId)
    const payload = {
      kind: 'asset',
      pageAssetId: link.pageAssetId,
      assetId: link.assetId,
      role: link.role,
      order: link.order,
      caption: link.caption,
      objectRef,
      metadata: safeMetadata(resolved.metadata),
      sourceRefs: sourceRefsOf(link.sourceRefs),
    }
    optionalField(payload, 'originalFileName', resolved.originalFileName)
    addSource(index, { kind: 'page-asset', pageAssetId: link.pageAssetId }, payload)
  }

  for (const [scriptIndex, script] of draftPage.scriptBlocks.entries()) {
    const path = `/scriptBlocks/${scriptIndex}`
    if (!isObject(script)
      || !isNonEmptyString(script.scriptBlockId)
      || !isOrder(script.order)
      || typeof script.content !== 'string'
      || !script.content.length
      || !(script.estimatedDurationSeconds === null || (typeof script.estimatedDurationSeconds === 'number' && Number.isFinite(script.estimatedDurationSeconds) && script.estimatedDurationSeconds >= 0))) {
      fail('layout_source_invalid_document', `ScriptBlock at ${path} is invalid`, { path })
    }
    identities.add('scriptBlockId', script.scriptBlockId, `${path}/scriptBlockId`)
    const referencedContentBlockIds = clone(script.referencedContentBlockIds ?? [])
    const referencedAssetIds = clone(script.referencedAssetIds ?? [])
    if (!Array.isArray(referencedContentBlockIds) || !Array.isArray(referencedAssetIds)) {
      fail('layout_source_invalid_document', `ScriptBlock references at ${path} must be arrays`, { path })
    }
    for (const contentBlockId of referencedContentBlockIds) {
      if (!contentBlockIds.has(contentBlockId)) {
        fail('layout_source_reference_missing', `ScriptBlock references a missing contentBlockId: ${contentBlockId}`, {
          kind: 'contentBlockId', id: contentBlockId, path: `${path}/referencedContentBlockIds`,
        })
      }
    }
    for (const assetId of referencedAssetIds) {
      if (!availableAssetIds.has(assetId)) {
        fail('layout_source_reference_missing', `ScriptBlock references an unavailable assetId: ${assetId}`, {
          kind: 'assetId', id: assetId, path: `${path}/referencedAssetIds`,
        })
      }
    }
    addSource(index, { kind: 'script-block', scriptBlockId: script.scriptBlockId }, {
      kind: 'script',
      order: script.order,
      content: script.content,
      estimatedDurationSeconds: script.estimatedDurationSeconds,
      referencedContentBlockIds,
      referencedAssetIds,
      sourceRefs: sourceRefsOf(script.sourceRefs),
    })
  }

  return index
}
