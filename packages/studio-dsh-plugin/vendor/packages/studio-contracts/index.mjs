import Ajv from 'ajv'
import { createStableId, createUuidV7, isStableId, stableIdPattern, UUID_V7_PATTERN } from '../../contracts/presentation-standard-project/src/ids.mjs'

export const STUDIO_SCHEMA_VERSION = 'report-studio.v0.1.1'
export const CONTROL_SCHEMA_VERSION = 'report-studio.control.v0.1.1'

export const ERROR_CODES = Object.freeze({
  MIGRATION_REQUIRED: 'migration_required',
  MIGRATION_FAILED: 'migration_failed',
  STALE_REVISION: 'stale_revision',
  STALE_REVIEW_SUBMISSION: 'stale_review_submission',
  INVALID_COMMAND: 'invalid_command',
  INVALID_REFERENCE: 'invalid_reference',
  DISPATCH_FAILED: 'dispatch_failed',
  INVALID_SUBMISSION_TRANSITION: 'invalid_submission_transition',
  PROPOSAL_ALREADY_EXISTS: 'proposal_already_exists',
  STANDARD_CONTRACT_INVALID: 'standard_contract_invalid',
  STANDARD_EXPORT_FAILED: 'standard_export_failed',
  STANDARD_IMPORT_UNSUPPORTED: 'standard_import_unsupported',
  STANDARD_IMPORT_REQUIRES_NEW_WORKSPACE: 'standard_import_requires_new_workspace',
  WORKSPACE_UNAVAILABLE: 'workspace_unavailable',
  WORKSPACE_PROJECT_MISSING: 'workspace_project_missing',
  WORKSPACE_CONTRACT_INVALID: 'workspace_contract_invalid',
  WORKSPACE_DIRTY_CONFLICT: 'local_dirty_conflict',
  REPOSITORY_LOCKED: 'repository_locked',
  REPOSITORY_INTEGRITY_ERROR: 'repository_integrity_error',
})

export const REVIEW_RUN_INTEGRATION_STATES = Object.freeze([
  'pending_dispatch',
  'dispatched',
  'dispatch_failed',
  'proposal_created',
  'accepted',
  'rejected',
  'stale',
])

export const REVIEW_SUBMISSION_TRANSITIONS = Object.freeze({
  pending_dispatch: Object.freeze(['dispatched', 'dispatch_failed']),
  dispatched: Object.freeze(['proposal_created']),
  dispatch_failed: Object.freeze(['pending_dispatch']),
  proposal_created: Object.freeze(['accepted', 'rejected', 'stale']),
  accepted: Object.freeze([]),
  rejected: Object.freeze([]),
  stale: Object.freeze([]),
})

export class StudioError extends Error {
  constructor(code, message, details = undefined, statusCode = 400) {
    super(message)
    this.name = 'StudioError'
    this.code = code
    this.details = details
    this.statusCode = statusCode
  }
}

const STANDARD_KINDS = Object.freeze({
  project: 'project',
  projectRules: 'projectRules',
  outlineDocument: 'outlineDocument',
  outlineNode: 'outlineNode',
  page: 'page',
  draftDocument: 'draftDocument',
  contentBlock: 'contentBlock',
  listItem: 'listItem',
  scriptBlock: 'scriptBlock',
  pageAsset: 'pageAsset',
  asset: 'asset',
})

const STUDIO_PREFIXES = Object.freeze({
  revision: 'revision',
  annotation: 'annotation',
  reviewRound: 'review_round',
  reviewSubmission: 'review_submission',
  reviewRun: 'review_run',
  proposal: 'proposal',
  command: 'command',
  changeSet: 'change_set',
})

export function createStudioId(kind, options = {}) {
  if (STANDARD_KINDS[kind]) return createStableId(STANDARD_KINDS[kind], options)
  const prefix = STUDIO_PREFIXES[kind]
  if (!prefix) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, `未知 Studio ID 类型：${kind}`, { kind })
  return `${prefix}_${createUuidV7(options)}`
}

