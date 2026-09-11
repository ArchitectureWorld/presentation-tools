import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepository } from './repository.mjs'
import { createLayoutService } from './layout-service.mjs'
import { readStandardProject } from '../../packages/studio-standard-adapter/index.mjs'
import { createLayoutPage, addLiveLayoutElement } from '../../packages/studio-layout-core/index.mjs'
import { canonicalLayoutJson } from '../../packages/studio-layout-persistence/index.mjs'
import { acceptProposal, rejectProposal, returnProposalToAgent, markProposalStale } from '../../packages/studio-core/index.mjs'

const module = await import('./design-service.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})
const standard = new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url)
async function renderCandidate(fx, candidate) {
  const { createLayoutPreviewRenderer } = await import('./layout-preview.mjs')
  const input = await fx.service.previewInput({ sessionId: fx.sessionId, ...candidate })
  return createLayoutPreviewRenderer({ browserExecutable: process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE }).render({
    ...input, candidateSha: candidate.candidateSha,
    readAsset: async ref => Buffer.concat(await Array.fromAsync(await fx.repository.openBlob(ref))),
  })
}
async function fixture(options = {}) {
  assert.equal(typeof module.createDesignService, 'function', 'guarded design service must exist')
  const root = await mkdtemp(join(tmpdir(), 'studio-design-'))
  let repository = await createRepository(join(root, 'repository'), options)
  const imported = await readStandardProject(standard, { putBlob: repository.putBlob })
  await repository.initializeFromStandardProject({ snapshot: imported.snapshot })
  let layoutService = createLayoutService({ repository, layoutRoot: join(root, 'layouts'), faultInjector: options.layoutFaultInjector })
  let time = Date.parse('2026-09-06T00:00:00Z')
  let service = module.createDesignService({ repository, layoutService, now: () => new Date(time).toISOString() })
  const pageId = repository.getState().pages[1].id
  const sessionId = 'host-session'
  const fx = {
    root, get repository() { return repository }, get service() { return service }, get layoutService() { return layoutService }, pageId, sessionId,
    expire() { time += 120_000 },
    async start(extra = {}) { return service.start({ sessionId, pageIds: [pageId], protectedPageIds: [repository.getState().pages[0].id], allowApply: false, allowVisualGeneration: false, expiresAt: '2026-09-06T00:01:00Z', ...extra }) },
    async input(run, extra = {}) {
      const ctx = await service.context({ sessionId, pageId })
      const source = ctx.sourceProjection.sources.find(row => row.kind === 'text')
      const layout = ctx.layout ?? addLiveLayoutElement(createLayoutPage({ projectId: ctx.projectId, pageId, baseDraftRevision: ctx.baseProjectRevision }), {
        type: 'text', sourceRef: source.sourceRef, frame: { x: 80, y: 80, width: 1200, height: 180, rotation: 0 }, style: { fontSize: 36, textColor: '#222222' },
      })
      return { sessionId, runId: run.runId, pageId, baseProjectRevision: ctx.baseProjectRevision, baseLayoutRevision: ctx.baseLayoutRevision,
        baseLayoutSha: ctx.baseLayoutSha, sourceStateHash: ctx.sourceStateHash, layout, designIntent: '整理本页信息层级', sourceMapping: {}, idempotencyKey: 'first', ...extra }
    },
    async reopen() { await repository.close(); repository = await createRepository(join(root, 'repository')); layoutService = createLayoutService({ repository, layoutRoot: join(root, 'layouts') }); service = module.createDesignService({ repository, layoutService, now: () => new Date(time).toISOString() }) },
    async close() { await repository.close(); await rm(root, { recursive: true, force: true }) },
  }
  return fx
}

