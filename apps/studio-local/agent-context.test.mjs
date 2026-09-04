import test from 'node:test'
import assert from 'node:assert/strict'
import { projectAgentContext, reviewSubmissionContext } from './agent-context.mjs'
import { createInitialState, executeAction, submitReviewRound } from '../../packages/studio-core/index.mjs'

test('agent context projection omits binary archives, migration backups and unrelated page bodies', () => {
  const result = projectAgentContext({
    project: { id: 'project_1', title: '项目', currentRevision: 2 },
    pages: [{ id: 'page_a', heading: '当前', body: '保留', assets: [{ dataUrl: 'data:image/png;base64,secret' }] }, { id: 'page_b', body: '不应泄露' }],
    extensionPayload: { standardArchive: { files: [{ dataBase64: 'secret' }] } },
    migration: { backup: { state: 'secret' } },
  }, { pageId: 'page_a' })
  const text = JSON.stringify(result)
  assert.equal(result.page.id, 'page_a')
  for (const forbidden of ['dataBase64', 'dataUrl', 'standardArchive', 'backup', '不应泄露', 'secret']) assert.equal(text.includes(forbidden), false)
})

test('ReviewSubmission context uses its frozen page and exposes only semantic neighbours, assets and project rules', async () => {
  let state = createInitialState()
  for (const title of ['前页', '当前页', '后页']) state = executeAction(state, { type: 'outline.add', parentId: null, title }).state
  for (const node of state.outline) state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: node.id }).state
  for (const [index, page] of state.pages.entries()) {
    state = executeAction(state, { type: 'draft.update', pageId: page.id, patch: { body: `正文-${index + 1}` } }).state
  }
  const page = state.pages[1]
  state.project.extensionPayload = {
    standardArchive: {
      documents: { 'rules.json': { audience: '甲方', forbidden: ['虚构数据'] } },
      files: [{ dataBase64: 'never expose bytes', objectRef: { sha256: 'a'.repeat(64) } }],
    },
  }
  state.pages[1].pageAssets = [{
    pageAssetId: createInitialState().project.id.replace('project_', 'page_asset_'),
    assetId: createInitialState().project.id.replace('project_', 'asset_'),
    role: 'supporting', caption: '本页图', order: 0, sourceRefs: [], dataUrl: 'data:image/png;base64,secret',
  }]
  state.pages[1].contentBlocks[0].dataBase64 = 'block secret'
  state.pages[1].contentBlocks[0].archive = { private: 'archive secret' }
  state.pages[1].assets = structuredClone(state.pages[1].pageAssets)
  state = executeAction(state, { type: 'ui.setPage', pageId: page.id }).state
  state = executeAction(state, { type: 'annotation.add', scopeKey: `draft:${page.id}`, target: { type: 'page', id: page.id, label: '当前页' }, instruction: '精简正文' }).state
  const submitted = submitReviewRound(state, { scopeKey: `draft:${page.id}` })
  submitted.state.ui.activePageId = submitted.state.pages[2].id

  const context = reviewSubmissionContext(submitted.state, submitted.submission)
  const text = JSON.stringify(context)
  assert.equal(context.page.id, page.id)
  assert.equal(context.page.body, '正文-2')
  assert.equal(context.owningOutlineNode.id, state.outline[1].id)
  assert.equal(context.previousPage.heading, '前页')
  assert.equal(context.nextPage.heading, '后页')
  assert.deepEqual(context.projectRules, { audience: '甲方', forbidden: ['虚构数据'] })
  assert.equal(context.submission.scopeKey, `draft:${page.id}`)
  assert.deepEqual(context.taskScope.allowedCommands, submitted.submission.allowedCommands)
  for (const forbidden of ['正文-1', '正文-3', 'dataBase64', 'dataUrl', 'standardArchive', 'archive', 'never expose bytes', 'secret', 'ui']) assert.equal(text.includes(forbidden), false)
})