const idSchema = kind => ({ type: 'string', pattern: stableIdPattern(kind).source })
const studioIdSchema = kind => ({ type: 'string', pattern: `^${STUDIO_PREFIXES[kind]}_${UUID_V7_PATTERN}$` })
const scopeKeySchema = {
  type: 'string',
  pattern: `^(?:outline:root|draft:page_${UUID_V7_PATTERN})$`,
}
const riskLevelSchema = {
  type: 'string',
  enum: ['ordinary_reversible', 'structural_review_required', 'protected_or_deferred'],
}
const commonCommandProperties = {
  commandId: studioIdSchema('command'),
  scopeKey: scopeKeySchema,
  baseRevision: { type: 'integer', minimum: 0 },
  riskLevel: riskLevelSchema,
  sourceAnnotationIds: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    items: studioIdSchema('annotation'),
  },
}
const commandBranch = (type, properties, required) => ({
  type: 'object',
  properties: {
    ...commonCommandProperties,
    type: { const: type },
    ...properties,
  },
  required: ['commandId', 'type', 'scopeKey', 'baseRevision', 'riskLevel', 'sourceAnnotationIds', ...required],
  additionalProperties: false,
})

const scalarDraftPatchSchema = {
  oneOf: ['heading', 'body', 'script'].map(field => ({
    type: 'object',
    properties: { [field]: { type: 'string' } },
    required: [field],
    additionalProperties: false,
  })),
}

export const STUDIO_COMMAND_SCHEMA = Object.freeze({
  oneOf: [
    commandBranch('project.rename', { projectId: idSchema('project'), title: { type: 'string', minLength: 1 } }, ['projectId', 'title']),
    commandBranch('outline.add', { nodeId: idSchema('outlineNode'), parentId: { anyOf: [{ type: 'null' }, idSchema('outlineNode')] }, title: { type: 'string', minLength: 1 } }, ['nodeId', 'parentId', 'title']),
    commandBranch('outline.rename', { nodeId: idSchema('outlineNode'), title: { type: 'string', minLength: 1 } }, ['nodeId', 'title']),
    commandBranch('outline.move', { nodeId: idSchema('outlineNode'), direction: { type: 'string', enum: ['up', 'down'] } }, ['nodeId', 'direction']),
    commandBranch('draft.ensurePage', { outlineNodeId: idSchema('outlineNode'), pageId: idSchema('page') }, ['outlineNodeId', 'pageId']),
    commandBranch('draft.update', { pageId: idSchema('page'), patch: scalarDraftPatchSchema }, ['pageId', 'patch']),
    commandBranch('draft.list.insert', { pageId: idSchema('page'), listItemId: idSchema('listItem'), afterListItemId: { anyOf: [{ type: 'null' }, idSchema('listItem')] }, content: { type: 'string' } }, ['pageId', 'listItemId', 'afterListItemId', 'content']),
    commandBranch('draft.list.delete', { pageId: idSchema('page'), listItemId: idSchema('listItem') }, ['pageId', 'listItemId']),
    commandBranch('draft.list.move', { pageId: idSchema('page'), listItemId: idSchema('listItem'), direction: { type: 'string', enum: ['up', 'down'] } }, ['pageId', 'listItemId', 'direction']),
  ],
})

export const STUDIO_APPLY_COMMANDS_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    submissionId: studioIdSchema('reviewSubmission'),
    projectId: idSchema('project'),
    baseRevision: { type: 'integer', minimum: 0 },
    scopeKey: scopeKeySchema,
    idempotencyKey: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1 },
    commands: { type: 'array', minItems: 1, items: STUDIO_COMMAND_SCHEMA },
  },
  required: ['submissionId', 'projectId', 'baseRevision', 'scopeKey', 'message', 'commands'],
  additionalProperties: false,
})

const ajv = new Ajv({ allErrors: true, strict: false })
const validateStudioCommand = ajv.compile(STUDIO_COMMAND_SCHEMA)
const validateStudioApplyCommands = ajv.compile(STUDIO_APPLY_COMMANDS_SCHEMA)

