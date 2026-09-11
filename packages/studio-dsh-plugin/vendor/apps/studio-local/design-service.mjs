import { protectionFor, assertProtectedLayout } from './design-protection.mjs'
import { validateDesignIntent } from '../../packages/studio-layout-core/design-intent.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { createStudioId } from '../../packages/studio-contracts/index.mjs'
import { validateDesignLayout, DESIGN_RENDER_CAPABILITIES } from '../../packages/studio-layout-core/design-validation.mjs'
import { createPreviewFingerprint, PREVIEW_CHECKS_VERSION } from '../../packages/studio-layout-core/preview-fingerprint.mjs'

const clone = value => structuredClone(value)
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value
const hash = value => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')
function fail(code, message, status = 409) { throw Object.assign(new Error(message), { code, status }) }
function finiteJson(value) {
  const seen = new Set()
  const walk = row => {
    if (row === null || ['string', 'boolean'].includes(typeof row)) return
    if (typeof row === 'number' && Number.isFinite(row)) return
    if (!row || typeof row !== 'object' || seen.has(row) || (!Array.isArray(row) && Object.getPrototypeOf(row) !== Object.prototype)) fail('design_invalid_input', '设计输入必须是有限 JSON。', 400)
    seen.add(row); for (const child of Object.values(row)) walk(child); seen.delete(row)
  }
  walk(value)
  if (Buffer.byteLength(JSON.stringify(value)) > 1_000_000) fail('design_invalid_input', '设计输入超过大小限制。', 400)
}
function denyAgentAuthority(input) {
  for (const key of ['actor', 'projectId', 'allowApply', 'allowVisualGeneration', 'protectedPageIds', 'expiresAt', 'executionMode']) if (Object.hasOwn(input, key)) fail('design_scope_denied', '设计权限只能由宿主授予。', 403)
}
function sourceRef(key) {
  const [kind, first, itemKind, itemId] = key.split(':')
  return kind === 'content-block' ? { kind, contentBlockId: first } : kind === 'script-block' ? { kind, scriptBlockId: first } : kind === 'page-asset' ? { kind, pageAssetId: first } : { kind, contentBlockId: first, itemKind, itemId }
}
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value) } return value }
function candidateResult(candidate) { return clone({ candidateId: candidate.candidateId, candidateSha: candidate.candidateSha, validation: candidate.validation, diff: candidate.diff, status: candidate.status }) }
const elementSummary = row => row ? { type: row.type, frame: clone(row.frame), style: clone(row.style), syncPolicy: row.syncPolicy } : null
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0

