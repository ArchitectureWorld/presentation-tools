function safeString(value) {
  return typeof value === 'string' && !/^data:/iu.test(value) ? value : undefined
}

function safeScalar(value) {
  if (typeof value === 'string') return safeString(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  return undefined
}

function safeStrings(value) {
  return Array.isArray(value) ? value.map(safeString).filter(item => item !== undefined) : []
}

function sourceRefProjection(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'object') return null
  const projection = {
    provider: safeString(sourceRef.provider),
    sourceProjectId: safeString(sourceRef.sourceProjectId),
    sourceRevision: safeScalar(sourceRef.sourceRevision),
    objectIds: safeStrings(sourceRef.objectIds),
    evidenceIds: safeStrings(sourceRef.evidenceIds),
  }
  const sourceSnapshotSha256 = safeString(sourceRef.sourceSnapshotSha256)
  if (sourceSnapshotSha256 !== undefined) projection.sourceSnapshotSha256 = sourceSnapshotSha256
  return projection
}

function sourceRefsProjection(sourceRefs) {
  return Array.isArray(sourceRefs) ? sourceRefs.map(sourceRefProjection).filter(Boolean) : []
}

function annotationTargetProjection(target) {
  if (!target || typeof target !== 'object') return null
  return {
    type: safeString(target.type),
    id: safeString(target.id),
    label: safeString(target.label),
  }
}

function annotationSnapshotProjection(annotation) {
  if (!annotation || typeof annotation !== 'object') return null
  return {
    annotationId: safeString(annotation.annotationId),
    id: safeString(annotation.id),
    annotationVersion: safeScalar(annotation.annotationVersion),
    version: safeScalar(annotation.version),
    target: annotationTargetProjection(annotation.target),
    instruction: safeString(annotation.instruction),
    contentHash: safeString(annotation.contentHash),
  }
}

export function projectAgentContext(state, { pageId = null, stage = null } = {}) {
  const selected = (state.pages ?? []).find(page => page.id === pageId) ?? null
  const project = {
      id: safeString(state.project?.id) ?? null,
      title: safeString(state.project?.title) ?? null,
    }
  const currentRevision = safeScalar(state.project?.currentRevision)
  if (currentRevision !== undefined) project.currentRevision = currentRevision
  return {
    project,
    stage: safeString(stage) ?? safeString(state.ui?.stage) ?? null,
    page: selected ? {
      id: safeString(selected.id),
      heading: safeString(selected.heading) ?? '',
      body: safeString(selected.body) ?? '',
      bullets: safeStrings(selected.bullets),
      assets: (selected.pageAssets ?? selected.assets ?? []).map(assetMetadata),
    } : null,
  }
}

function findOutlineNode(nodes, outlineNodeId) {
  for (const node of nodes ?? []) {
    if (node.id === outlineNodeId || node.outlineNodeId === outlineNodeId) return node
    const found = findOutlineNode(node.children, outlineNodeId)
    if (found) return found
  }
  return null
}

function outlineProjection(node) {
  if (!node) return null
  return {
    id: safeString(node.id),
    outlineNodeId: safeString(node.outlineNodeId) ?? safeString(node.id),
    parentOutlineNodeId: safeString(node.parentOutlineNodeId) ?? null,
    title: safeString(node.title) ?? '',
    order: safeScalar(node.order) ?? 0,
    children: (node.children ?? []).map(outlineProjection),
  }
}

function outlineNodeSummary(node) {
  if (!node) return null
  return {
    id: safeString(node.id),
    outlineNodeId: safeString(node.outlineNodeId) ?? safeString(node.id),
    parentOutlineNodeId: safeString(node.parentOutlineNodeId) ?? null,
    title: safeString(node.title) ?? '',
    order: safeScalar(node.order) ?? 0,
  }
}

function assetMetadata(asset) {
  const objectRef = asset.objectRef && typeof asset.objectRef === 'object' ? {
    sha256: safeString(asset.objectRef.sha256) ?? null,
    sizeBytes: safeScalar(asset.objectRef.sizeBytes) ?? null,
    mimeType: safeString(asset.objectRef.mimeType) ?? safeString(asset.mimeType) ?? null,
  } : null
  return {
    pageAssetId: safeString(asset.pageAssetId) ?? null,
    assetId: safeString(asset.assetId) ?? safeString(asset.id) ?? null,
    name: safeString(asset.name) ?? null,
    role: safeString(asset.role) ?? null,
    caption: safeString(asset.caption) ?? '',
    order: safeScalar(asset.order) ?? null,
    mimeType: safeString(asset.mimeType) ?? safeString(asset.type) ?? null,
    sizeBytes: safeScalar(asset.sizeBytes) ?? objectRef?.sizeBytes ?? null,
    widthPx: safeScalar(asset.widthPx) ?? null,
    heightPx: safeScalar(asset.heightPx) ?? null,
    objectRef,
    sourceRefs: sourceRefsProjection(asset.sourceRefs),
  }
}

