import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepository } from './repository.mjs'
import { createLayoutService } from './layout-service.mjs'
import { createDesignService } from './design-service.mjs'
import { readStandardProject, writeStandardProject } from '../../packages/studio-standard-adapter/index.mjs'
import { validateProjectDirectoryWithAjv } from '../../contracts/presentation-standard-project/src/index.mjs'

const module = await import('./design-content.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('design-content.mjs')) return {}
  throw error
})
const standard = new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url)

async function fixture({ allowApply = false, protectedPageIds = [] } = {}) {
  assert.equal(typeof module.createDesignContentService, 'function', 'design content service must exist')
  const root = await mkdtemp(join(tmpdir(), 'studio-design-content-'))
  let repository = await createRepository(join(root, 'repository'))
  const imported = await readStandardProject(standard, { putBlob: repository.putBlob })
  // The checked-in unformatted example deliberately carries a cross-page
  // ScriptBlock asset reference that the layout-source contract rejects.
  // Keep this isolated Repository fixture internally consistent so every
  // content operation reaches the real inspectGrant boundary.
  imported.snapshot.pages[0].scriptBlocks[0].referencedAssetIds = []
  await repository.initializeFromStandardProject({ snapshot: imported.snapshot })
  let layoutService = createLayoutService({ repository, layoutRoot: join(root, 'layouts') })
  let designService = createDesignService({ repository, layoutService, now: () => '2026-09-06T00:00:00.000Z' })
  const sessionId = 'host-session'
  const pageIds = repository.getState().pages.map(page => page.id)
  const run = await designService.start({ sessionId, pageIds, protectedPageIds, allowApply, allowVisualGeneration: false, expiresAt: '2026-09-06T01:00:00.000Z' })
  let service = module.createDesignContentService({ repository, designService, now: () => '2026-09-06T00:00:01.000Z' })
  return {
    root,
    sessionId,
    run,
    pageIds,
    get repository() { return repository },
    get service() { return service },
    get designService() { return designService },
    useDesignService(next) { service = module.createDesignContentService({ repository, designService: next, now: () => '2026-09-06T00:00:01.000Z' }) },
    async reopen() {
      await repository.close()
      repository = await createRepository(join(root, 'repository'))
      layoutService = createLayoutService({ repository, layoutRoot: join(root, 'layouts') })
      designService = createDesignService({ repository, layoutService, now: () => '2026-09-06T00:00:00.000Z' })
      service = module.createDesignContentService({ repository, designService, now: () => '2026-09-06T00:00:01.000Z' })
    },
    async close() { await repository.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) },
  }
}

function contentText(page) {
  const values = []
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (typeof value.content === 'string') values.push(value.content)
    for (const child of Object.values(value)) visit(child)
  }
  for (const block of page.contentBlocks) visit(block)
  return values
}

