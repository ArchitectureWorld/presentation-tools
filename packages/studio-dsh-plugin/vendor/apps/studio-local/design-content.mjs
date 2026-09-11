import { createHash } from 'node:crypto'
import { canonicalFromState, createStudioId } from '../../packages/studio-contracts/index.mjs'

const PROPOSAL_KIND = 'design.content.v1'
const clone = value => structuredClone(value)
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value
const digest = value => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')
const compare = (a, b) => a.order - b.order
const ROLES = new Set(['primary', 'supporting', 'background', 'reference'])
const TOP_LEVEL_KEYS = new Set(['sessionId', 'runId', 'baseRevision', 'idempotencyKey', 'message', 'commands'])
const AUTHORITY_KEYS = new Set(['actor', 'projectId', 'allowApply', 'allowVisualGeneration', 'protectedPageIds', 'expiresAt', 'path', 'paths', 'workspaceRoot'])

function fail(code, message, status = 400, details = undefined) {
  throw Object.assign(new Error(message), { code, status, details })
}

function finiteJson(value, limit = 1_000_000) {
  const seen = new Set()
  const walk = row => {
    if (row === null || ['string', 'boolean'].includes(typeof row)) return
    if (typeof row === 'number' && Number.isFinite(row)) return
    if (!row || typeof row !== 'object' || seen.has(row) || (!Array.isArray(row) && Object.getPrototypeOf(row) !== Object.prototype)) fail('design_invalid_input', '内容提案只接受有限 JSON。')
    seen.add(row)
    for (const child of Object.values(row)) walk(child)
    seen.delete(row)
  }
  walk(value)
  if (Buffer.byteLength(JSON.stringify(value)) > limit) fail('design_invalid_input', '内容提案超过大小限制。')
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('design_invalid_command', `${label} 必须是对象。`)
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key))
  if (unexpected.length) fail(AUTHORITY_KEYS.has(unexpected[0]) ? 'design_scope_denied' : 'design_invalid_command', `${label} 包含不允许的字段。`, AUTHORITY_KEYS.has(unexpected[0]) ? 403 : 400, { fields: unexpected })
}

function text(value, label, { optional = false, max = 8000 } = {}) {
  if (optional && value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('design_invalid_command', `${label} 无效。`)
  return value
}

function strings(value, label, { unique = true } = {}) {
  if (!Array.isArray(value) || value.some(row => typeof row !== 'string' || !row)) fail('design_invalid_command', `${label} 必须是字符串数组。`)
  if (unique && new Set(value).size !== value.length) fail('design_invalid_command', `${label} 不能重复。`)
  return value
}

function sourceKeys(page) {
  const result = new Set()
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value.objectIds)) for (const id of value.objectIds) if (typeof id === 'string') result.add(`object:${id}`)
    if (Array.isArray(value.evidenceIds)) for (const id of value.evidenceIds) if (typeof id === 'string') result.add(`evidence:${id}`)
    for (const child of Object.values(value)) visit(child)
  }
  visit(page)
  return result
}

function uniqueSourceRefs(value) {
  const rows = []
  const seen = new Set()
  const visit = row => {
    if (!row || typeof row !== 'object') return
    if (typeof row.provider === 'string' && (Array.isArray(row.objectIds) || Array.isArray(row.evidenceIds))) {
      const key = JSON.stringify(sorted(row))
      if (!seen.has(key)) { seen.add(key); rows.push(clone(row)) }
    }
    for (const child of Object.values(row)) visit(child)
  }
  visit(value)
  return rows
}

function canonicalSourcePage(page) {
  const { heading, body, bullets, script, assets, createdAt, updatedAt, ...canonical } = clone(page)
  return canonical
}

function cloneContentBlock(block, order, idMap) {
  const copy = clone(block)
  copy.contentBlockId = createStudioId('contentBlock')
  copy.order = order
  if (copy.type === 'heading' && copy.role === 'page_title') copy.role = 'section_title'
  idMap.set(block.contentBlockId, copy.contentBlockId)
  if (copy.type === 'list') copy.items = (copy.items ?? []).map((item, index) => ({ ...item, listItemId: createStudioId('listItem'), order: index }))
  return copy
}