function schemaError(message, errors) {
  throw new StudioError(ERROR_CODES.INVALID_COMMAND, message, {
    validationErrors: clone(errors ?? []),
  }, 400)
}

export function assertStudioCommand(command) {
  if (!validateStudioCommand(command)) schemaError('Agent Command Schema 校验失败。', validateStudioCommand.errors)
  return clone(command)
}

export function assertStudioApplyCommands(input) {
  if (!validateStudioApplyCommands(input)) schemaError('Agent ChangeSet Schema 校验失败。', validateStudioApplyCommands.errors)
  return clone(input)
}

const clone = value => structuredClone(value)

function collectOutlineIds(nodes, ids) {
  for (const node of nodes ?? []) {
    if (!node?.id || ids.has(node.id)) {
      throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '大纲节点 ID 缺失或重复。', { outlineNodeId: node?.id ?? null })
    }
    ids.add(node.id)
    collectOutlineIds(node.children, ids)
  }
}

export function assertCanonicalSnapshot(snapshot) {
  if (!snapshot?.project || !Array.isArray(snapshot.outline) || !Array.isArray(snapshot.pages)) {
    throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'Canonical Snapshot 结构无效。')
  }
  const requiredId = (kind, value, label, details = {}) => {
    if (!isStableId(kind, value)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, `${label} 缺少有效的稳定 ID。`, { ...details, value: value ?? null })
    return value
  }
  requiredId('project', snapshot.project.id, 'Project')
  requiredId('project', snapshot.project.projectId, 'Project.projectId')
  requiredId('projectRules', snapshot.project.projectRulesId, 'Project.projectRulesId')
  requiredId('outlineDocument', snapshot.project.outlineDocumentId, 'Project.outlineDocumentId')
  if (snapshot.project.id !== snapshot.project.projectId || typeof snapshot.project.title !== 'string' || typeof snapshot.project.createdAt !== 'string') {
    throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'Project Canonical 字段不完整。')
  }
  const outlineIds = new Set()
  const outlineNodeIds = new Set()
  function checkOutline(nodes, parentOutlineNodeId = null) {
    const orders = new Set()
    for (const node of nodes) {
      requiredId('outlineNode', node?.id, 'OutlineNode')
      requiredId('outlineNode', node?.outlineNodeId, 'OutlineNode.outlineNodeId')
      if (node.id !== node.outlineNodeId || node.parentOutlineNodeId !== parentOutlineNodeId || !Number.isInteger(node.order) || node.order < 0 || orders.has(node.order) || typeof node.title !== 'string' || !Array.isArray(node.sourceRefs) || !Object.hasOwn(node, 'opaqueExtension')) {
        throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'OutlineNode Canonical 字段不完整。', { outlineNodeId: node.id })
      }
      if (outlineIds.has(node.id) || outlineNodeIds.has(node.outlineNodeId)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '大纲节点 ID 重复。', { outlineNodeId: node.id })
      outlineIds.add(node.id); outlineNodeIds.add(node.outlineNodeId); orders.add(node.order)
      checkOutline(node.children ?? [], node.outlineNodeId)
    }
  }
  checkOutline(snapshot.outline)
  const pageIds = new Set()
  const pageOrders = new Set()
  const projectAssetIds = new Set()
  for (const asset of snapshot.project.extensionPayload?.standardArchive?.documents?.['assets/manifest.json']?.assets ?? []) {
    projectAssetIds.add(requiredId('asset', asset?.assetId, 'Asset.assetId'))
  }
  for (const page of snapshot.pages) {
    for (const asset of page?.pageAssets ?? []) projectAssetIds.add(requiredId('asset', asset?.assetId, 'PageAsset.assetId', { pageId: page?.id ?? null }))
  }
  const draftIds = new Set(); const blockIds = new Set(); const listItemIds = new Set(); const scriptIds = new Set(); const pageAssetIds = new Set()
  for (const page of snapshot.pages) {
    requiredId('page', page?.id, 'Page')
    requiredId('page', page?.pageId, 'Page.pageId')
    requiredId('draftDocument', page?.draftDocumentId, 'Page.draftDocumentId')
    requiredId('contentBlock', page?.titleBlockId, 'Page.titleBlockId')
    if (pageIds.has(page.id) || page.id !== page.pageId || draftIds.has(page.draftDocumentId) || !Number.isInteger(page.order) || page.order < 0 || pageOrders.has(page.order) || !Array.isArray(page.contentBlocks) || !Array.isArray(page.scriptBlocks) || !Array.isArray(page.pageAssets)) {
      throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '页面 ID 缺失或重复。', { pageId: page?.id ?? null })
    }
    if (!outlineIds.has(page.outlineNodeId)) {
      throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '页面引用了不存在的大纲节点。', {
        pageId: page.id,
        outlineNodeId: page.outlineNodeId,
      })
    }
    pageIds.add(page.id); pageOrders.add(page.order); draftIds.add(page.draftDocumentId)
    const blockOrder = new Set(); const pageBlockIds = new Set()
    for (const block of page.contentBlocks) {
      requiredId('contentBlock', block?.contentBlockId, 'ContentBlock', { pageId: page.id })
      if (blockIds.has(block.contentBlockId) || !Number.isInteger(block.order) || block.order < 0 || blockOrder.has(block.order) || typeof block.type !== 'string' || typeof block.role !== 'string' || !Array.isArray(block.sourceRefs)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'ContentBlock Canonical 字段不完整。', { pageId: page.id, contentBlockId: block?.contentBlockId ?? null })
      blockIds.add(block.contentBlockId); pageBlockIds.add(block.contentBlockId); blockOrder.add(block.order)
      if (block.type === 'list') {
        if (!Array.isArray(block.items)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'List ContentBlock 缺少 items。', { pageId: page.id, contentBlockId: block.contentBlockId })
        const itemOrder = new Set()
        for (const item of block.items) {
          requiredId('listItem', item?.listItemId, 'ListItem', { pageId: page.id })
          if (listItemIds.has(item.listItemId) || !Number.isInteger(item.order) || item.order < 0 || itemOrder.has(item.order) || typeof item.content !== 'string' || !Array.isArray(item.sourceRefs)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'ListItem Canonical 字段不完整。', { pageId: page.id, listItemId: item?.listItemId ?? null })
          listItemIds.add(item.listItemId); itemOrder.add(item.order)
        }
      }
    }
    const titleBlocks = page.contentBlocks.filter(block => block.type === 'heading' && block.role === 'page_title')
    if (titleBlocks.length !== 1 || titleBlocks[0].contentBlockId !== page.titleBlockId || !pageBlockIds.has(page.titleBlockId)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'Page.titleBlockId 必须引用本页唯一的 page_title ContentBlock。', { pageId: page.id, titleBlockId: page.titleBlockId })
    const scriptOrder = new Set()
    for (const script of page.scriptBlocks) {
      requiredId('scriptBlock', script?.scriptBlockId, 'ScriptBlock', { pageId: page.id })
      if (scriptIds.has(script.scriptBlockId) || !Number.isInteger(script.order) || script.order < 0 || scriptOrder.has(script.order) || typeof script.content !== 'string' || !Array.isArray(script.referencedContentBlockIds) || !Array.isArray(script.referencedAssetIds) || !Array.isArray(script.sourceRefs)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'ScriptBlock Canonical 字段不完整。', { pageId: page.id, scriptBlockId: script?.scriptBlockId ?? null })
      for (const contentBlockId of script.referencedContentBlockIds) if (!pageBlockIds.has(contentBlockId)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'ScriptBlock 引用了不存在的 ContentBlock。', { pageId: page.id, scriptBlockId: script.scriptBlockId, contentBlockId })
      for (const assetId of script.referencedAssetIds) {
        requiredId('asset', assetId, 'ScriptBlock.referencedAssetId', { pageId: page.id, scriptBlockId: script.scriptBlockId })
        if (!projectAssetIds.has(assetId)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'ScriptBlock 引用了项目中不存在的 Asset。', { pageId: page.id, scriptBlockId: script.scriptBlockId, assetId })
      }
      scriptIds.add(script.scriptBlockId); scriptOrder.add(script.order)
    }
    const assetOrder = new Set(); const assetIds = new Set()
    for (const asset of page.pageAssets) {
      requiredId('pageAsset', asset?.pageAssetId, 'PageAsset', { pageId: page.id }); requiredId('asset', asset?.assetId, 'PageAsset.assetId', { pageId: page.id })
      if (pageAssetIds.has(asset.pageAssetId) || !Number.isInteger(asset.order) || asset.order < 0 || assetOrder.has(asset.order) || typeof asset.role !== 'string' || typeof asset.caption !== 'string' || !Array.isArray(asset.sourceRefs)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'PageAsset Canonical 字段不完整。', { pageId: page.id, pageAssetId: asset?.pageAssetId ?? null })
      pageAssetIds.add(asset.pageAssetId); assetOrder.add(asset.order); assetIds.add(asset.assetId)
    }
  }
  return snapshot
}

