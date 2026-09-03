import { createStableId, createUuidV7 } from '../../contracts/presentation-standard-project/src/ids.mjs'

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
  PROPOSAL_ALREADY_EXISTS: 'proposal_already_exists',
  STANDARD_CONTRACT_INVALID: 'standard_contract_invalid',
  STANDARD_IMPORT_UNSUPPORTED: 'standard_import_unsupported',
  STANDARD_IMPORT_REQUIRES_NEW_WORKSPACE: 'standard_import_requires_new_workspace',
  REPOSITORY_LOCKED: 'repository_locked',
  REPOSITORY_INTEGRITY_ERROR: 'repository_integrity_error',
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
  outlineNode: 'outlineNode',
  page: 'page',
  asset: 'asset',
})

const STUDIO_PREFIXES = Object.freeze({
  revision: 'revision',
  annotation: 'annotation',
  reviewRound: 'review_round',
  reviewSubmission: 'review_submission',
  proposal: 'proposal',
})

export function createStudioId(kind, options = {}) {
  if (STANDARD_KINDS[kind]) return createStableId(STANDARD_KINDS[kind], options)
  const prefix = STUDIO_PREFIXES[kind]
  if (!prefix) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, `未知 Studio ID 类型：${kind}`, { kind })
  return `${prefix}_${createUuidV7(options)}`
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
  if (!snapshot?.project?.id || !Array.isArray(snapshot.outline) || !Array.isArray(snapshot.pages)) {
    throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'Canonical Snapshot 结构无效。')
  }
  const outlineIds = new Set()
  collectOutlineIds(snapshot.outline, outlineIds)
  const pageIds = new Set()
  for (const page of snapshot.pages) {
    if (!page?.id || pageIds.has(page.id)) {
      throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '页面 ID 缺失或重复。', { pageId: page?.id ?? null })
    }
    if (!outlineIds.has(page.outlineNodeId)) {
      throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '页面引用了不存在的大纲节点。', {
        pageId: page.id,
        outlineNodeId: page.outlineNodeId,
      })
    }
    pageIds.add(page.id)
  }
  return snapshot
}

export function canonicalFromState(state) {
  const snapshot = {
    project: {
      id: state.project.id,
      title: state.project.title,
      createdAt: state.project.createdAt,
      ...(state.project.extensionPayload === undefined ? {} : { extensionPayload: clone(state.project.extensionPayload) }),
    },
    outline: clone(state.outline ?? []),
    pages: clone(state.pages ?? []),
  }
  return assertCanonicalSnapshot(snapshot)
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
    pages: clone(snapshot.pages),
    annotations: clone(operational.annotations ?? []),
    reviewRounds: clone(operational.reviewRounds ?? []),
    reviewSubmissions: clone(operational.reviewSubmissions ?? []),
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