function cloneScript(script, order, idMap) {
  return {
    ...clone(script),
    scriptBlockId: createStudioId('scriptBlock'),
    order,
    referencedContentBlockIds: (script.referencedContentBlockIds ?? []).filter(id => idMap.has(id)).map(id => idMap.get(id)),
  }
}

function clonePageAsset(asset, order) {
  return { ...clone(asset), pageAssetId: createStudioId('pageAsset'), order }
}

function titleBlock(title, sourceRefs) {
  return { contentBlockId: createStudioId('contentBlock'), type: 'heading', role: 'page_title', order: 0, content: title, sourceRefs: clone(sourceRefs) }
}

function newPage({ sourcePages, title, blocks, scripts, assets, order }) {
  const pageId = createStudioId('page')
  const heading = titleBlock(title, uniqueSourceRefs(sourcePages))
  return {
    id: pageId,
    pageId,
    outlineNodeId: sourcePages[0].outlineNodeId,
    draftDocumentId: createStudioId('draftDocument'),
    titleBlockId: heading.contentBlockId,
    order,
    contentBlocks: [heading, ...blocks].map((block, index) => ({ ...block, order: index })),
    scriptBlocks: scripts.map((block, index) => ({ ...block, order: index })),
    pageAssets: assets.map((asset, index) => ({ ...asset, order: index })),
    extensionPayload: {
      designContent: {
        sourcePageIds: sourcePages.map(page => page.id),
        sourcePages: sourcePages.map(canonicalSourcePage),
      },
    },
  }
}

function resolveMerge(state, command) {
  const pages = command.pageIds.map(id => state.pages.find(page => page.id === id)).sort(compare)
  const idMap = new Map()
  const blocks = []
  for (const page of pages) for (const block of [...page.contentBlocks].sort(compare)) blocks.push(cloneContentBlock(block, blocks.length, idMap))
  const scripts = pages.flatMap(page => [...page.scriptBlocks].sort(compare)).map((script, index) => cloneScript(script, index, idMap))
  const assets = pages.flatMap(page => [...page.pageAssets].sort(compare)).map((asset, index) => clonePageAsset(asset, index))
  const title = command.title ?? pages.map(page => page.contentBlocks.find(block => block.contentBlockId === page.titleBlockId)?.content).filter(Boolean).join(' / ')
  return { type: command.type, sourcePageIds: command.pageIds, resultPages: [newPage({ sourcePages: pages, title, blocks, scripts, assets, order: 0 })] }
}

function resolveSplit(state, command) {
  const source = state.pages.find(page => page.id === command.pageId)
  const blocks = new Map(source.contentBlocks.map(block => [block.contentBlockId, block]))
  const resultPages = command.parts.map((part, partIndex) => {
    const idMap = new Map()
    const clonedBlocks = part.contentBlockIds.map((id, index) => cloneContentBlock(blocks.get(id), index, idMap))
    const matchingScripts = source.scriptBlocks.filter((script, scriptIndex) => {
      const refs = script.referencedContentBlockIds ?? []
      return refs.some(id => idMap.has(id)) || (!refs.length && partIndex === 0) || (scriptIndex === 0 && source.scriptBlocks.length === 1 && partIndex === 0)
    }).map((script, index) => cloneScript(script, index, idMap))
    const assets = source.pageAssets.map((asset, index) => clonePageAsset(asset, index))
    return newPage({ sourcePages: [source], title: part.title, blocks: clonedBlocks, scripts: matchingScripts, assets, order: 0 })
  })
  return { type: command.type, sourcePageIds: [source.id], resultPages }
}

