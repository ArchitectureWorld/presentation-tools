import test from 'node:test'
import assert from 'node:assert/strict'
import { projectAgentContext } from './agent-context.mjs'
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
  const contextModule = await import('./agent-context.mjs')
  assert.equal(typeof contextModule.reviewSubmissionContext, 'function')
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

  const context = contextModule.reviewSubmissionContext(submitted.state, submitted.submission)
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
