import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ERROR_CODES,
  assertCanonicalSnapshot,
  canonicalFromState,
  createStudioId,
  projectStateFromParts,
} from './index.mjs'

test('new Studio ids use typed lowercase UUIDv7 values', () => {
  const zeroes = () => Buffer.alloc(10)
  assert.equal(
    createStudioId('page', { now: 0x01992a800000, randomBytes: zeroes }),
    'page_01992a80-0000-7000-8000-000000000000',
  )
  assert.match(createStudioId('reviewSubmission'), /^review_submission_[0-9a-f-]{36}$/)
})

test('canonical validation rejects a page whose outline node is missing', () => {
  const projectId = createStudioId('project')
  const pageId = createStudioId('page')
  const titleBlockId = createStudioId('contentBlock')
  const snapshot = {
    project: { id: projectId, projectId, projectRulesId: createStudioId('projectRules'), outlineDocumentId: createStudioId('outlineDocument'), title: '孤立页测试', createdAt: '2026-09-03T00:00:00.000Z' },
    outline: [],
    pages: [{ id: pageId, pageId, outlineNodeId: createStudioId('outlineNode'), draftDocumentId: createStudioId('draftDocument'), titleBlockId, order: 0, contentBlocks: [{ contentBlockId: titleBlockId, type: 'heading', role: 'page_title', order: 0, content: '孤立页', sourceRefs: [] }], scriptBlocks: [], pageAssets: [] }],
  }
  assert.throws(
    () => assertCanonicalSnapshot(snapshot),
    error => error.code === ERROR_CODES.INVALID_REFERENCE && error.details.pageId === snapshot.pages[0].id,
  )
})

test('canonical projection excludes operational and view records', () => {
  const projectId = createStudioId('project')
  const state = {
    schemaVersion: 'report-studio.v0.1.1',
    project: { id: projectId, projectId, projectRulesId: createStudioId('projectRules'), outlineDocumentId: createStudioId('outlineDocument'), title: '分层测试', currentRevision: 3, createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T01:00:00.000Z' },
    outline: [], pages: [], annotations: [{ id: 'annotation_private' }], proposals: [{ id: 'proposal_private' }],
    reviewRounds: [], reviewSubmissions: [], revisions: [], ui: { stage: 'draft', activePageId: null },
  }
  const snapshot = canonicalFromState(state)
  assert.deepEqual(Object.keys(snapshot).sort(), ['outline', 'pages', 'project'])
  assert.equal(snapshot.project.currentRevision, undefined)
  const restored = projectStateFromParts({ snapshot, currentRevision: 3, operational: state, ui: state.ui })
  assert.equal(restored.annotations[0].id, 'annotation_private')
  assert.equal(restored.project.currentRevision, 3)
})
