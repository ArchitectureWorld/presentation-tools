import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ERROR_CODES,
  assertCanonicalSnapshot,
  canonicalFromState,
  createStudioId,
  projectStateFromParts,
} from './index.mjs'

function validSnapshot({ pageCount = 1, withAsset = false } = {}) {
  const projectId = createStudioId('project')
  const outline = Array.from({ length: pageCount }, (_, order) => {
    const outlineNodeId = createStudioId('outlineNode')
    return { id: outlineNodeId, outlineNodeId, parentOutlineNodeId: null, title: `页面 ${order + 1}`, order, sourceRefs: [], opaqueExtension: null, children: [] }
  })
  const assetId = withAsset ? createStudioId('asset') : null
  const pages = outline.map((node, order) => {
    const pageId = createStudioId('page')
    const titleBlockId = createStudioId('contentBlock')
    return {
      id: pageId,
      pageId,
      outlineNodeId: node.outlineNodeId,
      draftDocumentId: createStudioId('draftDocument'),
      titleBlockId,
      order,
      contentBlocks: [{ contentBlockId: titleBlockId, type: 'heading', role: 'page_title', order: 0, content: node.title, sourceRefs: [] }],
      scriptBlocks: [],
      pageAssets: withAsset && order === 0 ? [{ pageAssetId: createStudioId('pageAsset'), assetId, role: 'supporting', caption: '', order: 0, sourceRefs: [] }] : [],
    }
  })
  return {
    snapshot: { project: { id: projectId, projectId, projectRulesId: createStudioId('projectRules'), outlineDocumentId: createStudioId('outlineDocument'), title: '有效快照', createdAt: '2026-09-03T00:00:00.000Z' }, outline, pages },
    assetId,
  }
}

test('new Studio ids use typed lowercase UUIDv7 values', () => {
  const zeroes = () => Buffer.alloc(10)
  assert.equal(
    createStudioId('page', { now: 0x01992a800000, randomBytes: zeroes }),
    'page_01992a80-0000-7000-8000-000000000000',
  )
  assert.match(createStudioId('reviewSubmission'), /^review_submission_[0-9a-f-]{36}$/)
  assert.match(createStudioId('command'), /^command_[0-9a-f-]{36}$/)
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

test('canonical validation rejects a titleBlockId that points at another page', () => {
  const { snapshot } = validSnapshot({ pageCount: 2 })
  snapshot.pages[1].titleBlockId = snapshot.pages[0].titleBlockId
  assert.throws(() => assertCanonicalSnapshot(snapshot), error => error.code === ERROR_CODES.INVALID_REFERENCE)
})

test('canonical validation requires exactly one page_title block and requires titleBlockId to reference it', () => {
  const { snapshot } = validSnapshot()
  snapshot.pages[0].contentBlocks[0].role = 'section_title'
  assert.throws(() => assertCanonicalSnapshot(snapshot), error => error.code === ERROR_CODES.INVALID_REFERENCE)

  const duplicate = validSnapshot().snapshot
  duplicate.pages[0].contentBlocks.push({ contentBlockId: createStudioId('contentBlock'), type: 'heading', role: 'page_title', order: 1, content: '重复标题', sourceRefs: [] })
  assert.throws(() => assertCanonicalSnapshot(duplicate), error => error.code === ERROR_CODES.INVALID_REFERENCE)
})

test('canonical validation rejects duplicate Page order values', () => {
  const { snapshot } = validSnapshot({ pageCount: 2 })
  snapshot.pages[1].order = snapshot.pages[0].order
  assert.throws(() => assertCanonicalSnapshot(snapshot), error => error.code === ERROR_CODES.INVALID_REFERENCE)
})

test('canonical validation rejects ScriptBlock asset references outside the project asset set', () => {
  const { snapshot } = validSnapshot({ withAsset: true })
  snapshot.pages[0].scriptBlocks.push({
    scriptBlockId: createStudioId('scriptBlock'), content: '引用项目外素材', order: 0, estimatedDurationSeconds: null,
    referencedContentBlockIds: [snapshot.pages[0].titleBlockId], referencedAssetIds: [createStudioId('asset')], sourceRefs: [],
  })
  assert.throws(() => assertCanonicalSnapshot(snapshot), error => error.code === ERROR_CODES.INVALID_REFERENCE)
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
  assert.equal(snapshot.pages.length, 0)
  const restored = projectStateFromParts({ snapshot, currentRevision: 3, operational: state, ui: state.ui })
  assert.equal(restored.annotations[0].id, 'annotation_private')
  assert.equal(restored.project.currentRevision, 3)
})

test('Agent Command schema is a closed discriminated union with typed stable ids', async () => {
  const contracts = await import('./index.mjs')
  assert.equal(typeof contracts.assertStudioCommand, 'function')
  assert.ok(Array.isArray(contracts.STUDIO_COMMAND_SCHEMA.oneOf))
  assert.ok(contracts.STUDIO_COMMAND_SCHEMA.oneOf.length >= 8)
  assert.ok(contracts.STUDIO_COMMAND_SCHEMA.oneOf.every(branch => branch.additionalProperties === false))

  const command = {
    commandId: createStudioId('command'),
    type: 'outline.rename',
    scopeKey: 'outline:root',
    baseRevision: 4,
    riskLevel: 'ordinary_reversible',
    sourceAnnotationIds: [createStudioId('annotation')],
    nodeId: createStudioId('outlineNode'),
    title: '新标题',
  }
  assert.deepEqual(contracts.assertStudioCommand(command), command)

  for (const invalid of [
    { ...command, type: 'unknown.command' },
    { ...command, extra: true },
    { ...command, nodeId: 42 },
    { ...command, commandId: 'command_not-stable' },
  ]) {
    assert.throws(() => contracts.assertStudioCommand(invalid), error => error.code === ERROR_CODES.INVALID_COMMAND)
  }
})