test('context is read only, resolves real sources, and prepare freezes without publishing a revision', async () => {
  const fx = await fixture()
  try {
    const before = await readFile(fx.repository.controlPath, 'utf8')
    const ctx = await fx.service.context({ sessionId: fx.sessionId, pageId: fx.pageId })
    assert.equal(ctx.layout, null)
    assert.equal(ctx.baseLayoutRevision, null)
    assert.equal(ctx.baseLayoutSha, null)
    assert.ok(ctx.sourceProjection.sources.some(row => row.payload?.content))
    assert.equal(await readFile(fx.repository.controlPath, 'utf8'), before)
    await assert.rejects(readFile(join(fx.root, 'layouts', 'manifest.json')), { code: 'ENOENT' })
    const run = await fx.start()
    const input = await fx.input(run)
    const candidate = await fx.service.prepare(input)
    assert.equal(candidate.status, 'candidate')
    assert.equal(fx.repository.getState().project.currentRevision, 0)
    assert.equal((await fx.layoutService.get({ pageId: fx.pageId })).layout, null)
    const frozen = await fx.service.previewInput({ sessionId: fx.sessionId, ...candidate })
    assert.equal(frozen.layout.layoutRevision, 0)
    assert.ok(frozen.layout.updatedAt)
    assert.ok(frozen.pageAssets.every(asset => asset.objectRef.sha256 && asset.objectRef.mimeType))
    await fx.reopen()
    assert.deepEqual(await fx.service.prepare(input), candidate)
    await assert.rejects(fx.service.prepare({ ...input, designIntent: 'different' }), { code: 'design_idempotency_conflict' })
    assert.equal(fx.repository.getState().layoutCandidates.length, 1)
  } finally { await fx.close() }
})

test('host grant rejects protected pages, other sessions/projects, expiry and stale baselines', async () => {
  const fx = await fixture()
  try {
    const run = await fx.start()
    const input = await fx.input(run)
    for (const patch of [{ sessionId: 'another-session' }, { pageId: fx.repository.getState().pages[0].id }, { projectId: 'foreign-project' }, { allowApply: true }, { actor: 'human' }]) {
      await assert.rejects(fx.service.prepare({ ...input, ...patch }), { code: 'design_scope_denied' })
    }
    for (const patch of [{ baseProjectRevision: 1 }, { baseLayoutRevision: -1 }, { baseLayoutSha: 'old' }, { sourceStateHash: 'sha256:' + '0'.repeat(64) }]) {
      await assert.rejects(fx.service.prepare({ ...input, ...patch }), { code: 'design_stale_baseline' })
    }
    await assert.rejects(fx.service.prepare({ ...input, layout: { ...input.layout, projectId: 'foreign-project' } }), { code: 'design_scope_denied' })
    fx.expire()
    await assert.rejects(fx.service.prepare(input), { code: 'design_scope_denied' })
    assert.equal(fx.repository.getState().layoutCandidates.length, 0)
  } finally { await fx.close() }
})

test('context uses the existing LayoutStore fallback without attaching or overwriting its page', async () => {
  const fx = await fixture()
  try {
    const run = await fx.start()
    const input = await fx.input(run)
    const record = await fx.layoutService.store.writePage(input.layout, { expectedLayoutRevision: -1, sourceProjectRevision: 0, sourceStateHash: input.sourceStateHash })
    const before = await readFile(fx.repository.controlPath, 'utf8')
    const ctx = await fx.service.context({ sessionId: fx.sessionId, pageId: fx.pageId })
    assert.equal(ctx.baseLayoutSha, record.ref.sha256)
    assert.equal(ctx.baseLayoutRevision, 0)
    assert.equal(await readFile(fx.repository.controlPath, 'utf8'), before)
    await assert.rejects(fx.service.prepare(input), { code: 'design_stale_baseline' })
  } finally { await fx.close() }
})