test('merge prepares an exact pending Proposal and accepts into a new semantic page without losing source content', async () => {
  const fx = await fixture()
  try {
    const before = fx.repository.getState()
    const originalText = before.pages.flatMap(contentText)
    const originalScripts = before.pages.flatMap(page => page.scriptBlocks.map(block => block.content))
    const originalSourceRefs = before.pages.flatMap(page => page.contentBlocks.flatMap(block => block.sourceRefs ?? []))
    await fx.repository.transactOperational(state => {
      state.annotations.push({ id: 'annotation-history-synthetic', target: { type: 'page', id: fx.pageIds[0] }, instruction: '保留历史' })
      return state
    })
    const input = {
      sessionId: fx.sessionId,
      runId: fx.run.runId,
      baseRevision: 0,
      idempotencyKey: 'merge-v1',
      message: '合并同一论点，保留原文与讲稿',
      commands: [
        { type: 'pages.merge', pageIds: fx.pageIds, title: '更新基础与执行抓手' },
      ],
    }
    const prepared = await fx.service.prepare(input)
    assert.equal(prepared.status, 'pending')
    assert.equal(prepared.proposal.kind, 'design.content.v1')
    assert.equal(prepared.proposal.requestHash.length, 64)
    assert.deepEqual(prepared.proposal.commands, input.commands)
    assert.deepEqual(prepared.newPageIds, [])
    assert.equal(prepared.scopeConfirmationRequired, false)
    assert.equal(fx.repository.getState().project.currentRevision, 0)
    assert.deepEqual(await fx.service.prepare(input), prepared)
    await assert.rejects(fx.service.prepare({ ...input, message: '不同请求' }), { code: 'design_idempotency_conflict' })

    const accepted = await fx.service.accept({ sessionId: fx.sessionId, proposalId: prepared.proposal.id })
    assert.equal(accepted.status, 'accepted')
    assert.equal(accepted.scopeConfirmationRequired, true)
    assert.equal(accepted.newPageIds.length, 1)
    assert.ok(!fx.pageIds.includes(accepted.newPageIds[0]))
    const state = fx.repository.getState()
    assert.equal(state.project.currentRevision, 1)
    assert.deepEqual(state.pages.map(page => page.id), accepted.newPageIds)
    assert.equal(state.annotations.some(row => row.id === 'annotation-history-synthetic'), true)
    const merged = state.pages[0]
    for (const value of originalText) assert.ok(contentText(merged).includes(value), `missing original content: ${value}`)
    for (const value of originalScripts) assert.ok(merged.scriptBlocks.some(block => block.content === value), `missing original script: ${value}`)
    assert.ok(merged.contentBlocks.some(block => originalSourceRefs.some(ref => JSON.stringify(block.sourceRefs).includes(ref.objectIds?.[0]))))
    assert.deepEqual(merged.extensionPayload.designContent.sourcePageIds, fx.pageIds)
    assert.deepEqual(fx.repository.getState().designRuns[0].pageIds, fx.pageIds, 'accept must not enlarge run scope')
    assert.deepEqual(await fx.service.prepare(input), accepted, 'accepted request remains idempotent after source pages are replaced')

    const exported = await writeStandardProject({ snapshot: state, exportRoot: join(fx.root, 'export'), openBlob: fx.repository.openBlob })
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors))
  } finally { await fx.close() }
})

test('split requires a complete non-overlapping assignment and preserves scripts, sources, assets and source history', async () => {
  const fx = await fixture()
  try {
    const source = fx.repository.getState().pages[1]
    const ids = source.contentBlocks.map(block => block.contentBlockId)
    const base = { sessionId: fx.sessionId, runId: fx.run.runId, baseRevision: 0, message: '拆分过载页面' }
    await assert.rejects(fx.service.prepare({ ...base, idempotencyKey: 'split-incomplete', commands: [{ type: 'page.split', pageId: source.id, parts: [{ title: '判断', contentBlockIds: ids.slice(0, -1) }] }] }), { code: 'design_invalid_command' })
    await assert.rejects(fx.service.prepare({ ...base, idempotencyKey: 'split-overlap', commands: [{ type: 'page.split', pageId: source.id, parts: [{ title: '判断', contentBlockIds: ids }, { title: '证据', contentBlockIds: [ids[0]] }] }] }), { code: 'design_invalid_command' })

    const input = { ...base, idempotencyKey: 'split-valid', commands: [{ type: 'page.split', pageId: source.id, parts: [{ title: '核心判断', contentBlockIds: ids.slice(0, 2) }, { title: '支撑证据', contentBlockIds: ids.slice(2) }] }] }
    const prepared = await fx.service.prepare(input)
    const accepted = await fx.service.accept({ sessionId: fx.sessionId, proposalId: prepared.proposal.id })
    assert.equal(accepted.newPageIds.length, 2)
    assert.equal(accepted.scopeConfirmationRequired, true)
    const pages = fx.repository.getState().pages.filter(page => accepted.newPageIds.includes(page.id))
    assert.equal(pages.length, 2)
    assert.equal(pages.every(page => page.id !== source.id), true)
    assert.equal(pages.every(page => page.extensionPayload.designContent.sourcePageIds[0] === source.id), true)
    assert.equal(pages.some(page => page.scriptBlocks.some(block => block.content === source.scriptBlocks[0].content)), true)
    assert.equal(pages.every(page => page.contentBlocks.every(block => Array.isArray(block.sourceRefs))), true)
    assert.equal(pages.every(page => page.pageAssets.every(asset => asset.objectRef?.sha256)), true)
  } finally { await fx.close() }
})

