import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

import { canonicalFromState, ERROR_CODES, StudioError } from '../../packages/studio-contracts/index.mjs'
import {
  addDetachedLayoutElement,
  addLiveLayoutElement,
  createLayoutPage,
  createLayoutRenderPlan,
  detachLayoutElement,
  reconcileLayoutSources,
  relinkLayoutElement,
  reorderLayoutElement,
  updateLayoutElementFrame,
  updateLayoutElementStyle,
} from '../../packages/studio-layout-core/index.mjs'
import { assertLayoutPageDocument, sourceRefKey } from '../../packages/studio-layout-contracts/index.mjs'
import { buildLayoutSourceProjection } from '../../packages/studio-layout-integration/index.mjs'
import { LayoutPageStore } from '../../packages/studio-layout-persistence/index.mjs'

const clone = value => structuredClone(value)

export class LayoutServiceError extends Error {
  constructor(code, message, details = undefined, status = 400) {
    super(message)
    this.name = 'LayoutServiceError'
    this.code = code
    this.details = details
    this.status = status
  }
}

function fail(code, message, details = undefined, status = 400) {
  throw new LayoutServiceError(code, message, details, status)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}

function sourceHash(sources) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(sources))).digest('hex')}`
}

function pageForState(state, pageId) {
  const page = state.pages.find(item => item.id === pageId || item.pageId === pageId)
  if (!page) fail('layout_page_not_found', '排版页面不存在。', { pageId }, 404)
  return page
}

function resolvedPageAssets(page) {
  const assets = new Map((page.assets ?? []).map(asset => [asset.id ?? asset.assetId, asset]))
  return (page.pageAssets ?? []).map(link => {
    const asset = link.objectRef ? link : assets.get(link.assetId)
    if (!asset?.objectRef) {
      fail('layout_asset_unresolved', '排版引用的素材尚未进入 ObjectStore。', {
        pageId: page.pageId ?? page.id,
        pageAssetId: link.pageAssetId,
        assetId: link.assetId,
      }, 409)
    }
    return {
      pageAssetId: link.pageAssetId,
      assetId: link.assetId,
      objectRef: clone(asset.objectRef),
      originalFileName: asset.name ?? asset.originalFileName ?? null,
      metadata: {
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
        durationMs: asset.durationMs,
        pageCount: asset.pageCount,
        altText: asset.altText,
      },
    }
  })
}

function projectionForState(state, pageId) {
  const page = pageForState(state, pageId)
  const snapshot = canonicalFromState(state)
  const first = buildLayoutSourceProjection({
    snapshot,
    pageId: page.pageId ?? page.id,
    projectRevision: state.project.currentRevision,
    sourceStateHash: null,
    resolvedPageAssets: resolvedPageAssets(page),
  })
  return { ...first, sourceStateHash: sourceHash(first.sources) }
}

function sourceRefFromKey(key) {
  const [kind, first, second, third] = String(key).split(':')
  if (kind === 'content-block' && first) return { kind, contentBlockId: first }
  if (kind === 'script-block' && first) return { kind, scriptBlockId: first }
  if (kind === 'page-asset' && first) return { kind, pageAssetId: first }
  if (kind === 'content-item' && first && second && third) {
    return { kind, contentBlockId: first, itemKind: second, itemId: third }
  }
  fail('layout_source_key_invalid', '排版来源键无法转换为稳定 SourceRef。', { key }, 500)
}

function sourceText(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.content === 'string') return payload.content
  if (payload.kind === 'metric') return `${payload.label} ${String(payload.value)}${payload.unit ? ` ${payload.unit}` : ''}`
  if (payload.kind === 'table-cell') return String(payload.content ?? '')
  return null
}

function defaultLayout(projection) {
  let layout = createLayoutPage({
    projectId: projection.projectId,
    pageId: projection.pageId,
    baseDraftRevision: projection.projectRevision,
  })
  layout.sourceStateHash = projection.sourceStateHash
  layout.layoutRevision = -1
  layout = addDetachedLayoutElement(layout, {
    type: 'shape',
    localPayload: { shapeKind: 'rectangle', label: 'Page background' },
    frame: { x: 0, y: 0, width: 1600, height: 900, rotation: 0 },
    style: { fill: '#f7f5f0', opacity: 1 },
    zIndex: 0,
  })

  const entries = Object.entries(projection.sources)
  const title = entries.find(([, payload]) => payload.kind === 'text' && payload.role === 'page_title')
  if (title) {
    layout = addLiveLayoutElement(layout, {
      type: 'text', sourceRef: sourceRefFromKey(title[0]),
      frame: { x: 92, y: 70, width: 1416, height: 96, rotation: 0 },
      style: { fontSize: 48, fontWeight: 700, textColor: '#17191d', opacity: 1 }, zIndex: 20,
    })
  }

  const images = entries.filter(([, payload]) => payload.kind === 'asset').slice(0, 2)
  const textEntries = entries.filter(([key, payload]) => key !== title?.[0]
    && !['list', 'metric-group', 'table', 'asset'].includes(payload.kind)
    && sourceText(payload) !== null).slice(0, images.length ? 7 : 10)
  const textWidth = images.length ? 790 : 1416
  let y = 198
  for (const [key, payload] of textEntries) {
    const isScript = payload.kind === 'script-block'
    const height = isScript ? 104 : 74
    layout = addLiveLayoutElement(layout, {
      type: 'text', sourceRef: sourceRefFromKey(key),
      frame: { x: 96, y, width: textWidth, height, rotation: 0 },
      style: { fontSize: isScript ? 22 : 28, fontWeight: payload.kind === 'metric' ? 650 : 400, textColor: '#30343b', opacity: 1 },
      zIndex: 10,
    })
    y += height + 18
    if (y > 820) break
  }
  images.forEach(([key], index) => {
    layout = addLiveLayoutElement(layout, {
      type: 'image', sourceRef: sourceRefFromKey(key),
      frame: { x: 930, y: 198 + index * 296, width: 578, height: 264, rotation: 0 },
      style: { fit: 'cover', cornerRadius: 18, opacity: 1 }, zIndex: 12 + index,
    })
  })
  return reconcileLayoutSources(layout, projection.sources, projection.projectRevision)
}

function layoutRefFromPage(page) {
  const ref = page.layoutRef
  return ref && typeof ref === 'object' ? clone(ref) : null
}

function sourceDisplayLabel(key, payload) {
  if (payload?.role === 'page_title') return '页面标题'
  if (payload?.kind === 'asset') return payload.caption || payload.originalFileName || '页面素材'
  if (payload?.kind === 'script-block') return '讲解稿'
  if (payload?.kind === 'list-item') return `列表项 ${Number(payload.order ?? 0) + 1}`
  if (payload?.kind === 'metric') return payload.label || '指标'
  if (payload?.kind === 'table-cell') return `表格单元格 ${payload.tableRowId ?? ''}`.trim()
  return payload?.role || payload?.kind || key
}

function responseFor(state, layout, ref, projection, renderPlan, extra = {}) {
  return {
    state,
    layout,
    layoutRef: ref,
    sourceProjection: {
      projectId: projection.projectId,
      pageId: projection.pageId,
      draftDocumentId: projection.draftDocumentId,
      sourceProjectRevision: projection.projectRevision,
      sourceStateHash: projection.sourceStateHash,
      sourceCount: Object.keys(projection.sources).length,
      sources: Object.entries(projection.sources).map(([key, payload]) => ({
        key,
        sourceRef: sourceRefFromKey(key),
        kind: payload.kind,
        label: sourceDisplayLabel(key, payload),
      })),
    },
    renderPlan,
    ...extra,
  }
}

export function createLayoutService({ repository, layoutRoot = join(repository.root, 'layouts') } = {}) {
  if (!repository?.getState || !repository?.transactContent) fail('layout_repository_required', 'Layout service requires a Studio Repository.', undefined, 500)
  const store = new LayoutPageStore(resolve(layoutRoot))

  async function loadExisting(state, page, projection) {
    const pageRef = layoutRefFromPage(page)
    let record = null
    if (pageRef) {
      record = await store.readByRef(pageRef)
      const currentRef = await store.readRef(page.pageId ?? page.id)
      if (currentRef?.sha256 !== pageRef.sha256) await store.repairRef(pageRef)
    } else {
      record = await store.readPage(page.pageId ?? page.id)
    }
    if (!record) return null
    if (record.layout.projectId !== projection.projectId || record.layout.pageId !== projection.pageId) {
      fail('layout_identity_mismatch', '现有排版不属于当前标准项目或页面。', {
        layoutProjectId: record.layout.projectId,
        projectId: projection.projectId,
        layoutPageSourceId: record.layout.pageId,
        pageId: projection.pageId,
      }, 409)
    }
    return record
  }

  async function attachPrepared({ before, pageId, prepared, source }) {
    if (prepared.noOp) {
      const page = pageForState(before, pageId)
      if (page.layoutRef?.sha256 === prepared.ref.sha256) {
        return { state: before, record: prepared, projectNoOp: true }
      }
    }
    const nextState = await repository.transactContent({
      baseRevision: before.project.currentRevision,
      source,
      detail: {
        actionType: 'layout.ref.publish',
        pageId,
        layoutPageId: prepared.ref.layoutPageId,
        layoutRevision: prepared.ref.layoutRevision,
        layoutSha256: prepared.ref.sha256,
      },
    }, draft => {
      const page = pageForState(draft, pageId)
      page.layoutRef = clone(prepared.ref)
      return draft
    })
    await store.publishPrepared(prepared)
    return { state: nextState, record: prepared, projectNoOp: false }
  }

  async function ensure({ pageId, baseRevision, source = 'human' } = {}) {
    const before = repository.getState()
    if (before.project.currentRevision !== baseRevision) {
      throw new StudioError(ERROR_CODES.STALE_REVISION, '排版基于的项目版本已经变化。', {
        expected: baseRevision, actual: before.project.currentRevision,
      }, 409)
    }
    const page = pageForState(before, pageId)
    const projection = projectionForState(before, pageId)
    const existing = await loadExisting(before, page, projection)
    let candidate
    let expectedLayoutRevision
    if (existing) {
      candidate = existing.layout.sourceStateHash === projection.sourceStateHash
        ? existing.layout
        : reconcileLayoutSources(existing.layout, projection.sources, projection.projectRevision)
      candidate.sourceStateHash = projection.sourceStateHash
      expectedLayoutRevision = existing.layout.layoutRevision
    } else {
      candidate = defaultLayout(projection)
      expectedLayoutRevision = -1
    }
    const prepared = await store.preparePage(candidate, {
      expectedLayoutRevision,
      sourceProjectRevision: projection.projectRevision,
      sourceStateHash: projection.sourceStateHash,
    })
    const attached = await attachPrepared({ before, pageId, prepared, source })
    const currentProjection = projectionForState(attached.state, pageId)
    const renderPlan = createLayoutRenderPlan(prepared.layout, currentProjection.sources)
    return responseFor(attached.state, prepared.layout, prepared.ref, currentProjection, renderPlan, {
      created: !existing,
      reconciled: Boolean(existing && existing.layout.sourceStateHash !== projection.sourceStateHash),
      noOp: prepared.noOp && attached.projectNoOp,
    })
  }

  async function get({ pageId, reconcile = false } = {}) {
    const state = repository.getState()
    const page = pageForState(state, pageId)
    const projection = projectionForState(state, pageId)
    const existing = await loadExisting(state, page, projection)
    if (!existing) return { state, layout: null, layoutRef: null, renderPlan: null, sourceProjection: { ...projection, sources: undefined }, exists: false }
    if (reconcile && existing.layout.sourceStateHash !== projection.sourceStateHash) {
      return ensure({ pageId, baseRevision: state.project.currentRevision, source: 'workspace-sync' })
    }
    return responseFor(state, existing.layout, existing.ref, projection, createLayoutRenderPlan(existing.layout, projection.sources), {
      exists: true,
      stale: existing.layout.sourceStateHash !== projection.sourceStateHash,
    })
  }

  async function mutate({ pageId, baseRevision, expectedLayoutRevision, operation, source = 'human' } = {}) {
    const before = repository.getState()
    if (before.project.currentRevision !== baseRevision) {
      throw new StudioError(ERROR_CODES.STALE_REVISION, '排版基于的项目版本已经变化。', { expected: baseRevision, actual: before.project.currentRevision }, 409)
    }
    const page = pageForState(before, pageId)
    const projection = projectionForState(before, pageId)
    const existing = await loadExisting(before, page, projection)
    if (!existing) fail('layout_not_initialized', '请先创建当前页面的排版。', { pageId }, 409)
    if (existing.layout.layoutRevision !== expectedLayoutRevision) {
      fail('layout_revision_conflict', '排版版本已经变化。', { expectedLayoutRevision, actualLayoutRevision: existing.layout.layoutRevision }, 409)
    }
    let candidate = existing.layout.sourceStateHash === projection.sourceStateHash
      ? existing.layout
      : reconcileLayoutSources(existing.layout, projection.sources, projection.projectRevision)
    candidate.sourceStateHash = projection.sourceStateHash
    const type = operation?.type
    if (type === 'frame') candidate = updateLayoutElementFrame(candidate, operation.layoutElementId, operation.frame)
    else if (type === 'style') candidate = updateLayoutElementStyle(candidate, operation.layoutElementId, operation.style)
    else if (type === 'detach') {
      const element = candidate.elements.find(item => item.layoutElementId === operation.layoutElementId)
      if (!element) fail('layout_element_not_found', '排版元素不存在。', { layoutElementId: operation.layoutElementId }, 404)
      const payload = element.syncPolicy === 'live' ? projection.sources[sourceRefKey(element.sourceRef)] : element.localPayload
      candidate = detachLayoutElement(candidate, operation.layoutElementId, operation.localPayload ?? payload ?? { content: '' })
    } else if (type === 'relink') {
      const key = sourceRefKey(operation.sourceRef)
      if (!Object.hasOwn(projection.sources, key)) fail('layout_source_missing', '不能绑定到不存在的草案来源。', { sourceRef: operation.sourceRef }, 409)
      candidate = relinkLayoutElement(candidate, operation.layoutElementId, operation.sourceRef, projection.projectRevision)
    } else if (type === 'reorder') candidate = reorderLayoutElement(candidate, operation.layoutElementId, operation.zIndex)
    else fail('layout_operation_unsupported', '不支持的排版操作。', { type }, 400)
    assertLayoutPageDocument(candidate)
    const prepared = await store.preparePage(candidate, {
      expectedLayoutRevision,
      sourceProjectRevision: projection.projectRevision,
      sourceStateHash: projection.sourceStateHash,
    })
    const attached = await attachPrepared({ before, pageId, prepared, source })
    const currentProjection = projectionForState(attached.state, pageId)
    return responseFor(attached.state, prepared.layout, prepared.ref, currentProjection, createLayoutRenderPlan(prepared.layout, currentProjection.sources), {
      noOp: prepared.noOp && attached.projectNoOp,
    })
  }

  return Object.freeze({ root: store.root, store, ensure, get, mutate })
}