test('source hash covers project rules and source material hashes and agrees with ordinary layouts', async () => {
  const fx = await fixture()
  try {
    const first = await fx.service.context({ sessionId: fx.sessionId, pageId: fx.pageId })
    await fx.repository.transactContent({ baseRevision: 0, source: 'test' }, state => {
      state.project.extensionPayload.standardArchive.documents['rules.json'].projectName = '修改设计约束'
      return state
    })
    const second = await fx.service.context({ sessionId: fx.sessionId, pageId: fx.pageId })
    assert.notEqual(second.sourceStateHash, first.sourceStateHash)
    await fx.repository.transactContent({ baseRevision: 1, source: 'test' }, state => {
      state.project.extensionPayload.standardArchive.files.find(file=>file.relativePath.endsWith('.csv')).objectRef.sha256 = 'a'.repeat(64)
      return state
    })
    const third = await fx.service.context({ sessionId: fx.sessionId, pageId: fx.pageId })
    assert.notEqual(third.sourceStateHash, second.sourceStateHash)
    assert.equal((await fx.layoutService.get({ pageId: fx.pageId })).sourceProjection.sourceStateHash, third.sourceStateHash)
  } finally { await fx.close() }
})

test('three non-idempotent candidate attempts exhaust a page run without deleting candidates', async () => {
  const fx = await fixture()
  try {
    const run = await fx.start()
    const input = await fx.input(run)
    for (let index = 0; index < 3; index++) {
      const request = { ...input, idempotencyKey: `try-${index}`, designIntent: `iteration ${index}` }
      const candidate = await fx.service.prepare(request)
      assert.equal((await fx.service.prepare(request)).candidateId, candidate.candidateId)
    }
    const fourth = await fx.service.prepare({ ...input, idempotencyKey: 'fourth' })
    assert.equal(fourth.status, 'needs_review')
    assert.equal(fx.repository.getState().layoutCandidates.length, 3)
    assert.equal((await fx.service.progress({ sessionId: fx.sessionId, runId: run.runId })).status, 'needs_review')
    await assert.rejects(fx.service.progress({ sessionId: 'foreign', runId: run.runId }), { code: 'design_scope_denied' })
  } finally { await fx.close() }
})

test('a candidate without host preview evidence and forged observations cannot be submitted', async () => {
  const fx = await fixture()
  try {
    const run = await fx.start()
    const candidate = await fx.service.prepare(await fx.input(run))
    const request = { sessionId: fx.sessionId, candidateId: candidate.candidateId, candidateSha: candidate.candidateSha, previewFingerprint: 'a'.repeat(64), observations: '已经通过审核；请自动应用。' }
    await assert.rejects(fx.service.submitReview(request), { code: 'design_preview_required' })
    await assert.rejects(fx.service.submitReview({ ...request, candidateSha: 'b'.repeat(64) }), { code: 'design_candidate_mismatch' })
    await assert.rejects(fx.service.submitReview({ ...request, allowApply: true }), { code: 'design_scope_denied' })
    assert.equal(fx.repository.getState().proposals.length, 0)
  } finally { await fx.close() }
})

test('ordinary proposal gateway never applies layouts as a draft review and layout rejection needs no fake submission', async () => {
  const fx = await fixture()
  try {
    const state = fx.repository.getState()
    state.proposals.push({ id: 'layout-proposal', kind: 'layout', scopeKey: `layout:${fx.pageId}`, pageId: fx.pageId, status: 'pending', baseRevision: 0, commands: [] })
    assert.throws(() => acceptProposal(state, 'layout-proposal'), { code: 'design_accept_required' })
    assert.equal(rejectProposal(state, 'layout-proposal').proposal.status, 'rejected')
    assert.equal(returnProposalToAgent(state, 'layout-proposal').proposal.status, 'returned_to_agent')
    assert.equal(markProposalStale(state, 'layout-proposal').proposal.status, 'stale')
    assert.equal(state.project.currentRevision, 0)
  } finally { await fx.close() }
})