function registeredAsset(state, assetId) {
  const standard = state.project.extensionPayload?.standardArchive
  const record = standard?.documents?.['assets/manifest.json']?.assets?.find(row => row.assetId === assetId)
  if (!record) fail('design_invalid_command', '素材未登记在当前项目 manifest。', 400, { assetId })
  const linked = state.pages.flatMap(page => page.pageAssets ?? []).find(row => row.assetId === assetId)
  const objectRef = linked?.objectRef ?? standard.files?.find(file => file.relativePath === record.relativePath)?.objectRef
  if (!objectRef?.sha256 || !objectRef?.mimeType) fail('design_invalid_command', '素材缺少可打开的 ObjectStore 引用。', 400, { assetId })
  return {
    id: assetId,
    assetId,
    pageAssetId: createStudioId('pageAsset'),
    role: 'supporting',
    caption: '',
    order: 0,
    sourceRefs: clone(record.sourceRefs ?? []),
    name: record.displayName,
    type: record.mimeType,
    mimeType: record.mimeType,
    objectRef: clone(objectRef),
    widthPx: record.metadata?.widthPx,
    heightPx: record.metadata?.heightPx,
    extensionPayload: {
      standard: clone(record),
      designContent: { decodedImageBackgroundEligible: /^image\//u.test(record.mimeType) },
    },
  }
}

function resolveAssetLink(state, command) {
  const page = state.pages.find(row => row.id === command.pageId)
  if (page.pageAssets.some(row => row.assetId === command.assetId)) fail('design_invalid_command', '素材已经挂载到目标页。', 400, { pageId: page.id, assetId: command.assetId })
  const pageAsset = registeredAsset(state, command.assetId)
  pageAsset.role = command.role ?? (/^image\//u.test(pageAsset.mimeType) ? 'supporting' : 'reference')
  if (!/^image\//u.test(pageAsset.mimeType) && pageAsset.role === 'background') fail('design_invalid_command', '不可解码为图片的素材不能作为背景。')
  pageAsset.order = page.pageAssets.length
  return { type: command.type, pageId: command.pageId, pageAsset }
}

function resolvePlan(command) {
  return { type: command.type, pageId: command.pageId, plan: clone(command) }
}

function applyOperations(state, operations) {
  const next = clone(state)
  for (const operation of operations) {
    if (operation.type === 'pages.merge' || operation.type === 'page.split') {
      const sourceIds = new Set(operation.sourcePageIds)
      const firstIndex = next.pages.findIndex(page => sourceIds.has(page.id))
      if (firstIndex < 0 || operation.sourcePageIds.some(id => !next.pages.some(page => page.id === id))) fail('design_stale_source', '内容操作的来源页面已经变化。', 409)
      const before = next.pages.slice(0, firstIndex).filter(page => !sourceIds.has(page.id))
      const after = next.pages.slice(firstIndex).filter(page => !sourceIds.has(page.id))
      next.pages = [...before, ...clone(operation.resultPages), ...after].map((page, index) => ({ ...page, order: index }))
    } else if (operation.type === 'page.asset.link') {
      const page = next.pages.find(row => row.id === operation.pageId)
      if (!page) fail('design_stale_source', '素材目标页已经变化。', 409)
      page.pageAssets.push(clone(operation.pageAsset))
      page.pageAssets = page.pageAssets.map((asset, index) => ({ ...asset, order: index }))
    } else if (operation.type === 'page.design.plan') {
      const page = next.pages.find(row => row.id === operation.pageId)
      if (!page) fail('design_stale_source', '设计清单目标页已经变化。', 409)
      page.extensionPayload ??= {}
      page.extensionPayload.designContent ??= {}
      page.extensionPayload.designContent.plan = clone(operation.plan)
    }
  }
  canonicalFromState(next)
  return next
}

export function linkRegisteredAsset(state, { pageId, assetId, role } = {}) {
  const next = clone(state)
  const command = { type: 'page.asset.link', pageId, assetId, ...(role === undefined ? {} : { role }) }
  const operation = resolveAssetLink(next, command)
  return applyOperations(next, [operation])
}

function commandPages(command) {
  return command.type === 'pages.merge' ? command.pageIds : [command.pageId]
}

function validateCommands(state, commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > 100) fail('design_invalid_command', 'commands 必须包含 1 至 100 项。')
  const structural = new Set()
  const nonStructural = new Set()
  for (const command of commands) {
    if (command?.type === 'pages.merge') {
      exactKeys(command, ['type', 'pageIds', 'title'], 'pages.merge')
      strings(command.pageIds, 'pages.merge.pageIds')
      if (command.pageIds.length < 2 || command.pageIds.some(id => !state.pages.some(page => page.id === id))) fail('design_invalid_command', '页面合并至少需要两个真实页面。')
      text(command.title, 'pages.merge.title', { optional: true, max: 500 })
      for (const id of command.pageIds) { if (structural.has(id)) fail('design_invalid_command', '结构操作不能重叠。'); structural.add(id) }
    } else if (command?.type === 'page.split') {
      exactKeys(command, ['type', 'pageId', 'parts'], 'page.split')
      const page = state.pages.find(row => row.id === command.pageId)
      if (!page || !Array.isArray(command.parts) || command.parts.length < 2 || command.parts.length > 20) fail('design_invalid_command', '页面拆分必须引用真实页面并产生至少两页。')
      const assigned = []
      for (const part of command.parts) {
        exactKeys(part, ['title', 'contentBlockIds'], 'page.split.parts[]')
        text(part.title, 'page.split.parts[].title', { max: 500 })
        strings(part.contentBlockIds, 'page.split.parts[].contentBlockIds')
        if (!part.contentBlockIds.length) fail('design_invalid_command', '拆分页不能为空。')
        assigned.push(...part.contentBlockIds)
      }
      const actual = page.contentBlocks.map(block => block.contentBlockId)
      if (new Set(assigned).size !== assigned.length || assigned.length !== actual.length || actual.some(id => !assigned.includes(id))) fail('design_invalid_command', '拆分内容必须完整且不能重叠。')
      if (structural.has(page.id)) fail('design_invalid_command', '结构操作不能重叠。'); structural.add(page.id)
    } else if (command?.type === 'page.asset.link') {
      exactKeys(command, ['type', 'pageId', 'assetId', 'role'], 'page.asset.link')
      if (!state.pages.some(page => page.id === command.pageId)) fail('design_invalid_command', '素材关联必须引用真实页面。')
      text(command.assetId, 'page.asset.link.assetId', { max: 200 })
      if (command.role !== undefined && !ROLES.has(command.role)) fail('design_invalid_command', '素材角色无效。')
      nonStructural.add(command.pageId)
    } else if (command?.type === 'page.design.plan') {
      exactKeys(command, ['type', 'pageId', 'mainJudgment', 'displayedContentIds', 'scriptOrAppendixContentIds', 'pendingGaps', 'sourceRefKeys'], 'page.design.plan')
      const page = state.pages.find(row => row.id === command.pageId)
      if (!page) fail('design_invalid_command', '设计清单必须引用真实页面。')
      text(command.mainJudgment, 'page.design.plan.mainJudgment', { max: 4000 })
      strings(command.displayedContentIds, 'page.design.plan.displayedContentIds')
      strings(command.scriptOrAppendixContentIds, 'page.design.plan.scriptOrAppendixContentIds')
      strings(command.sourceRefKeys ?? [], 'page.design.plan.sourceRefKeys')
      const contentIds = new Set(page.contentBlocks.map(block => block.contentBlockId))
      const accessibleIds = new Set([...contentIds, ...page.scriptBlocks.map(block => block.scriptBlockId)])
      const sources = sourceKeys(page)
      if (command.displayedContentIds.some(id => !contentIds.has(id)) || command.scriptOrAppendixContentIds.some(id => !accessibleIds.has(id)) || (command.sourceRefKeys ?? []).some(key => !sources.has(key))) fail('design_invalid_command', '设计清单引用了不存在的内容或来源。')
      if (!Array.isArray(command.pendingGaps) || command.pendingGaps.length > 100) fail('design_invalid_command', 'pendingGaps 无效。')
      for (const gap of command.pendingGaps) {
        exactKeys(gap, ['reason', 'contentIds', 'sourceRefKeys'], 'page.design.plan.pendingGaps[]')
        text(gap.reason, 'pendingGaps[].reason', { max: 2000 })
        strings(gap.contentIds ?? [], 'pendingGaps[].contentIds')
        strings(gap.sourceRefKeys ?? [], 'pendingGaps[].sourceRefKeys')
        if ((gap.contentIds ?? []).some(id => !accessibleIds.has(id)) || (gap.sourceRefKeys ?? []).some(key => !sources.has(key))) fail('design_invalid_command', '待补缺口引用了不存在的内容或来源。')
      }
      nonStructural.add(command.pageId)
    } else fail('design_invalid_command', '不支持的内容命令。')
  }
  if ([...structural].some(id => nonStructural.has(id))) fail('design_invalid_command', '同一提案不能在替换来源页的同时修改该旧页。')
}

function proposalResult(proposal) {
  const accepted = proposal.status === 'accepted'
  return {
    proposal: clone(proposal),
    status: proposal.status,
    newPageIds: accepted ? clone(proposal.newPageIds) : [],
    scopeConfirmationRequired: accepted && proposal.newPageIds.length > 0 && proposal.scopeInherited !== true,
  }
}

function assertCurrentRun(state, { runId, sessionId, pageIds, now }) {
  const run = state.designRuns.find(row => row.runId === runId)
  if (!run || run.sessionId !== sessionId || run.projectId !== state.project.projectId || run.status === 'revoked'
    || Date.parse(run.expiresAt) <= Date.parse(now())
    || pageIds.some(pageId => !run.pageIds.includes(pageId) || run.protectedPageIds.includes(pageId))) {
    fail('design_scope_denied', '内容任务范围、保护页或有效期已经变化。', 403)
  }
  return run
}

export function createDesignContentService({ repository, designService, now = () => new Date().toISOString() } = {}) {
  if (!repository?.transactOperational || !repository?.transactContent || typeof designService?.inspectGrant !== 'function') throw new TypeError('Design content service requires Repository and DesignService')
  let queue = Promise.resolve()
  const serial = work => { const next = queue.then(work, work); queue = next.catch(() => undefined); return next }

  async function grantsFor(input, state) {
    const pageIds = [...new Set(input.commands.flatMap(commandPages))]
    const grants = []
    for (const pageId of pageIds) grants.push(await designService.inspectGrant({ sessionId: input.sessionId, runId: input.runId, pageId }))
    const run = state.designRuns.find(row => row.runId === input.runId)
    if (!run || run.sessionId !== input.sessionId || run.projectId !== state.project.projectId) fail('design_scope_denied', '内容任务不属于当前会话。', 403)
    return { run, grants, pageIds }
  }

  async function prepareImpl(input = {}) {
    finiteJson(input)
    const unexpected = Object.keys(input).filter(key => !TOP_LEVEL_KEYS.has(key))
    if (unexpected.length) fail(unexpected.some(key => AUTHORITY_KEYS.has(key)) ? 'design_scope_denied' : 'design_invalid_input', '内容提案包含不允许的宿主权限字段。', unexpected.some(key => AUTHORITY_KEYS.has(key)) ? 403 : 400, { fields: unexpected })
    if (typeof input.sessionId !== 'string' || !input.sessionId || typeof input.runId !== 'string' || !input.runId || !Number.isInteger(input.baseRevision) || input.baseRevision < 0) fail('design_invalid_input', '内容提案缺少会话、任务或版本。')
    text(input.idempotencyKey, 'idempotencyKey', { max: 200 })
    text(input.message, 'message', { max: 8000 })
    const state = repository.getState()
    const requestHash = digest(input)
    const existing = state.proposals.find(row => row.kind === PROPOSAL_KIND && row.runId === input.runId && row.idempotencyKey === input.idempotencyKey)
    if (existing) {
      if (existing.sessionId !== input.sessionId || existing.projectId !== state.project.projectId) fail('design_scope_denied', '内容提案不属于当前会话。', 403)
      if (existing.requestHash !== requestHash) fail('design_idempotency_conflict', '同一幂等键不能用于不同内容提案。', 409)
      const run = state.designRuns.find(row => row.runId === existing.runId && row.sessionId === input.sessionId)
      if (run?.executionMode === 'direct' && existing.status === 'failed') {
        await repository.transactOperational(draft => { draft.proposals.find(row => row.id === existing.id).status = 'applying'; return draft })
        return acceptImpl({ sessionId: input.sessionId, proposalId: existing.id })
      }
      return proposalResult(existing)
    }
    validateCommands(state, input.commands)
    const { run, grants, pageIds } = await grantsFor(input, state)
    if (state.project.currentRevision !== input.baseRevision) fail('design_stale_revision', '项目版本已经变化。', 409)
    const operations = input.commands.map(command => command.type === 'pages.merge' ? resolveMerge(state, command)
      : command.type === 'page.split' ? resolveSplit(state, command)
        : command.type === 'page.asset.link' ? resolveAssetLink(state, command) : resolvePlan(command))
    for (const operation of operations) if (operation.type === 'page.asset.link') await repository.verifyBlob(operation.pageAsset.objectRef)
    applyOperations(state, operations)
    const newPageIds = operations.flatMap(operation => operation.resultPages?.map(page => page.id) ?? [])
    const proposal = {
      id: createStudioId('proposal'),
      kind: PROPOSAL_KIND,
      projectId: state.project.projectId,
      sessionId: input.sessionId,
      runId: input.runId,
      scopeKey: `design-content:${input.runId}`,
      baseRevision: input.baseRevision,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      message: input.message,
      commands: clone(input.commands),
      operations,
      sourceBaselines: grants.map(grant => ({ pageId: grant.pageId, sourceStateHash: grant.sourceStateHash })),
      affectedPageIds: pageIds,
      newPageIds,
      aggregateRiskLevel: newPageIds.length ? 'structural_review_required' : 'ordinary_reversible',
      hasDeletion: newPageIds.length > 0,
      status: run.executionMode === 'direct' ? 'applying' : 'pending',
      actor: 'host-design',
      createdAt: now(),
    }
    finiteJson(proposal, 2_000_000)
    await repository.transactOperational(draft => {
      if (draft.project.currentRevision !== input.baseRevision) fail('design_stale_revision', '项目版本已经变化。', 409)
      assertCurrentRun(draft, { runId: input.runId, sessionId: input.sessionId, pageIds, now })
      const duplicate = draft.proposals.find(row => row.kind === PROPOSAL_KIND && row.runId === input.runId && row.idempotencyKey === input.idempotencyKey)
      if (duplicate) fail('design_idempotency_conflict', '幂等键正在被另一请求使用。', 409)
      draft.proposals.push(proposal)
      return draft
    })
    return run.allowApply ? acceptImpl({ sessionId: input.sessionId, proposalId: proposal.id }) : proposalResult(proposal)
  }

  async function acceptImpl(input = {}) {
    finiteJson(input)
    exactKeys(input, ['sessionId', 'proposalId'], 'accept')
    const state = repository.getState()
    const proposal = state.proposals.find(row => row.id === input.proposalId)
    if (!proposal || proposal.kind !== PROPOSAL_KIND || proposal.sessionId !== input.sessionId || proposal.projectId !== state.project.projectId) fail('design_scope_denied', '内容提案不属于当前会话。', 403)
    if (proposal.status === 'accepted') return proposalResult(proposal)
    if (!['pending', 'applying'].includes(proposal.status)) fail('design_proposal_closed', '内容提案已经处理。', 409)
    for (const baseline of proposal.sourceBaselines) {
      const grant = await designService.inspectGrant({ sessionId: input.sessionId, runId: proposal.runId, pageId: baseline.pageId })
      if (grant.sourceStateHash !== baseline.sourceStateHash) fail('design_stale_source', '来源页面已经变化。', 409)
    }
    if (state.project.currentRevision !== proposal.baseRevision) fail('design_stale_revision', '项目版本已经变化。', 409)
    await repository.transactContent({ baseRevision: proposal.baseRevision, source: 'host-design', detail: { actionType: 'design.content.accept', proposalId: proposal.id, runId: proposal.runId } }, draft => {
      const stored = draft.proposals.find(row => row.id === proposal.id)
      if (!stored || !['pending', 'applying'].includes(stored.status) || stored.requestHash !== proposal.requestHash) fail('design_proposal_closed', '内容提案已经处理。', 409)
      assertCurrentRun(draft, { runId: proposal.runId, sessionId: input.sessionId, pageIds: proposal.affectedPageIds, now })
      const next = applyOperations(draft, stored.operations)
      const accepted = next.proposals.find(row => row.id === stored.id)
      accepted.status = 'accepted'
      accepted.acceptedAt = now()
      accepted.acceptedRevision = proposal.baseRevision + 1
      const run = next.designRuns.find(row => row.runId === proposal.runId)
      if (run.executionMode === 'direct' && accepted.newPageIds.length) {
        // Grant inheritance is restricted to server-created descendants of already authorized pages.
        const removed = new Set(stored.operations.flatMap(operation => operation.sourcePageIds ?? []))
        run.pageIds = [...new Set([...run.pageIds.filter(id => !removed.has(id)), ...accepted.newPageIds])]
        run.pageLineage ??= []
        run.pageLineage.push(...stored.operations.filter(operation => operation.resultPages).map(operation => ({
          sourcePageIds: clone(operation.sourcePageIds), pageIds: operation.resultPages.map(page => page.id), operationId: stored.id,
        })))
        accepted.scopeInherited = true
      }
      return next
    })
    return proposalResult(repository.getState().proposals.find(row => row.id === proposal.id))
  }

  const prepare = input => serial(() => prepareImpl(input)).catch(async error => {
    await repository.transactOperational(state => {
      const run = state.designRuns.find(row => row.runId === input.runId && row.sessionId === input.sessionId)
      const row = state.proposals.find(row => row.kind === PROPOSAL_KIND && row.runId === input.runId && row.idempotencyKey === input.idempotencyKey)
      if (run?.executionMode === 'direct' && row && row.status !== 'accepted') { row.status = 'failed'; row.lastError = String(error.message).slice(0, 2000) }
      return state
    }).catch(() => undefined)
    throw error
  })
  const accept = input => serial(() => acceptImpl(input))

  async function progress({ sessionId, runId } = {}) {
    const state = repository.getState()
    const run = state.designRuns.find(row => row.runId === runId)
    if (!run || run.sessionId !== sessionId || run.projectId !== state.project.projectId) fail('design_scope_denied', '内容任务不属于当前会话。', 403)
    const proposals = state.proposals.filter(row => row.kind === PROPOSAL_KIND && row.runId === runId && row.sessionId === sessionId)
    return {
      run: clone(run),
      proposals: proposals.map(row => ({ proposalId: row.id, status: row.status, message: row.message, baseRevision: row.baseRevision, newPageIds: clone(row.newPageIds), scopeConfirmationRequired: row.status === 'accepted' && row.newPageIds.length > 0 && row.scopeInherited !== true, createdAt: row.createdAt, acceptedAt: row.acceptedAt ?? null })),
      pendingGaps: proposals.flatMap(row => row.commands.filter(command => command.type === 'page.design.plan').flatMap(command => command.pendingGaps.map(gap => ({ proposalId: row.id, pageId: command.pageId, reason: gap.reason, contentIds: clone(gap.contentIds ?? []), sourceRefKeys: clone(gap.sourceRefKeys ?? []) })))),
    }
  }

  return Object.freeze({ prepare, accept, progress })
}