test('ReviewSubmission context projects every nested semantic object through explicit field allowlists', () => {
  let state = createInitialState()
  state = executeAction(state, { type: 'outline.add', parentId: null, title: '安全投影' }).state
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
  const page = state.pages[0]
  state.project.extensionPayload = {
    standardArchive: {
      documents: {
        'rules.json': {
          audience: '甲方',
          forbidden: ['虚构数据'],
          terminology: { FAR: '容积率', binaryPayload: 'rule-binary-secret' },
          privateExtension: { rawBytes: 'rule-raw-secret', viewPrivate: 'rule-view-secret' },
        },
      },
    },
  }
  Object.assign(page.contentBlocks[0], {
    rawBytes: 'block-raw-secret',
    privateExtension: {
      binaryPayload: 'block-binary-secret',
      base64Chunk: 'block-base64-secret',
      dataUrlVariant: 'block-data-url-secret',
      archivePayload: 'block-archive-secret',
      migrationBackup: 'block-migration-secret',
      viewPrivate: 'block-view-secret',
    },
  })
  page.scriptBlocks.push({
    scriptBlockId: 'script_block_context_test', order: 0, content: '讲解词', estimatedDurationSeconds: null,
    sourceRefs: [], migrationBackup: 'script-migration-secret',
  })
  page.pageAssets.push({
    pageAssetId: 'page_asset_context_test', assetId: 'asset_context_test', role: 'supporting', caption: '图示', order: 0,
    sourceRefs: [], binaryPayload: 'asset-binary-secret',
    objectRef: { sha256: 'a'.repeat(64), sizeBytes: 10, mimeType: 'image/png', rawBytes: 'object-ref-secret' },
  })
  page.assets = structuredClone(page.pageAssets)
  state = executeAction(state, {
    type: 'annotation.add', scopeKey: `draft:${page.id}`,
    target: { type: 'page', id: page.id, label: '安全投影', rawBytes: 'target-raw-secret', viewPrivate: 'target-view-secret' },
    instruction: '检查字段边界',
  }).state
  const submitted = submitReviewRound(state, { scopeKey: `draft:${page.id}` })
  Object.assign(submitted.submission.annotationSnapshots[0], {
    archivePayload: 'annotation-archive-secret',
    privateExtension: { binaryPayload: 'annotation-binary-secret' },
  })
  submitted.state.project.title = { viewPrivate: 'project-title-secret' }
  submitted.submission.scopeKey = { binaryPayload: 'scope-key-secret' }
  submitted.submission.baseRevision = { archivePayload: 'revision-secret' }

  const context = reviewSubmissionContext(submitted.state, submitted.submission)
  const serialized = JSON.stringify(context)

  assert.deepEqual(context.submission.annotationSnapshots[0].target, { type: 'page', id: page.id, label: '安全投影' })
  assert.deepEqual(context.annotations[0].target, { type: 'page', id: page.id, label: '安全投影' })
  assert.equal(context.page.contentBlocks[0].content, '安全投影')
  assert.equal(context.page.scriptBlocks[0].content, '讲解词')
  assert.deepEqual(context.projectRules.terminology, { FAR: '容积率' })
  for (const forbidden of [
    'rawBytes', 'binaryPayload', 'base64Chunk', 'dataUrlVariant', 'archivePayload', 'migrationBackup', 'viewPrivate',
    'target-raw-secret', 'annotation-binary-secret', 'block-base64-secret', 'script-migration-secret', 'asset-binary-secret', 'rule-view-secret',
    'project-title-secret', 'scope-key-secret', 'revision-secret',
  ]) assert.equal(serialized.includes(forbidden), false, `context leaked ${forbidden}`)
})

test('draft context returns only the owning node summary while outline context retains descendants', () => {
  let state = createInitialState()
  state = executeAction(state, { type: 'outline.add', parentId: null, title: '父节点' }).state
  const parentId = state.outline[0].id
  state = executeAction(state, { type: 'outline.add', parentId, title: '当前节点' }).state
  const currentId = state.outline[0].children[0].id
  state = executeAction(state, { type: 'outline.add', parentId: currentId, title: '不得暴露的后代' }).state
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: currentId }).state
  const page = state.pages[0]
  state = executeAction(state, {
    type: 'annotation.add', scopeKey: `draft:${page.id}`,
    target: { type: 'page', id: page.id, label: '当前节点' }, instruction: '检查层级边界',
  }).state
  const submitted = submitReviewRound(state, { scopeKey: `draft:${page.id}` })

  const context = reviewSubmissionContext(submitted.state, submitted.submission)

  assert.deepEqual(context.owningOutlineNode, {
    id: currentId,
    outlineNodeId: currentId,
    parentOutlineNodeId: parentId,
    title: '当前节点',
    order: 0,
  })
  assert.equal(JSON.stringify(context).includes('不得暴露的后代'), false)

  let outlineState = executeAction(submitted.state, {
    type: 'annotation.add', scopeKey: 'outline:root',
    target: { type: 'outline-node', id: currentId, label: '当前节点' }, instruction: '检查完整大纲',
  }).state
  const outlineSubmission = submitReviewRound(outlineState, { scopeKey: 'outline:root', stage: 'outline' })
  const outlineContext = reviewSubmissionContext(outlineSubmission.state, outlineSubmission.submission)
  assert.equal(outlineContext.outline[0].children[0].children[0].title, '不得暴露的后代')
})
