import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStudioId } from '../../packages/studio-contracts/index.mjs'
import { createRepository } from './repository.mjs'
import { createLayoutService } from './layout-service.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'layout-service-test-'))
  const repository = await createRepository(join(root, 'studio'))
  const initial = repository.getState()
  const outlineNodeId = createStudioId('outlineNode')
  const pageId = createStudioId('page')
  const titleBlockId = createStudioId('contentBlock')
  const bodyBlockId = createStudioId('contentBlock')
  await repository.transactContent({ baseRevision: initial.project.currentRevision, source: 'test', detail: { actionType: 'fixture' } }, state => {
    state.outline = [{
      id: outlineNodeId,
      outlineNodeId,
      parentOutlineNodeId: null,
      title: '目标',
      order: 0,
      sourceRefs: [],
      opaqueExtension: null,
      children: [],
    }]
    state.pages = [{
      id: pageId,
      pageId,
      outlineNodeId,
      draftDocumentId: createStudioId('draftDocument'),
      titleBlockId,
      order: 0,
      contentBlocks: [
        { contentBlockId: titleBlockId, type: 'heading', role: 'page_title', order: 0, content: '项目目标', sourceRefs: [] },
        { contentBlockId: bodyBlockId, type: 'text', role: 'body', order: 1, content: '建立稳定的排版链路。', sourceRefs: [] },
      ],
      scriptBlocks: [{ scriptBlockId: createStudioId('scriptBlock'), order: 0, content: '本页说明项目目标。', estimatedDurationSeconds: null, sourceRefs: [], referencedContentBlockIds: [titleBlockId], referencedAssetIds: [] }],
      pageAssets: [], assets: [], heading: '项目目标', body: '建立稳定的排版链路。', bullets: [], script: '本页说明项目目标。',
    }]
    state.ui = { stage: 'draft', activePageId: pageId }
    return state
  })
  const service = createLayoutService({ repository, layoutRoot: join(root, 'workspace', 'layouts') })
  return {
    root, repository, service, pageId, bodyBlockId,
    async close() { await repository.close(); await rm(root, { recursive: true, force: true }) },
  }
}

test('ensure creates a persisted LayoutPage and attaches an exact hash ref to the project Revision', async () => {
  const fx = await fixture()
  try {
    const before = fx.repository.getState().project.currentRevision
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: before })
    assert.equal(result.created, true)
    assert.equal(result.layout.layoutRevision, 0)
    assert.equal(result.state.project.currentRevision, before + 1)
    assert.equal(result.state.pages[0].layoutRef.sha256, result.layoutRef.sha256)
    assert.equal(result.layout.projectId, result.state.project.projectId)
    assert.ok(result.renderPlan.elements.length >= 3)
    const stored = await fx.service.store.readPage(fx.pageId)
    assert.equal(stored.ref.sha256, result.layoutRef.sha256)
  } finally { await fx.close() }
})

test('opening an unchanged layout is a complete no-op for project and layout revisions', async () => {
  const fx = await fixture()
  try {
    const created = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const revision = created.state.project.currentRevision
    const reopened = await fx.service.ensure({ pageId: fx.pageId, baseRevision: revision })
    assert.equal(reopened.noOp, true)
    assert.equal(reopened.state.project.currentRevision, revision)
    assert.equal(reopened.layout.layoutRevision, created.layout.layoutRevision)
  } finally { await fx.close() }
})

test('frame and style mutations use both project CAS and layout CAS', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const title = result.layout.elements.find(item => item.type === 'text')
    result = await fx.service.mutate({
      pageId: fx.pageId,
      baseRevision: result.state.project.currentRevision,
      expectedLayoutRevision: result.layout.layoutRevision,
      operation: { type: 'frame', layoutElementId: title.layoutElementId, frame: { x: 200, y: 120, width: 900, height: 110, rotation: 2 } },
    })
    assert.equal(result.layout.layoutRevision, 1)
    assert.deepEqual(result.layout.elements.find(item => item.layoutElementId === title.layoutElementId).frame, { x: 200, y: 120, width: 900, height: 110, rotation: 2 })
    await assert.rejects(
      fx.service.mutate({ pageId: fx.pageId, baseRevision: result.state.project.currentRevision, expectedLayoutRevision: 0, operation: { type: 'style', layoutElementId: title.layoutElementId, style: { opacity: 0.5 } } }),
      error => error.code === 'layout_revision_conflict',
    )
  } finally { await fx.close() }
})