function listItemProjection(item) {
  if (!item || typeof item !== 'object') return null
  return {
    listItemId: safeString(item.listItemId),
    content: safeString(item.content),
    order: safeScalar(item.order),
    contentNature: safeString(item.contentNature),
    sourceRefs: sourceRefsProjection(item.sourceRefs),
  }
}

function metricProjection(metric) {
  if (!metric || typeof metric !== 'object') return null
  return {
    metricId: safeString(metric.metricId),
    label: safeString(metric.label),
    value: safeScalar(metric.value),
    unit: safeScalar(metric.unit),
    note: safeScalar(metric.note),
    order: safeScalar(metric.order),
    contentNature: safeString(metric.contentNature),
    sourceRefs: sourceRefsProjection(metric.sourceRefs),
  }
}

function tableColumnProjection(column) {
  if (!column || typeof column !== 'object') return null
  return {
    tableColumnId: safeString(column.tableColumnId),
    label: safeString(column.label),
    order: safeScalar(column.order),
  }
}

function tableCellProjection(cell) {
  if (!cell || typeof cell !== 'object') return null
  return {
    tableCellId: safeString(cell.tableCellId),
    tableColumnId: safeString(cell.tableColumnId),
    content: safeScalar(cell.content),
    contentNature: safeString(cell.contentNature),
    sourceRefs: sourceRefsProjection(cell.sourceRefs),
  }
}

function tableRowProjection(row) {
  if (!row || typeof row !== 'object') return null
  return {
    tableRowId: safeString(row.tableRowId),
    label: safeString(row.label),
    order: safeScalar(row.order),
    cells: Array.isArray(row.cells) ? row.cells.map(tableCellProjection).filter(Boolean) : [],
    sourceRefs: sourceRefsProjection(row.sourceRefs),
  }
}

function contentBlockProjection(block) {
  if (!block || typeof block !== 'object') return null
  const projection = {
    contentBlockId: safeString(block.contentBlockId),
    type: safeString(block.type),
    role: safeString(block.role),
    order: safeScalar(block.order),
    sourceRefs: sourceRefsProjection(block.sourceRefs),
  }
  if (block.type === 'heading' || block.type === 'text') {
    projection.content = safeString(block.content)
    if (block.type === 'text') projection.contentNature = safeString(block.contentNature)
  } else if (block.type === 'list') {
    projection.listStyle = safeString(block.listStyle)
    projection.items = Array.isArray(block.items) ? block.items.map(listItemProjection).filter(Boolean) : []
  } else if (block.type === 'metric_group') {
    projection.metrics = Array.isArray(block.metrics) ? block.metrics.map(metricProjection).filter(Boolean) : []
  } else if (block.type === 'table') {
    projection.columns = Array.isArray(block.columns) ? block.columns.map(tableColumnProjection).filter(Boolean) : []
    projection.rows = Array.isArray(block.rows) ? block.rows.map(tableRowProjection).filter(Boolean) : []
  }
  return projection
}

function scriptBlockProjection(block) {
  if (!block || typeof block !== 'object') return null
  return {
    scriptBlockId: safeString(block.scriptBlockId),
    order: safeScalar(block.order),
    content: safeString(block.content),
    estimatedDurationSeconds: safeScalar(block.estimatedDurationSeconds),
    sourceRefs: sourceRefsProjection(block.sourceRefs),
    referencedContentBlockIds: safeStrings(block.referencedContentBlockIds),
    referencedAssetIds: safeStrings(block.referencedAssetIds),
  }
}

function pageSummary(page) {
  if (!page) return null
  return {
    id: safeString(page.id),
    pageId: safeString(page.pageId) ?? safeString(page.id),
    outlineNodeId: safeString(page.outlineNodeId),
    order: safeScalar(page.order) ?? 0,
    heading: safeString(page.heading) ?? safeString(page.contentBlocks?.find(block => block.contentBlockId === page.titleBlockId)?.content) ?? '',
  }
}

function pageProjection(page) {
  if (!page) return null
  const summary = pageSummary(page)
  const bodyBlock = page.contentBlocks?.find(block => block.type === 'text' && block.role === 'body')
  const listBlock = page.contentBlocks?.find(block => block.type === 'list')
  const contentBlocks = (page.contentBlocks ?? []).map(contentBlockProjection).filter(Boolean)
  const scriptBlocks = (page.scriptBlocks ?? []).map(scriptBlockProjection).filter(Boolean)
  const script = scriptBlocks.slice().sort((left, right) => left.order - right.order).map(block => block.content).filter(content => content !== undefined).join('\n\n')
  return {
    ...summary,
    draftDocumentId: safeString(page.draftDocumentId),
    titleBlockId: safeString(page.titleBlockId),
    heading: summary.heading,
    body: safeString(page.body) ?? safeString(bodyBlock?.content) ?? '',
    bullets: safeStrings(page.bullets ?? listBlock?.items?.slice().sort((left, right) => left.order - right.order).map(item => item.content)),
    contentBlocks,
    script: safeString(page.script) ?? script,
    scriptBlocks,
    assets: (page.pageAssets ?? page.assets ?? []).map(assetMetadata),
  }
}