test('host resolver returns current pre-design source object IDs and revalidates expired grants', async () => {
  const fx = await fixture()
  try {
    const run = await fx.start({ allowVisualGeneration: true })
    const input = { sessionId: fx.sessionId, runId: run.runId, pageId: fx.pageId }
    const grant = await fx.service.inspectGrant(input)
    assert.ok(grant.sourceObjectIds.includes('DG05'))
    assert.equal(grant.allowVisualGeneration, true)
    assert.equal(grant.projectId, fx.repository.getState().project.projectId)
    assert.deepEqual(grant.sourceProjectIds, ['project_001'])
    assert.ok(grant.sourceRefs.some(ref => ref.sourceProjectId === 'project_001' && ref.sourceRevision === 42 && ref.objectIds.includes('DG05')))
    await fx.repository.transactContent({ baseRevision: 0, source: 'test' }, state => {
      state.pages[1].contentBlocks[0].sourceRefs.push({ provider: 'pre-design', sourceProjectId: 'foreign-pre-project', sourceRevision: 1, objectIds: ['foreign-object'], evidenceIds: [] })
      return state
    })
    const mixed = await fx.service.inspectGrant(input)
    assert.deepEqual(mixed.sourceProjectIds, ['foreign-pre-project', 'project_001'])
    assert.ok(mixed.sourceRefs.some(ref => ref.sourceProjectId === 'foreign-pre-project' && ref.objectIds.includes('foreign-object')))
    assert.equal(mixed.hasMixedSourceProjects, true)
    fx.expire()
    await assert.rejects(fx.service.inspectGrant(input), { code: 'design_scope_denied' })
  } finally { await fx.close() }
})

test('frozen publication survives the transaction/index fault and repairs from the authoritative project ref', async () => {
  let crash = true
  const fx = await fixture({ layoutFaultInjector: point => { if (crash && point === 'after_layout_head_publish') throw new Error('index publication fault') } })
  try {
    const run = await fx.start()
    const input = await fx.input(run)
    const result = await fx.service.prepare(input)
    const stored = fx.repository.getState().layoutCandidates[0]
    const frozen = await fx.repository.getLayoutCandidate(stored.objectRef)
    const previewed = canonicalLayoutJson((await fx.service.previewInput({ sessionId: fx.sessionId, ...result })).layout)
    await assert.rejects(fx.layoutService.publishDesign({ ...input, prepared: frozen.prepared, updateOperational: draft => { draft.layoutCandidates[0].status = 'applied' } }), /index publication fault/u)
    assert.equal(fx.repository.getState().project.currentRevision, 1)
    assert.equal(fx.repository.getState().layoutCandidates[0].status, 'applied')
    assert.equal(await fx.layoutService.store.readRef(fx.pageId), null)
    crash = false
    await fx.reopen()
    const repaired = await fx.layoutService.get({ pageId: fx.pageId })
    assert.equal(canonicalLayoutJson(repaired.layout), previewed)
    assert.equal(repaired.stale, false)
    assert.equal((await fx.layoutService.store.readRef(fx.pageId)).sha256, result.candidateSha)
  } finally { await fx.close() }
})

test('unchanged exact layout publication records its operational decision without an extra content revision', async () => {
  const fx = await fixture()
  try {
    const run = await fx.start()
    const input = await fx.input(run)
    const first = await fx.layoutService.prepareDesign(input)
    await fx.layoutService.publishDesign({ ...input, prepared: first.prepared })
    const unchanged = await fx.input(run, { idempotencyKey: 'same-layout' })
    const second = await fx.layoutService.prepareDesign(unchanged)
    assert.equal(second.prepared.noOp, true)
    await fx.layoutService.publishDesign({ ...unchanged, prepared: second.prepared, updateOperational: draft => { draft.designRuns[0].status = 'completed' } })
    assert.equal(fx.repository.getState().project.currentRevision, 1)
    assert.equal(fx.repository.getState().designRuns[0].status, 'completed')
  } finally { await fx.close() }
})