test('draft source changes reconcile live content without moving or restyling layout elements', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const title = result.layout.elements.find(item => item.type === 'text')
    result = await fx.service.mutate({
      pageId: fx.pageId, baseRevision: result.state.project.currentRevision, expectedLayoutRevision: result.layout.layoutRevision,
      operation: { type: 'frame', layoutElementId: title.layoutElementId, frame: { x: 222, y: 88, width: 888, height: 120, rotation: 0 } },
    })
    const frame = structuredClone(result.layout.elements.find(item => item.layoutElementId === title.layoutElementId).frame)
    const style = structuredClone(result.layout.elements.find(item => item.layoutElementId === title.layoutElementId).style)
    const beforeHash = result.layout.sourceStateHash
    await fx.repository.transactContent({ baseRevision: result.state.project.currentRevision, source: 'test', detail: { actionType: 'draft-change' } }, state => {
      state.pages[0].contentBlocks.find(block => block.contentBlockId === state.pages[0].titleBlockId).content = '更新后的项目目标'
      state.pages[0].heading = '更新后的项目目标'
      return state
    })
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision, source: 'workspace-sync' })
    const after = result.layout.elements.find(item => item.layoutElementId === title.layoutElementId)
    assert.deepEqual(after.frame, frame)
    assert.deepEqual(after.style, style)
    assert.notEqual(result.layout.sourceStateHash, beforeHash)
    assert.equal(result.renderPlan.elements.find(item => item.layoutElementId === title.layoutElementId).payload.content, '更新后的项目目标')
  } finally { await fx.close() }
})

test('removed sources become orphaned while detached elements keep local payload and geometry', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const body = result.layout.elements.find(item => item.sourceRef?.contentBlockId === fx.bodyBlockId)
    result = await fx.service.mutate({
      pageId: fx.pageId, baseRevision: result.state.project.currentRevision, expectedLayoutRevision: result.layout.layoutRevision,
      operation: { type: 'detach', layoutElementId: body.layoutElementId },
    })
    const detached = structuredClone(result.layout.elements.find(item => item.layoutElementId === body.layoutElementId))
    await fx.repository.transactContent({ baseRevision: result.state.project.currentRevision, source: 'test', detail: { actionType: 'remove-body' } }, state => {
      state.pages[0].contentBlocks = state.pages[0].contentBlocks.filter(block => block.contentBlockId !== fx.bodyBlockId)
      state.pages[0].body = ''
      return state
    })
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision, source: 'workspace-sync' })
    const after = result.layout.elements.find(item => item.layoutElementId === body.layoutElementId)
    assert.equal(after.syncPolicy, 'detached')
    assert.deepEqual(after.localPayload, detached.localPayload)
    assert.deepEqual(after.frame, detached.frame)
  } finally { await fx.close() }
})

test('layouts/ survives loss of the page pointer and is reattached from the Presentation-owned store', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const sha = result.layoutRef.sha256
    await fx.repository.transactContent({ baseRevision: result.state.project.currentRevision, source: 'test', detail: { actionType: 'simulate-upstream-replace' } }, state => {
      delete state.pages[0].layoutRef
      return state
    })
    const before = fx.repository.getState().project.currentRevision
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: before, source: 'workspace-sync' })
    assert.equal(result.state.project.currentRevision, before + 1)
    assert.equal(result.state.pages[0].layoutRef.sha256, sha)
    assert.equal(result.layoutRef.sha256, sha)
  } finally { await fx.close() }
})

test('removed live sources become orphaned without losing geometry or style', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const body = result.layout.elements.find(item => item.sourceRef?.contentBlockId === fx.bodyBlockId)
    const before = structuredClone(body)
    await fx.repository.transactContent({ baseRevision: result.state.project.currentRevision, source: 'test', detail: { actionType: 'remove-live-body' } }, state => {
      state.pages[0].contentBlocks = state.pages[0].contentBlocks.filter(block => block.contentBlockId !== fx.bodyBlockId)
      state.pages[0].body = ''
      return state
    })
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision, source: 'workspace-sync' })
    const after = result.layout.elements.find(item => item.layoutElementId === body.layoutElementId)
    assert.equal(after.syncPolicy, 'live')
    assert.equal(after.elementState, 'orphaned')
    assert.deepEqual(after.frame, before.frame)
    assert.deepEqual(after.style, before.style)
    assert.equal(result.layout.syncState, 'orphaned')
  } finally { await fx.close() }
})