test('three-way split stays contiguous before the following original page', async () => {
  const fx = await fixture()
  try {
    const [source, following] = fx.repository.getState().pages
    const ids = source.contentBlocks.map(block => block.contentBlockId)
    const prepared = await fx.service.prepare({
      sessionId: fx.sessionId,
      runId: fx.run.runId,
      baseRevision: 0,
      idempotencyKey: 'split-three-before-following',
      message: '三段拆分保持阅读顺序',
      commands: [{
        type: 'page.split',
        pageId: source.id,
        parts: [
          { title: '第一段', contentBlockIds: ids.slice(0, 1) },
          { title: '第二段', contentBlockIds: ids.slice(1, 2) },
          { title: '第三段', contentBlockIds: ids.slice(2) },
        ],
      }],
    })
    const accepted = await fx.service.accept({ sessionId: fx.sessionId, proposalId: prepared.proposal.id })
    assert.deepEqual(fx.repository.getState().pages.map(page => page.id), [...accepted.newPageIds, following.id])
    assert.deepEqual(fx.repository.getState().pages.map(page => page.order), [0, 1, 2, 3])
  } finally { await fx.close() }
})

test('multiple structural commands in one Proposal replace sources at their current array positions', async () => {
  const fx = await fixture()
  try {
    const [first, second] = fx.repository.getState().pages
    const firstIds = first.contentBlocks.map(block => block.contentBlockId)
    const secondIds = second.contentBlocks.map(block => block.contentBlockId)
    const prepared = await fx.service.prepare({
      sessionId: fx.sessionId,
      runId: fx.run.runId,
      baseRevision: 0,
      idempotencyKey: 'two-structural-replacements',
      message: '同批结构命令按当前数组位置替换',
      commands: [
        {
          type: 'page.split',
          pageId: first.id,
          parts: [
            { title: '第一页面一', contentBlockIds: firstIds.slice(0, 1) },
            { title: '第一页面二', contentBlockIds: firstIds.slice(1, 2) },
            { title: '第一页面三', contentBlockIds: firstIds.slice(2) },
          ],
        },
        {
          type: 'page.split',
          pageId: second.id,
          parts: [
            { title: '第二页面一', contentBlockIds: secondIds.slice(0, 1) },
            { title: '第二页面二', contentBlockIds: secondIds.slice(1) },
          ],
        },
      ],
    })
    const accepted = await fx.service.accept({ sessionId: fx.sessionId, proposalId: prepared.proposal.id })
    assert.deepEqual(fx.repository.getState().pages.map(page => page.id), accepted.newPageIds)
    assert.deepEqual(fx.repository.getState().pages.map(page => page.order), [0, 1, 2, 3, 4])
  } finally { await fx.close() }
})

