const clone = value => structuredClone(value)

const FORBIDDEN_CONTEXT_KEYS = new Set([
  'archive', 'standardarchive', 'migration', 'backup', 'view', 'ui',
  'database64', 'data_base64', 'dataurl', 'bytes', 'binary',
])

function semanticClone(value) {
  if (typeof value === 'string') return /^data:/iu.test(value) ? null : value
  if (value == null || typeof value !== 'object') return value
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return null
  if (Array.isArray(value)) return value.map(semanticClone).filter(item => item !== null)
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !FORBIDDEN_CONTEXT_KEYS.has(key.toLowerCase()))
    .map(([key, child]) => [key, semanticClone(child)]))
}

export function projectAgentContext(state, { pageId = null, stage = null } = {}) {
  const selected = (state.pages ?? []).find(page => page.id === pageId) ?? null
  const project = {
      id: state.project?.id ?? null,
      title: state.project?.title ?? null,
    }
  if (state.project?.currentRevision !== undefined) project.currentRevision = state.project.currentRevision
  return {
    project,
    stage: stage ?? state.ui?.stage ?? null,
    page: selected ? {
      id: selected.id,
      heading: selected.heading ?? '',
      body: selected.body ?? '',
      bullets: clone(selected.bullets ?? []),
      assets: (selected.assets ?? []).map(asset => ({ id: asset.id, name: asset.name ?? null, objectRef: clone(asset.objectRef ?? null), mimeType: asset.mimeType ?? asset.type ?? null })),
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
    id: node.id,
    outlineNodeId: node.outlineNodeId ?? node.id,
    parentOutlineNodeId: node.parentOutlineNodeId ?? null,
    title: node.title ?? '',
    order: node.order ?? 0,
    children: (node.children ?? []).map(outlineProjection),
  }
}

function assetMetadata(asset) {
  const objectRef = asset.objectRef && typeof asset.objectRef === 'object' ? {
    sha256: asset.objectRef.sha256 ?? null,
    sizeBytes: asset.objectRef.sizeBytes ?? null,
    mimeType: asset.objectRef.mimeType ?? asset.mimeType ?? null,
  } : null
  return {
    pageAssetId: asset.pageAssetId ?? null,
    assetId: asset.assetId ?? asset.id ?? null,
    name: asset.name ?? null,
    role: asset.role ?? null,
    caption: asset.caption ?? '',
    order: asset.order ?? null,
    mimeType: asset.mimeType ?? asset.type ?? null,
    sizeBytes: asset.sizeBytes ?? objectRef?.sizeBytes ?? null,
    widthPx: asset.widthPx ?? null,
    heightPx: asset.heightPx ?? null,
    objectRef,
  }
}

function pageSummary(page) {
  if (!page) return null
  return {
    id: page.id,
    pageId: page.pageId ?? page.id,
    outlineNodeId: page.outlineNodeId,
    order: page.order ?? 0,
    heading: page.heading ?? page.contentBlocks?.find(block => block.contentBlockId === page.titleBlockId)?.content ?? '',
  }
}

function pageProjection(page) {
  if (!page) return null
  const summary = pageSummary(page)
  const bodyBlock = page.contentBlocks?.find(block => block.type === 'text' && block.role === 'body')
  const listBlock = page.contentBlocks?.find(block => block.type === 'list')
  const script = (page.scriptBlocks ?? []).slice().sort((left, right) => left.order - right.order).map(block => block.content).join('\n\n')
  return {
    ...summary,
    draftDocumentId: page.draftDocumentId,
    titleBlockId: page.titleBlockId,
    heading: summary.heading,
    body: page.body ?? bodyBlock?.content ?? '',
    bullets: clone(page.bullets ?? listBlock?.items?.slice().sort((left, right) => left.order - right.order).map(item => item.content) ?? []),
    contentBlocks: semanticClone(page.contentBlocks ?? []),
    script: page.script ?? script,
    scriptBlocks: semanticClone(page.scriptBlocks ?? []),
    assets: (page.pageAssets ?? page.assets ?? []).map(assetMetadata),
  }
}

function immutableSubmissionProjection(submission) {
  const fields = [
    'reviewSubmissionId', 'reviewRoundId', 'projectId', 'stage', 'scopeKey', 'pageId', 'baseRevision',
    'annotationSnapshots', 'allowedCommands', 'writableIds', 'idempotencyKey', 'createdAt',
  ]
  return Object.fromEntries(fields.map(field => [field, clone(submission[field])]))
}

export function reviewSubmissionContext(snapshot, submission) {
  const pages = [...(snapshot.pages ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const page = submission.pageId ? pages.find(item => item.id === submission.pageId) ?? null : null
  const pageIndex = page ? pages.findIndex(item => item.id === page.id) : -1
  const owningOutlineNode = page ? findOutlineNode(snapshot.outline, page.outlineNodeId) : null
  const projectRules = snapshot.project?.extensionPayload?.standardArchive?.documents?.['rules.json']
    ?? snapshot.projectRules
    ?? null
  return {
    contractVersion: 'report-studio.v0.1.1',
    project: {
      id: snapshot.project?.id ?? null,
      title: snapshot.project?.title ?? null,
      baseRevision: submission.baseRevision,
    },
    stage: submission.stage,
    submission: immutableSubmissionProjection(submission),
    annotations: clone(submission.annotationSnapshots ?? []),
    taskScope: {
      stage: submission.stage,
      scopeKey: submission.scopeKey,
      pageId: submission.pageId,
      writableIds: clone(submission.writableIds ?? []),
      allowedCommands: clone(submission.allowedCommands ?? []),
    },
    ...(submission.stage === 'outline' ? { outline: (snapshot.outline ?? []).map(outlineProjection) } : {}),
    page: pageProjection(page),
    owningOutlineNode: outlineProjection(owningOutlineNode),
    previousPage: pageIndex > 0 ? pageSummary(pages[pageIndex - 1]) : null,
    nextPage: pageIndex >= 0 && pageIndex < pages.length - 1 ? pageSummary(pages[pageIndex + 1]) : null,
    projectRules: semanticClone(projectRules),
  }
}