export function createDesignService({ repository, layoutService, now = () => new Date().toISOString() } = {}) {
  if (!repository?.transactOperational || !layoutService?.designContext) throw new TypeError('Design service requires Repository and LayoutService')
  let queue = Promise.resolve()
  const serial = work => { const next = queue.then(work, work); queue = next.catch(() => undefined); return next }
  function grantFor(state, { sessionId, runId, pageId }) {
    const run = state.designRuns.find(row => row.runId === runId)
    if (!run || run.sessionId !== sessionId || run.projectId !== state.project.projectId || !run.pageIds.includes(pageId)
      || run.protectedPageIds.includes(pageId) || Date.parse(run.expiresAt) <= Date.parse(now()) || run.status === 'revoked') fail('design_scope_denied', '设计任务范围或有效期不匹配。', 403)
    return run
  }
  async function start({ sessionId, pageIds, protectedPageIds = [], allowApply = false, allowVisualGeneration = false, expiresAt, executionMode = allowApply ? 'direct' : 'legacy' } = {}) {
    const state = repository.getState()
    if (typeof sessionId !== 'string' || !sessionId.trim() || !Array.isArray(pageIds) || !pageIds.length || pageIds.length > 100
      || !Array.isArray(protectedPageIds) || typeof allowApply !== 'boolean' || typeof allowVisualGeneration !== 'boolean'
      || !['direct', 'legacy'].includes(executionMode) || (executionMode === 'direct' && !allowApply)
      || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(now())
      || [...pageIds, ...protectedPageIds].some(id => !state.pages.some(page => page.id === id))) fail('design_scope_denied', '宿主设计授权无效。', 403)
    const run = { runId: `design_run_${randomUUID()}`, sessionId, projectId: state.project.projectId, pageIds: [...new Set(pageIds)], protectedPageIds: [...new Set(protectedPageIds)], allowApply, allowVisualGeneration, executionMode, expiresAt, actor: 'host-design', status: 'active', createdAt: now() }
    await repository.transactOperational(draft => { draft.designRuns.push(run); return draft })
    return clone(run)
  }
  async function context({ sessionId, pageId }) {
    if (typeof sessionId !== 'string' || !sessionId) fail('design_scope_denied', '缺少宿主会话。', 403)
    const ctx = await layoutService.designContext({ pageId })
    return {
      protection: protectionFor(ctx.state,pageId),
      projectId: ctx.projection.projectId, pageId: ctx.projection.pageId, baseProjectRevision: ctx.state.project.currentRevision,
      baseLayoutRevision: ctx.layoutRef?.layoutRevision ?? null, baseLayoutSha: ctx.layoutRef?.sha256 ?? null,
      sourceStateHash: ctx.projection.sourceStateHash, layout: clone(ctx.layout), layoutRef: clone(ctx.layoutRef),
      sourceProjection: { ...ctx.projection, sources: Object.entries(ctx.projection.sources).map(([key, payload]) => ({ key, sourceRef: sourceRef(key), kind: payload.kind, payload: clone(payload) })) },
      pageAssets: clone(ctx.pageAssets), capabilities: clone(DESIGN_RENDER_CAPABILITIES),
    }
  }
  async function inspectGrant(input) {
    const ctx = await layoutService.designContext({ pageId: input.pageId })
    const run = grantFor(ctx.state, input)
    const sourceObjectIds = new Set()
    const sourceRefs = new Map()
    const collect = value => {
      if (!value || typeof value !== 'object') return
      if (value.provider === 'pre-design' && Array.isArray(value.objectIds)) {
        sourceRefs.set(hash(value), clone(value))
        for (const id of value.objectIds) if (typeof id === 'string') sourceObjectIds.add(id)
      }
      for (const child of Object.values(value)) collect(child)
    }
    collect(ctx.state.pages.find(page => page.id === input.pageId))
    const sourceProjectIds = [...new Set([...sourceRefs.values()].map(ref => ref.sourceProjectId).filter(id => typeof id === 'string'))].sort()
    return deepFreeze({ ...clone(run), pageId: input.pageId, sourceStateHash: ctx.projection.sourceStateHash, sourceObjectIds: [...sourceObjectIds].sort(),
      sourceRefs: [...sourceRefs.values()], sourceProjectIds, hasMixedSourceProjects: sourceProjectIds.length > 1 })
  }
  async function prepare(input) {
    denyAgentAuthority(input); finiteJson(input)
    return serial(async () => {
      const state = repository.getState()
      const run = grantFor(state, input)
      if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 200) fail('design_invalid_input', '候选缺少有效幂等键或设计意图。', 400)
      const requestHash = hash(input)
      const existing = state.layoutCandidates.find(row => row.runId === run.runId && row.idempotencyKey === input.idempotencyKey)
      if (existing) {
        if (existing.requestHash !== requestHash) fail('design_idempotency_conflict', '同一幂等键不能用于不同候选。')
        return candidateResult(existing)
      }
      if (input.layout?.projectId !== run.projectId || input.layout?.pageId !== input.pageId) fail('design_scope_denied', '候选布局不属于授权项目页面。', 403)
      const ctx = await layoutService.designContext({ pageId: input.pageId })
      if (ctx.state.project.currentRevision !== input.baseProjectRevision || (ctx.layoutRef?.layoutRevision ?? null) !== input.baseLayoutRevision || (ctx.layoutRef?.sha256 ?? null) !== input.baseLayoutSha || ctx.projection.sourceStateHash !== input.sourceStateHash) fail('design_stale_baseline', '设计基线已变化。')
      if (state.layoutCandidates.filter(row => row.runId === run.runId && row.pageId === input.pageId).length >= 3) {
        await repository.transactOperational(draft => { grantFor(draft, input).status = 'needs_review'; return draft })
        return { status: 'needs_review', runId: run.runId, pageId: input.pageId }
      }
      assertProtectedLayout(ctx.state,input.pageId,ctx.layout,input.layout)
      const intent = validateDesignIntent({ intent: input.designIntent, pageId: input.pageId, sourceKeys: Object.keys(ctx.projection.sources) })
      const validation = validateDesignLayout({ layout: input.layout, sources: ctx.projection.sources, sourceMapping: input.sourceMapping })
      if (!validation.valid) throw Object.assign(new Error('候选布局校验未通过。'), { code: 'design_validation_failed', status: 400, details: validation })
      const frozen = await layoutService.prepareDesign(input)
      const candidateId = `layout_candidate_${randomUUID()}`
      const candidateSha = frozen.prepared.ref.sha256
      const fingerprintInputs = { projectId: run.projectId, pageId: input.pageId, candidateId, candidateSha, baseProjectRevision: input.baseProjectRevision, baseLayoutRevision: input.baseLayoutRevision, baseLayoutSha: input.baseLayoutSha, sourceStateHash: input.sourceStateHash }
      const objectRef = await repository.putLayoutCandidate({ ...frozen, fingerprintInputs, designIntent: intent, sourceMapping: input.sourceMapping })
      const beforeElements = new Map((ctx.layout?.elements ?? []).map(row => [row.layoutElementId, row]))
      const afterIds = new Set(frozen.prepared.layout.elements.map(row => row.layoutElementId))
      const changes = frozen.prepared.layout.elements.filter(row => hash(row) !== hash(beforeElements.get(row.layoutElementId) ?? null)).map(row => ({ objectId: row.layoutElementId, changeType: beforeElements.has(row.layoutElementId) ? 'modified' : 'added' }))
      for (const id of beforeElements.keys()) if (!afterIds.has(id)) changes.push({ objectId: id, changeType: 'deleted' })
      const afterElements = new Map(frozen.prepared.layout.elements.map(row => [row.layoutElementId, row]))
      const diff = { changes, before: changes.map(row => ({ objectId: row.objectId, value: elementSummary(beforeElements.get(row.objectId)) })), after: changes.map(row => ({ objectId: row.objectId, value: elementSummary(afterElements.get(row.objectId)) })) }
      const candidate = { candidateId, candidateSha, runId: run.runId, sessionId: run.sessionId, projectId: run.projectId, pageId: input.pageId, idempotencyKey: input.idempotencyKey, requestHash, objectRef, baseProjectRevision: input.baseProjectRevision, baseLayoutRevision: input.baseLayoutRevision, baseLayoutSha: input.baseLayoutSha, sourceStateHash: input.sourceStateHash, designIntent: intent, validation, diff, status: 'candidate', createdAt: now() }
      await repository.transactOperational(draft => {
        grantFor(draft, input)
        if (draft.project.currentRevision !== input.baseProjectRevision) fail('design_stale_baseline', '设计基线已变化。')
        if (draft.layoutCandidates.some(row => row.runId === run.runId && row.idempotencyKey === input.idempotencyKey)) fail('design_idempotency_conflict', '候选键正在被另一请求使用。')
        if (draft.layoutCandidates.filter(row => row.runId === run.runId && row.pageId === input.pageId).length >= 3) fail('design_revision_limit', '本页自动修订已达到上限。')
        draft.layoutCandidates.push(candidate); return draft
      })
      return candidateResult(candidate)
    })
  }
  async function candidateFor(input) {
    denyAgentAuthority(input)
    const state = repository.getState()
    const candidate = state.layoutCandidates.find(row => row.candidateId === input.candidateId)
    if (!candidate || candidate.sessionId !== input.sessionId) fail('design_scope_denied', '候选不属于当前会话。', 403)
    grantFor(state, { ...candidate, sessionId: input.sessionId })
    if (candidate.candidateSha !== input.candidateSha) fail('design_candidate_mismatch', '候选 SHA 不匹配。')
    const frozen = await repository.getLayoutCandidate(candidate.objectRef)
    return { candidate, frozen }
  }
  async function previewInput(input) {
    const { candidate, frozen } = await candidateFor(input)
    const ctx = await context({ sessionId: input.sessionId, pageId: candidate.pageId })
    if (ctx.sourceStateHash !== candidate.sourceStateHash) fail('design_stale_baseline', '预览源内容已变化。')
    return deepFreeze(clone({ layout: frozen.prepared.layout, renderPlan: frozen.renderPlan, pageAssets: frozen.pageAssets, fingerprintInputs: frozen.fingerprintInputs, designIntent: frozen.designIntent }))
  }
  async function currentBaseline(candidate) {
    const ctx = await layoutService.designContext({ pageId: candidate.pageId })
    if (ctx.state.project.currentRevision !== candidate.baseProjectRevision || (ctx.layoutRef?.layoutRevision ?? null) !== candidate.baseLayoutRevision
      || (ctx.layoutRef?.sha256 ?? null) !== candidate.baseLayoutSha || ctx.projection.sourceStateHash !== candidate.sourceStateHash) fail('design_stale_baseline', '候选基线或来源内容已变化。')
    return ctx
  }
  function assertPreview(candidate, fingerprint) {
    if (!candidate.preview) fail('design_preview_required', '提交前需要宿主实际渲染预览。')
    if (candidate.preview.fingerprintInputs?.checksVersion !== PREVIEW_CHECKS_VERSION) fail('design_preview_required', '质量检查版本已更新，需要重新生成预览。')
    if (candidate.preview.fingerprint !== fingerprint) fail('design_preview_mismatch', '预览指纹已变化。')
    if (!candidate.validation.valid || candidate.preview.checks.blockers.length) fail('design_preview_blocked', '预览包含必须修复的问题。')
  }
  async function readPreview(input) {
    const {candidate}=await candidateFor(input)
    await currentBaseline(candidate)
    const p=candidate.preview,f=p?.fingerprintInputs
    if(!p||f?.checksVersion!==PREVIEW_CHECKS_VERSION||f.candidateSha!==candidate.candidateSha||f.sourceStateHash!==candidate.sourceStateHash||f.sha256!==p.objectRef?.sha256||createPreviewFingerprint(f)!==p.fingerprint)return null
    try{await repository.verifyBlob(p.objectRef)}catch{return null}
    return clone(p)
  }
  // This is a host renderer sink, never an Agent tool. Tool-reported checks
  // or success flags must never be forwarded here by the gateway.
  async function recordPreview(input) {
    return serial(async () => {
      const { candidate, frozen } = await candidateFor(input)
      await currentBaseline(candidate)
      const preview = input.preview
      const invalid = () => fail('design_preview_invalid', '宿主预览字节、检查或指纹不匹配。', 400)
      if (!preview || !Buffer.isBuffer(preview.png) || preview.png.length < 33 || preview.png.length > 30_000_000
        || !preview.png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || preview.png.toString('ascii', 12, 16) !== 'IHDR'
        || preview.candidateSha !== candidate.candidateSha || preview.checksVersion !== PREVIEW_CHECKS_VERSION
        || typeof preview.rendererVersion !== 'string' || !preview.rendererVersion
        || !preview.canvas || !preview.fingerprintInputs
        || !Array.isArray(preview.checks?.blockers) || !Array.isArray(preview.checks?.warnings) || !Array.isArray(preview.fonts)) invalid()
      const sha256 = createHash('sha256').update(preview.png).digest('hex')
      const canvas = { width: frozen.prepared.layout.canvas.width, height: frozen.prepared.layout.canvas.height }
      if (preview.sha256 !== sha256 || preview.png.readUInt32BE(16) !== canvas.width || preview.png.readUInt32BE(20) !== canvas.height || hash(preview.canvas) !== hash(canvas)) invalid()
      const materials = frozen.pageAssets.map(row => ({ pageAssetId: row.pageAssetId, assetId: row.assetId, sha256: row.objectRef.sha256, mimeType: row.objectRef.mimeType }))
        .sort((a, b) => compare(a.pageAssetId, b.pageAssetId) || compare(a.assetId, b.assetId))
      const fingerprintInputs = { candidateSha: candidate.candidateSha, sha256, rendererVersion: preview.rendererVersion, canvas, fonts: preview.fonts, materials, checksVersion: PREVIEW_CHECKS_VERSION, sourceStateHash: candidate.sourceStateHash }
      try { finiteJson(fingerprintInputs); finiteJson(preview.checks) } catch { invalid() }
      if (preview.checks.blockers.length > 500 || preview.checks.warnings.length > 500 || hash(preview.fingerprintInputs) !== hash(fingerprintInputs)
        || preview.fingerprint !== createPreviewFingerprint(fingerprintInputs)) invalid()
      if (candidate.proposalId && candidate.preview?.fingerprint !== preview.fingerprint) fail('design_preview_mismatch', '已提交候选的预览不可替换。')
      const objectRef = await repository.putBlob(Readable.from([preview.png]), { mimeType: 'image/png', originalFileName: `${candidate.candidateId}.png`, sha256, sizeBytes: preview.png.length })
      let result
      await repository.transactOperational(draft => {
        grantFor(draft, candidate)
        if (draft.project.currentRevision !== candidate.baseProjectRevision) fail('design_stale_baseline', '候选基线已变化。')
        const row = draft.layoutCandidates.find(item => item.candidateId === candidate.candidateId)
        if (row.status === 'applied') fail('design_candidate_closed', '已应用的候选不可重写。')
        const attempts = draft.layoutCandidates.filter(item => item.runId === candidate.runId && item.pageId === candidate.pageId).length
        row.preview = { objectRef, sha256, fingerprint: preview.fingerprint, fingerprintInputs: clone(fingerprintInputs), checks: clone(preview.checks), renderedAt: now() }
        row.status = preview.checks.blockers.length ? attempts >= 3 ? 'needs_review' : 'needs_revision' : 'previewed'
        if (row.status === 'needs_review') draft.designRuns.find(item => item.runId === row.runId).status = 'needs_review'
        result = clone(row.preview)
        return draft
      })
      return result
    })
  }
  async function submitReview(input) {
    denyAgentAuthority(input); finiteJson(input)
    return serial(async () => {
      const { candidate } = await candidateFor(input)
      const previous = repository.getState().proposals.find(row => row.id === candidate.proposalId)
      if (previous && (previous.message !== input.observations || previous.previewFingerprint !== input.previewFingerprint)) fail('design_idempotency_conflict', '同一预览观察请求的参数不能变化。')
      if (candidate.status === 'applied' && previous?.status === 'accepted') return clone(previous)
      await currentBaseline(candidate)
      assertPreview(candidate, input.previewFingerprint)
      if (typeof input.observations !== 'string' || !input.observations.trim() || input.observations.length > 8000) fail('design_invalid_input', '请提供已查看预览的观察记录。', 400)
      let proposal
      await repository.transactOperational(draft => {
        const currentRun = grantFor(draft, candidate)
        if (draft.project.currentRevision !== candidate.baseProjectRevision) fail('design_stale_baseline', '候选基线已变化。')
        const row = draft.layoutCandidates.find(item => item.candidateId === candidate.candidateId)
        assertPreview(row, input.previewFingerprint)
        if (row.proposalId) { const stored = draft.proposals.find(item => item.id === row.proposalId); if (currentRun.executionMode === 'direct' && stored.status === 'failed') { stored.status = 'applying'; row.status = 'applying' } proposal = clone(stored); return draft }
        proposal = { id: createStudioId('proposal'), kind: 'layout', projectId: candidate.projectId, sessionId: candidate.sessionId, runId: candidate.runId, pageId: candidate.pageId,
          scopeKey: `layout:${candidate.pageId}`, baseRevision: candidate.baseProjectRevision, candidateId: candidate.candidateId, candidateSha: candidate.candidateSha,
          candidateObjectRef: clone(candidate.objectRef), previewFingerprint: input.previewFingerprint, preview: clone(row.preview), message: input.observations,
          designIntent: candidate.designIntent, diff: clone(candidate.diff), affectedObjectIds: candidate.diff.changes.map(change => change.objectId),
          aggregateRiskLevel: 'structural_review_required', hasDeletion: candidate.diff.changes.some(change => change.changeType === 'deleted'), sourceAnnotationIds: [], status: currentRun.executionMode === 'direct' ? 'applying' : 'pending', createdAt: now(), actor: 'host-design' }
        row.proposalId = proposal.id; row.status = currentRun.executionMode === 'direct' ? 'applying' : 'pending_review'; draft.proposals.push(proposal); return draft
      })
      const run = grantFor(repository.getState(), candidate)
      return run.allowApply && ['pending', 'applying'].includes(proposal.status) ? acceptImpl({ sessionId: input.sessionId, proposalId: proposal.id }) : clone(proposal)
    }).catch(async error => {
      await repository.transactOperational(draft => {
        const candidate = draft.layoutCandidates.find(row => row.candidateId === input.candidateId && row.sessionId === input.sessionId)
        const run = draft.designRuns.find(row => row.runId === candidate?.runId)
        const proposal = draft.proposals.find(row => row.id === candidate?.proposalId)
        if (run?.executionMode === 'direct' && proposal && proposal.status !== 'accepted') {
          proposal.status = 'failed'; candidate.status = 'failed'
          proposal.lastError = String(error.message).slice(0, 2000); candidate.lastError = proposal.lastError
        }
        return draft
      }).catch(() => undefined)
      throw error
    })
  }
  async function acceptImpl(input) {
    denyAgentAuthority(input)
    const state = repository.getState()
    const proposal = state.proposals.find(row => row.id === input.proposalId)
    if (!proposal || proposal.kind !== 'layout' || proposal.sessionId !== input.sessionId || proposal.projectId !== state.project.projectId) fail('design_scope_denied', '布局提案不属于当前会话。', 403)
    const { candidate, frozen } = await candidateFor({ sessionId: input.sessionId, candidateId: proposal.candidateId, candidateSha: proposal.candidateSha })
    if (proposal.status === 'accepted') {
      await layoutService.get({ pageId: candidate.pageId })
      return clone(proposal)
    }
    if (!['pending', 'applying'].includes(proposal.status)) fail('design_proposal_closed', '布局提案已处理。')
    if (proposal.candidateObjectRef.sha256 !== candidate.objectRef.sha256 || candidate.proposalId !== proposal.id) fail('design_candidate_mismatch', '提案未引用该不可变候选。')
    assertPreview(candidate, proposal.previewFingerprint)
    await currentBaseline(candidate)
    await repository.verifyBlob(candidate.preview.objectRef)
    const protectionContext = await layoutService.designContext({pageId:candidate.pageId})
    assertProtectedLayout(protectionContext.state,candidate.pageId,protectionContext.layout,frozen.prepared.layout)
    await layoutService.publishDesign({ ...candidate, prepared: frozen.prepared, updateOperational: draft => {
      assertProtectedLayout(draft,candidate.pageId,protectionContext.layout,frozen.prepared.layout)
      grantFor(draft, candidate)
      const row = draft.proposals.find(item => item.id === proposal.id)
      const currentCandidate = draft.layoutCandidates.find(item => item.candidateId === candidate.candidateId)
      if (!['pending', 'applying'].includes(row.status) || row.candidateSha !== candidate.candidateSha) fail('design_proposal_closed', '布局提案已处理。')
      assertPreview(currentCandidate, row.previewFingerprint)
      // attachPrepared has already installed the frozen ref in this draft.
      row.status = 'accepted'; row.acceptedAt = now(); row.acceptedRevision = candidate.baseProjectRevision + (frozen.prepared.noOp && candidate.baseLayoutSha === candidate.candidateSha ? 0 : 1)
      currentCandidate.status = 'applied'; currentCandidate.acceptedRevision = row.acceptedRevision; currentCandidate.acceptedAt = row.acceptedAt
    } })
    return clone(repository.getState().proposals.find(row => row.id === proposal.id))
  }
  const accept = input => serial(() => acceptImpl(input))
  async function progress({ sessionId, runId }) {
    const state = repository.getState()
    const run = state.designRuns.find(row => row.runId === runId)
    if (!run || run.sessionId !== sessionId || run.projectId !== state.project.projectId) fail('design_scope_denied', '任务不属于当前会话。', 403)
    return clone({ ...run, candidates: state.layoutCandidates.filter(row => row.runId === runId).map(row => ({ ...candidateResult(row), pageId: row.pageId, preview: row.preview ?? null, proposalId: row.proposalId ?? null })) })
  }
  return Object.freeze({ start, context, inspectGrant, prepare, previewInput, readPreview, recordPreview, submitReview, accept, progress })
}