test('design plan references only real content and source IDs and progress is reconstructed from persistent Proposals', async () => {
  const fx = await fixture()
  try {
    const page = fx.repository.getState().pages[0]
    const command = {
      type: 'page.design.plan',
      pageId: page.id,
      mainJudgment: '优先将有限建设资源投入高频公共空间',
      displayedContentIds: [page.contentBlocks[1].contentBlockId],
      scriptOrAppendixContentIds: [page.scriptBlocks[0].scriptBlockId, page.contentBlocks[2].contentBlockId],
      pendingGaps: [{ reason: '缺少经确认的分期预算', contentIds: [page.contentBlocks[3].contentBlockId], sourceRefKeys: ['object:DG05'] }],
      sourceRefKeys: ['object:DG05', 'evidence:evidence_031'],
    }
    const prepared = await fx.service.prepare({ sessionId: fx.sessionId, runId: fx.run.runId, baseRevision: 0, idempotencyKey: 'plan-v1', message: '记录上版边界', commands: [command] })
    await assert.rejects(fx.service.prepare({ sessionId: fx.sessionId, runId: fx.run.runId, baseRevision: 0, idempotencyKey: 'bad-plan', message: '伪造来源', commands: [{ ...command, sourceRefKeys: ['object:not-real'] }] }), { code: 'design_invalid_command' })
    await fx.reopen()
    const progress = await fx.service.progress({ sessionId: fx.sessionId, runId: fx.run.runId })
    assert.equal(progress.run.runId, fx.run.runId)
    assert.equal(progress.proposals[0].proposalId, prepared.proposal.id)
    assert.deepEqual(progress.pendingGaps, [{ proposalId: prepared.proposal.id, pageId: page.id, reason: '缺少经确认的分期预算', contentIds: [page.contentBlocks[3].contentBlockId], sourceRefKeys: ['object:DG05'] }])
    const accepted = await fx.service.accept({ sessionId: fx.sessionId, proposalId: prepared.proposal.id })
    assert.equal(accepted.scopeConfirmationRequired, false)
    assert.deepEqual(fx.repository.getState().pages[0].extensionPayload.designContent.plan, command)
  } finally { await fx.close() }
})

test('registered asset link appends the exact object reference without replacing existing pageAssets', async () => {
  const fx = await fixture()
  try {
    const state = fx.repository.getState()
    const target = state.pages[0]
    const assetId = state.pages[1].pageAssets[0].assetId
    const reference = state.pages[1].pageAssets[0]
    const prepared = await fx.service.prepare({ sessionId: fx.sessionId, runId: fx.run.runId, baseRevision: 0, idempotencyKey: 'asset-v1', message: '登记图表挂到判断页', commands: [{ type: 'page.asset.link', pageId: target.id, assetId, role: 'primary' }] })
    const accepted = await fx.service.accept({ sessionId: fx.sessionId, proposalId: prepared.proposal.id })
    assert.equal(accepted.scopeConfirmationRequired, false)
    const linked = fx.repository.getState().pages[0].pageAssets
    assert.equal(linked.length, 1)
    assert.equal(linked[0].assetId, assetId)
    assert.deepEqual(linked[0].objectRef, reference.objectRef)
    assert.deepEqual(linked[0].extensionPayload.standard, reference.extensionPayload.standard)
  } finally { await fx.close() }
})

test('scope, protection, stale revisions and malformed authority-shaped input fail closed', async () => {
  const protectedFx = await fixture({ protectedPageIds: [] })
  try {
    const pageId = protectedFx.pageIds[0]
    const input = { sessionId: protectedFx.sessionId, runId: protectedFx.run.runId, baseRevision: 0, idempotencyKey: 'safe', message: '计划', commands: [{ type: 'page.design.plan', pageId, mainJudgment: '判断', displayedContentIds: [], scriptOrAppendixContentIds: [], pendingGaps: [], sourceRefKeys: [] }] }
    for (const patch of [{ sessionId: 'other-session' }, { actor: 'agent' }, { allowApply: true }, { projectId: 'foreign' }, { paths: ['D:/real-project'] }]) {
      await assert.rejects(protectedFx.service.prepare({ ...input, ...patch }), { code: 'design_scope_denied' })
    }
    const prepared = await protectedFx.service.prepare(input)
    await protectedFx.repository.transactContent({ baseRevision: 0, source: 'test' }, state => { state.pages[0].contentBlocks[0].content += ' changed'; return state })
    await assert.rejects(protectedFx.service.accept({ sessionId: protectedFx.sessionId, proposalId: prepared.proposal.id }), { code: 'design_stale_source' })
    await assert.rejects(protectedFx.service.accept({ sessionId: 'other-session', proposalId: prepared.proposal.id }), { code: 'design_scope_denied' })
  } finally { await protectedFx.close() }

  const fx = await fixture({ protectedPageIds: [] })
  try {
    const pageId = fx.pageIds[0]
    await fx.repository.transactOperational(state => { state.designRuns[0].protectedPageIds = [pageId]; return state })
    await assert.rejects(fx.service.prepare({ sessionId: fx.sessionId, runId: fx.run.runId, baseRevision: 0, idempotencyKey: 'protected', message: '计划', commands: [{ type: 'page.design.plan', pageId, mainJudgment: '判断', displayedContentIds: [], scriptOrAppendixContentIds: [], pendingGaps: [], sourceRefKeys: [] }] }), { code: 'design_scope_denied' })
  } finally { await fx.close() }
})