function immutableSubmissionProjection(submission) {
  return {
    reviewSubmissionId: safeString(submission.reviewSubmissionId),
    reviewRoundId: safeString(submission.reviewRoundId),
    projectId: safeString(submission.projectId),
    stage: safeString(submission.stage),
    scopeKey: safeString(submission.scopeKey),
    pageId: safeScalar(submission.pageId),
    baseRevision: safeScalar(submission.baseRevision),
    annotationSnapshots: (submission.annotationSnapshots ?? []).map(annotationSnapshotProjection).filter(Boolean),
    allowedCommands: safeStrings(submission.allowedCommands),
    writableIds: safeStrings(submission.writableIds),
    idempotencyKey: safeString(submission.idempotencyKey),
    createdAt: safeString(submission.createdAt),
  }
}

function privateDynamicRuleKey(key) {
  const compact = String(key).replace(/[^a-z0-9]/giu, '').toLowerCase()
  return compact === 'rawbytes'
    || compact.includes('binary')
    || compact.includes('base64')
    || compact.includes('dataurl')
    || compact.includes('archive')
    || compact.includes('migration')
    || /^(?:view|ui)(?:private|state|payload|data|config|settings)?$/u.test(compact)
    || /^(?:private|internal)(?:view|ui)$/u.test(compact)
}

function terminologyProjection(terminology) {
  if (!terminology || typeof terminology !== 'object' || Array.isArray(terminology)) return undefined
  return Object.fromEntries(Object.entries(terminology)
    .filter(([key, value]) => !privateDynamicRuleKey(key) && safeString(value) !== undefined)
    .map(([key, value]) => [key, value]))
}

function projectRulesProjection(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null
  const projection = {}
  for (const field of ['$schema', 'documentType', 'standardVersion', 'projectRulesId', 'projectId', 'language', 'audience']) {
    const value = safeString(rules[field])
    if (value !== undefined) projection[field] = value
  }
  for (const field of ['audiences', 'purposes', 'writingRules', 'truthConstraints', 'prohibitedContent', 'visualIntent', 'forbidden']) {
    if (Array.isArray(rules[field])) projection[field] = safeStrings(rules[field])
  }
  const terminology = terminologyProjection(rules.terminology)
  if (terminology !== undefined) projection.terminology = terminology
  return projection
}

export function reviewSubmissionContext(snapshot, submission) {
  const pages = [...(snapshot.pages ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const stage = safeString(submission.stage)
  const scopeKey = safeString(submission.scopeKey)
  const pageId = safeString(submission.pageId)
  const baseRevision = safeScalar(submission.baseRevision)
  const page = pageId ? pages.find(item => item.id === pageId) ?? null : null
  const pageIndex = page ? pages.findIndex(item => item.id === page.id) : -1
  const owningOutlineNode = page ? findOutlineNode(snapshot.outline, page.outlineNodeId) : null
  const projectRules = snapshot.project?.extensionPayload?.standardArchive?.documents?.['rules.json']
    ?? snapshot.projectRules
    ?? null
  const annotations = (submission.annotationSnapshots ?? []).map(annotationSnapshotProjection).filter(Boolean)
  return {
    contractVersion: 'report-studio.v0.1.1',
    project: {
      id: safeString(snapshot.project?.id) ?? null,
      title: safeString(snapshot.project?.title) ?? null,
      baseRevision,
    },
    stage,
    submission: immutableSubmissionProjection(submission),
    annotations,
    taskScope: {
      stage,
      scopeKey,
      pageId,
      writableIds: safeStrings(submission.writableIds),
      allowedCommands: safeStrings(submission.allowedCommands),
    },
    ...(stage === 'outline' ? { outline: (snapshot.outline ?? []).map(outlineProjection) } : {}),
    page: pageProjection(page),
    owningOutlineNode: outlineNodeSummary(owningOutlineNode),
    previousPage: pageIndex > 0 ? pageSummary(pages[pageIndex - 1]) : null,
    nextPage: pageIndex >= 0 && pageIndex < pages.length - 1 ? pageSummary(pages[pageIndex + 1]) : null,
    projectRules: projectRulesProjection(projectRules),
  }
}