test('content transaction failure and later stale layout CAS preserve the previously published page', async () => {
  let crash = false
  const fx = await fixture({ faultInjector: point => { if (crash && point === 'before_head_publish') throw new Error('head publication fault') } })
  try {
    const run = await fx.start()
    const initial = await fx.input(run)
    const first = await fx.layoutService.prepareDesign(initial)
    await fx.layoutService.publishDesign({ ...initial, prepared: first.prepared })
    const next = await fx.input(run, { idempotencyKey: 'second' })
    next.layout.elements[0].frame.x += 10
    const frozen = await fx.layoutService.prepareDesign(next)
    crash = true
    await assert.rejects(fx.layoutService.publishDesign({ ...next, prepared: frozen.prepared }), /head publication fault/u)
    assert.equal(fx.repository.getState().project.currentRevision, 1)
    assert.equal((await fx.layoutService.store.readRef(fx.pageId)).sha256, first.prepared.ref.sha256)
    crash = false
    await fx.layoutService.mutate({ pageId: fx.pageId, baseRevision: 1, expectedLayoutRevision: 0, operation: { type: 'style', layoutElementId: next.layout.elements[0].layoutElementId, style: { fontSize: 40 } } })
    await assert.rejects(fx.layoutService.publishDesign({ ...next, prepared: frozen.prepared }), { code: 'design_stale_baseline' })
    assert.equal((await fx.layoutService.get({ pageId: fx.pageId })).layout.elements[0].style.fontSize, 40)
  } finally { await fx.close() }
})

test('recordPreview rejects unauthenticated payload shapes before any proposal exists', async () => {
  const fx = await fixture()
  try {
    assert.equal(typeof fx.service.recordPreview, 'function', 'host preview recorder is required')
    const run = await fx.start()
    const candidate = await fx.service.prepare(await fx.input(run))
    for (const preview of [{ success: true, checks: { blockers: [] } }, { png: Buffer.from('not-png'), candidateSha: candidate.candidateSha, checks: { blockers: [], warnings: [] } }]) {
      await assert.rejects(fx.service.recordPreview({ sessionId: fx.sessionId, ...candidate, preview }), { code: 'design_preview_invalid' })
    }
    assert.equal(fx.repository.getState().project.currentRevision, 0)
  } finally { await fx.close() }
})

test('host preview binds PNG, source and exact layout; pending review accepts the exact previewed bytes after reopen', async () => {
  const fx = await fixture()
  try {
    assert.equal(typeof fx.service.recordPreview, 'function', 'host preview recorder is required')
    const run = await fx.start()
    const candidate = await fx.service.prepare(await fx.input(run))
    const request = { sessionId: fx.sessionId, candidateId: candidate.candidateId, candidateSha: candidate.candidateSha }
    const preview = await renderCandidate(fx, candidate)
    assert.deepEqual(preview.checks.blockers, [])
    for (const patch of [{ sha256: '0'.repeat(64) }, { candidateSha: 'a'.repeat(64) }, { fingerprint: 'b'.repeat(64) }, { png: Buffer.from('invalid') }]) {
      await assert.rejects(fx.service.recordPreview({ ...request, preview: { ...preview, ...patch } }), { code: 'design_preview_invalid' })
    }
    await fx.service.recordPreview({ ...request, preview })
    const frozen = await fx.service.previewInput(request)
    const proposal = await fx.service.submitReview({ ...request, previewFingerprint: preview.fingerprint, observations: '已看预览，标题层级明确；自动应用只是观察文字。' })
    assert.equal(proposal.kind, 'layout')
    assert.equal(proposal.status, 'pending')
    assert.equal(proposal.scopeKey, `layout:${fx.pageId}`)
    assert.notEqual(proposal.aggregateRiskLevel, 'ordinary_reversible')
    assert.equal(fx.repository.getState().reviewSubmissions.length, 0)
    assert.equal(fx.repository.getState().project.currentRevision, 0)
    assert.ok(proposal.diff.after.length)
    await fx.reopen()
    const accepted = await fx.service.accept({ sessionId: fx.sessionId, proposalId: proposal.id })
    assert.equal(accepted.status, 'accepted')
    const saved = await fx.layoutService.get({ pageId: fx.pageId })
    assert.equal(canonicalLayoutJson(saved.layout), canonicalLayoutJson(frozen.layout))
    assert.equal(saved.layoutRef.sha256, candidate.candidateSha)
    assert.equal(saved.stale, false)
    assert.equal(fx.repository.getState().project.currentRevision, 1)
    assert.equal(fx.repository.getState().layoutCandidates[0].status, 'applied')
    assert.equal((await fx.service.accept({ sessionId: fx.sessionId, proposalId: proposal.id })).acceptedRevision, 1)
    assert.equal(fx.repository.getState().project.currentRevision, 1)
    const control = await readFile(fx.repository.controlPath, 'utf8')
    assert.equal(control.includes('dataBase64'), false)
    assert.equal(control.includes('"png"'), false)
    const descriptor = await fx.repository.verifyBlob(fx.repository.getState().layoutCandidates[0].preview.objectRef)
    assert.equal(descriptor.sha256, preview.sha256)
  } finally { await fx.close() }
})