test('accept rechecks protection inside the content CAS and asset linking verifies stored bytes', async () => {
  const fx = await fixture()
  try {
    const page = fx.repository.getState().pages[0]
    const prepared = await fx.service.prepare({ sessionId: fx.sessionId, runId: fx.run.runId, baseRevision: 0, idempotencyKey: 'race-plan', message: '保护页竞态', commands: [{ type: 'page.design.plan', pageId: page.id, mainJudgment: '判断', displayedContentIds: [], scriptOrAppendixContentIds: [], pendingGaps: [], sourceRefKeys: [] }] })
    const actual = fx.designService
    let changed = false
    fx.useDesignService({
      async inspectGrant(input) {
        const grant = await actual.inspectGrant(input)
        if (!changed) {
          changed = true
          await fx.repository.transactOperational(state => { state.designRuns[0].protectedPageIds.push(input.pageId); return state })
        }
        return grant
      },
    })
    await assert.rejects(fx.service.accept({ sessionId: fx.sessionId, proposalId: prepared.proposal.id }), { code: 'design_scope_denied' })
    assert.equal(fx.repository.getState().project.currentRevision, 0)
  } finally { await fx.close() }

  const broken = await fixture()
  try {
    const state = broken.repository.getState()
    const target = state.pages[0]
    const sourceAsset = state.pages[1].pageAssets[0]
    const missing = { ...sourceAsset.objectRef, sha256: 'f'.repeat(64) }
    await broken.repository.transactContent({ baseRevision: 0, source: 'test' }, draft => {
      draft.pages[1].pageAssets[0].objectRef = { ...missing }
      const archive = draft.project.extensionPayload.standardArchive
      archive.files.find(file => file.relativePath === sourceAsset.extensionPayload.standard.relativePath).objectRef = { ...missing }
      return draft
    })
    await assert.rejects(broken.service.prepare({ sessionId: broken.sessionId, runId: broken.run.runId, baseRevision: 1, idempotencyKey: 'missing-blob', message: '坏引用不得挂页', commands: [{ type: 'page.asset.link', pageId: target.id, assetId: sourceAsset.assetId }] }), { code: 'ENOENT' })
    assert.equal(broken.repository.getState().proposals.length, 0)
  } finally { await broken.close() }
})

test('only a persisted allowApply host grant may auto-apply', async () => {
  const fx = await fixture({ allowApply: true })
  try {
    const page = fx.repository.getState().pages[0]
    const result = await fx.service.prepare({ sessionId: fx.sessionId, runId: fx.run.runId, baseRevision: 0, idempotencyKey: 'auto-plan', message: '获准自动记录计划', commands: [{ type: 'page.design.plan', pageId: page.id, mainJudgment: '判断', displayedContentIds: [], scriptOrAppendixContentIds: [], pendingGaps: [] }] })
    assert.equal(result.status, 'accepted')
    assert.equal(fx.repository.getState().project.currentRevision, 1)
  } finally { await fx.close() }
})