export function canonicalFromState(state) {
  const snapshot = {
    project: {
      id: state.project.id,
      projectId: state.project.projectId ?? state.project.id,
      projectRulesId: state.project.projectRulesId,
      outlineDocumentId: state.project.outlineDocumentId,
      title: state.project.title,
      createdAt: state.project.createdAt,
      ...(state.project.extensionPayload === undefined ? {} : { extensionPayload: clone(state.project.extensionPayload) }),
    },
    outline: clone(state.outline ?? []),
    pages: (state.pages ?? []).map(page => {
      const { heading, body, bullets, script, assets, createdAt, updatedAt, ...canonical } = clone(page)
      return canonical
    }),
  }
  return assertCanonicalSnapshot(snapshot)
}

function legacyPageView(page) {
  const view = clone(page)
  view.id ??= view.pageId
  const blocks = view.contentBlocks ?? []
  const heading = blocks.find(block => block.contentBlockId === view.titleBlockId)
    ?? blocks.find(block => block.type === 'heading' && block.role === 'page_title')
  const body = blocks.find(block => block.type === 'text' && block.role === 'body')
    ?? blocks.find(block => block.type === 'text' && block.role === 'key_message')
  const list = blocks.find(block => block.type === 'list')
  view.heading = heading?.content ?? view.heading ?? ''
  view.body = body?.content ?? view.body ?? ''
  view.bullets = (list?.items ?? view.bullets ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(item => typeof item === 'string' ? item : item.content)
  view.script = (view.scriptBlocks ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(block => block.content).join('\n\n') || view.script || ''
  view.assets = (view.pageAssets ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(link => ({
    ...clone(link), id: link.assetId, assetId: link.assetId,
  }))
  return view
}

export function projectStateFromParts({ snapshot, currentRevision, operational = {}, ui = {} }) {
  assertCanonicalSnapshot(snapshot)
  return {
    schemaVersion: STUDIO_SCHEMA_VERSION,
    project: {
      ...clone(snapshot.project),
      currentRevision,
      updatedAt: operational.project?.updatedAt ?? snapshot.project.createdAt,
    },
    outline: clone(snapshot.outline),
    pages: (snapshot.pages ?? []).map(legacyPageView),
    annotations: clone(operational.annotations ?? []),
    reviewRounds: clone(operational.reviewRounds ?? []),
    reviewSubmissions: clone(operational.reviewSubmissions ?? []),
    reviewRuns: clone(operational.reviewRuns ?? []),
    proposals: clone(operational.proposals ?? []),
    revisions: clone(operational.revisions ?? []),
    ui: clone(ui),
  }
}

export function errorPayload(error) {
  return {
    error: {
      code: error?.code ?? 'request_failed',
      message: error?.message ?? '请求失败。',
      ...(error?.details === undefined ? {} : { details: clone(error.details) }),
    },
  }
}