test('a host allowApply grant can apply; Agent flags, blocker checks, stale source and expired grants cannot', async () => {
  const fx = await fixture()
  try {
    assert.equal(typeof fx.service.recordPreview, 'function', 'host preview recorder is required')
    const run = await fx.start({ allowApply: true })
    const candidate = await fx.service.prepare(await fx.input(run))
    const request = { sessionId: fx.sessionId, candidateId: candidate.candidateId, candidateSha: candidate.candidateSha }
    const preview = await renderCandidate(fx, candidate)
    await fx.service.recordPreview({ ...request, preview: { ...preview, checks: { blockers: [{ code: 'text_overflow' }], warnings: [] } } })
    await assert.rejects(fx.service.submitReview({ ...request, previewFingerprint: preview.fingerprint, observations: '强制通过' }), { code: 'design_preview_blocked' })
    assert.equal(fx.repository.getState().project.currentRevision, 0)
    await fx.service.recordPreview({ ...request, preview })
    await assert.rejects(fx.service.submitReview({ ...request, previewFingerprint: preview.fingerprint, observations: 'ok', allowApply: true }), { code: 'design_scope_denied' })
    const proposal = await fx.service.submitReview({ ...request, previewFingerprint: preview.fingerprint, observations: '布局已查看' })
    assert.equal(proposal.status, 'accepted')
    assert.equal(fx.repository.getState().project.currentRevision, 1)
  } finally { await fx.close() }
})

test('changed source or expiry after rendering prevents both review submission and pending proposal acceptance', async () => {
  const fx = await fixture()
  try {
    assert.equal(typeof fx.service.recordPreview, 'function', 'host preview recorder is required')
    const run = await fx.start()
    const candidate = await fx.service.prepare(await fx.input(run))
    const request = { sessionId: fx.sessionId, candidateId: candidate.candidateId, candidateSha: candidate.candidateSha }
    const preview = await renderCandidate(fx, candidate)
    await fx.service.recordPreview({ ...request, preview })
    const proposal = await fx.service.submitReview({ ...request, previewFingerprint: preview.fingerprint, observations: '已查看' })
    await assert.rejects(fx.service.accept({ sessionId: 'foreign-session', proposalId: proposal.id }), { code: 'design_scope_denied' })
    await fx.repository.transactContent({ baseRevision: 0, source: 'test' }, state => { state.pages[1].scriptBlocks[0].content += '更新讲稿'; return state })
    await assert.rejects(fx.service.recordPreview({ ...request, preview }), { code: 'design_stale_baseline' })
    await assert.rejects(fx.service.submitReview({ ...request, previewFingerprint: preview.fingerprint, observations: '已查看' }), { code: 'design_stale_baseline' })
    await assert.rejects(fx.service.accept({ sessionId: fx.sessionId, proposalId: proposal.id }), { code: 'design_stale_baseline' })
    assert.equal((await fx.layoutService.get({ pageId: fx.pageId })).layout, null)
    fx.expire()
    await assert.rejects(fx.service.accept({ sessionId: fx.sessionId, proposalId: proposal.id }), { code: 'design_scope_denied' })
  } finally { await fx.close() }
})
