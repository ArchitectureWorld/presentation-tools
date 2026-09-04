import { assertCanonicalSnapshot } from '../studio-contracts/index.mjs'
import {
  LayoutSourceContractError,
  buildLayoutSourceIndex as buildDraftLayoutSourceIndex,
} from './draft-index.mjs'

export { LayoutSourceContractError }
export const LAYOUT_SOURCE_PROJECTION_VERSION = 'report-studio.layout-source.v0.2.0-alpha.3'

const clone = value => structuredClone(value)
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0

function fail(code, message, details = undefined) {
  throw new LayoutSourceContractError(code, message, details)
}

function assertSnapshot(snapshot) {
  if (!isObject(snapshot)) {
    fail('layout_source_snapshot_required', 'Layout source projection requires a Canonical Snapshot.')
  }
  try {
    assertCanonicalSnapshot(snapshot)
  } catch (error) {
    fail('layout_source_invalid_snapshot', 'Canonical Snapshot failed Report Studio validation.', {
      causeCode: error?.code ?? null,
      causeMessage: error?.message ?? String(error),
    })
  }
  return snapshot
}

function assertProjectRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('layout_source_invalid_revision', 'projectRevision must be a non-negative safe integer.', { projectRevision: value })
  }
  return value
}

function assertStateHash(value) {
  if (value === null || value === undefined) return null
  if (!/^[0-9a-f]{64}$/u.test(String(value))) {
    fail('layout_source_invalid_state_hash', 'sourceStateHash must be a lowercase SHA-256 value or null.', { sourceStateHash: value })
  }
  return value
}

function projectionInput(input) {
  if (!isObject(input) || !Object.hasOwn(input, 'snapshot')) {
    fail(
      'layout_source_snapshot_required',
      'Draft-only layout source input is no longer supported. Pass { snapshot, pageId, projectRevision, resolvedPageAssets }.',
    )
  }
  if (Object.hasOwn(input, 'projectId')) {
    fail(
      'layout_source_project_id_override_forbidden',
      'projectId is selected exclusively from CanonicalSnapshot.project.projectId and cannot be overridden by callers.',
    )
  }

  const snapshot = assertSnapshot(input.snapshot)
  if (!isNonEmptyString(input.pageId)) {
    fail('layout_source_page_missing', 'Layout source projection requires pageId.', { pageId: input.pageId ?? null })
  }
  const page = snapshot.pages.find(candidate => candidate.pageId === input.pageId || candidate.id === input.pageId)
  if (!page) {
    fail('layout_source_page_missing', `Canonical Snapshot does not contain pageId: ${input.pageId}`, { pageId: input.pageId })
  }

  const projectRevision = assertProjectRevision(input.projectRevision)
  const sourceStateHash = assertStateHash(input.sourceStateHash)
  const resolvedPageAssets = input.resolvedPageAssets ?? page.pageAssets ?? []
  if (!Array.isArray(resolvedPageAssets)) {
    fail('layout_source_invalid_document', 'resolvedPageAssets must be an array.')
  }

  return { snapshot, page, projectRevision, sourceStateHash, resolvedPageAssets }
}

export function buildLayoutSourceProjection(input) {
  const { snapshot, page, projectRevision, sourceStateHash, resolvedPageAssets } = projectionInput(input)
  const projectId = snapshot.project.projectId
  const draftPage = { ...clone(page), projectId }
  const sources = buildDraftLayoutSourceIndex(draftPage, resolvedPageAssets)

  return {
    schemaVersion: LAYOUT_SOURCE_PROJECTION_VERSION,
    projectId,
    pageId: page.pageId,
    draftDocumentId: page.draftDocumentId,
    projectRevision,
    sourceStateHash,
    sources,
  }
}

export function buildLayoutSourceIndex(input) {
  return buildLayoutSourceProjection(input).sources
}
