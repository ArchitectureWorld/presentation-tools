import {createDesignBatchService} from '../vendor/apps/studio-local/design-batch.mjs'
import {createDeliveryExportService} from '../vendor/apps/studio-local/delivery-export.mjs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRepository } from '../vendor/apps/studio-local/repository.mjs'
import {
  acceptProposal as acceptCoreProposal,
  applyCommandsFromAgent,
  beginReviewDispatch,
  executeAction as executeCoreAction,
  markProposalStale,
  markSubmissionDispatch,
  markReviewApplicationFailure,
  recoverExpiredReviewDispatches,
  rejectProposal as rejectCoreProposal,
  retryReviewSubmission,
  returnProposalToAgent as returnCoreProposalToAgent,
  submitReviewRound,
  transitionReviewSubmission,
} from '../vendor/packages/studio-core/index.mjs'
import { ERROR_CODES, StudioError, assertStudioApplyCommands } from '../vendor/packages/studio-contracts/index.mjs'
import { reviewSubmissionContext } from '../vendor/apps/studio-local/agent-context.mjs'
import { createWorkspaceWatcher, resolveWorkspaceRoot } from '../vendor/apps/studio-local/workspace-live-link.mjs'
import { createReviewTaskRunner } from '../vendor/apps/studio-local/review-task-runner.mjs'
import { createDesignService } from '../vendor/apps/studio-local/design-service.mjs'
import { createLayoutService } from '../vendor/apps/studio-local/layout-service.mjs'
import { designContextResource } from '../vendor/apps/studio-local/agent-context.mjs'
import { createDesignVisualService } from '../vendor/apps/studio-local/design-visual.mjs'
import { createDesignContentService } from '../vendor/apps/studio-local/design-content.mjs'
import { projectAssetCatalog } from '../vendor/apps/studio-local/asset-service.mjs'

const CONTENT_ACTION_PREFIXES = ['project.', 'outline.', 'draft.']
const isContentAction = type => CONTENT_ACTION_PREFIXES.some(prefix => String(type).startsWith(prefix))

function cleanSessionId(value) {
  const sessionId = String(value ?? '').trim()
  if (!sessionId) throw Object.assign(new Error('缺少 DSH Session ID'), { statusCode: 400 })
  return sessionId
}

function sessionDirectoryName(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
}

export function defaultDshDataRoot() {
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(dshHome, 'report-studio-v0.1.0')
}

function reviewPrompt(sessionId, state, round, submission, reviewRun) {
  return [
    '[Report Studio v0.1.1 · DSH Native Review]',
    `DSH Session ID: ${sessionId}`,
    `Project ID: ${state.project.id}`,
    `Project title: ${state.project.title}`,
    `Current revision: ${state.project.currentRevision}`,
    `ReviewRound ID: ${round.id}`,
    `ReviewSubmission ID: ${submission.id}`,
    `ReviewRun ID: ${reviewRun.reviewRunId}`,
    `Submission number: ${submission.number}`,
    `Base revision: ${submission.baseRevision}`,
    '',
    '处理要求：',
    '1. 必须先调用 studio_get_context 读取当前会话绑定的 Report Studio 项目。',
    `2. 根据本次批注完成修改建议后，调用 studio_apply_commands，并将 submissionId 固定为 ${submission.id}。`,
    '3. studio_apply_commands 会通过现有 CAS 网关直接应用本次批注允许的全部命令，并产生新的 Revision；不会创建 Proposal。',
    '4. 不要假定所有批注能一次解决；只处理有充分依据的修改。没有可执行修改时也调用 studio_apply_commands，commands=[]，message 写明原因，保持批注未完成，不得只回复文字而悬置任务。',
    '5. studio_apply_commands 顶层对象只允许 submissionId、projectId、baseRevision、scopeKey、idempotencyKey、message、commands、annotationResults。每条批注的 annotationResults 必须给出 annotationId、annotationVersion、status（completed/partial/unresolved）、reason、commandIds；completed 必须引用实际执行命令，未覆盖的批注保持未完成。',
    '6. draft.update 命令只允许 commandId、type、scopeKey、baseRevision、riskLevel、sourceAnnotationIds、pageId、patch。',
    '7. draft.update 的 patch 只能且必须包含 heading、body、script 其中一个字段；不得在 draft.update 命令中添加 title。',
    '8. 直接依据 studio_get_context 返回的数据构造命令；不得搜索源码、写入临时文件或绕过 studio_apply_commands。',
    '',
    '本次不可变 ReviewSubmission：',
    JSON.stringify(submission, null, 2),
  ].join('\n')
}

function chatPrompt(sessionId, state, input) {
  const text = String(input?.text ?? '').trim()
  if (!text) throw Object.assign(new Error('消息不能为空'), { statusCode: 400 })
  return [
    '[Report Studio v0.1.1 · DSH Native Chat]',
    `DSH Session ID: ${sessionId}`,
    `Project ID: ${state.project.id}`,
    `Project title: ${state.project.title}`,
    `Current revision: ${state.project.currentRevision}`,
    `Current stage: ${input?.stage || state.ui.stage}`,
    `Current page ID: ${input?.pageId || state.ui.activePageId || 'none'}`,
    '',
    '你正在当前 DSH Session 中协助用户处理 Report Studio 项目。需要读取项目时调用 studio_get_context。',
    '如用户要求修改正式内容，而当前上下文没有可关联的 ReviewSubmission，请先说明需要用户在界面中添加批注并“提给Agent”；不要绕过批注网关和 Revision 网关直接声称已修改。',
    '',
    `用户请求：${text}`,
  ].join('\n')
}

export function createStudioDshRuntime({
  dataRoot = defaultDshDataRoot(),
  sessions = null,
  repositoryFactory = createRepository,
  workspaceWatcherFactory = createWorkspaceWatcher,
  workspaceRootResolver = resolveWorkspaceRoot,
  agentBridge = undefined,
  leaseMs = 120_000,
} = {}) {
  const root = resolve(dataRoot)
  const repositories = new Map()
  const workspaceEntries = new Map()
  const sessionBindings = new Map()
  const nativeFolds = new WeakMap()
  const nativePending = new Set()
  let nativeClosing = false
  const designs = new WeakMap()
  const layouts = new WeakMap()
  const batches = new WeakMap()
  const deliveries = new WeakMap()
  const contents = new WeakMap()
  async function recordDesignFailure(sessionId,input,error){
    if(!input.runId&&!input.candidateId&&!input.proposalId)return
    const repository=await repositoryFor(sessionId)
    await repository.transactOperational(state=>{
      const candidate=state.layoutCandidates.find(row=>row.candidateId===input.candidateId&&row.candidateSha===input.candidateSha&&row.sessionId===sessionId)
      const proposal=state.proposals.find(row=>row.id===input.proposalId&&row.sessionId===sessionId)
      const run=state.designRuns.find(row=>row.runId===(candidate?.runId??proposal?.runId??input.runId)&&row.sessionId===sessionId)
      if(!run)return state
      const message=error?String(error.message??error).slice(0,2000):null
      run.lastError=message;if(candidate)candidate.lastError=message;if(proposal)proposal.lastError=message
      return state
    })
  }
  async function contentFor(sessionId){const repository=await repositoryFor(sessionId);if(!contents.has(repository))contents.set(repository,createDesignContentService({repository,designService:await designFor(sessionId)}));return contents.get(repository)}
  async function designProgress(sessionId,runId){
    const layout=await (await designFor(sessionId)).progress({sessionId,runId})
    const content=await (await contentFor(sessionId)).progress({sessionId,runId})
    const repository=await repositoryFor(sessionId)
    return {...layout,content,visualProposals:repository.getState().proposals.filter(row=>row.kind==='design.visual.v1'&&row.runId===runId&&row.sessionId===sessionId)}
  }
  let visualService=null
  function bindDesignVisual(preplanning){
    if(visualService)throw new Error('Pre 视觉桥已经绑定。')
    const bound=createDesignVisualService({runtime:{repositoryFor,designFor,workspaceStatus},preplanning});bound.bind();visualService=bound
    return ()=>{bound.dispose();if(visualService===bound)visualService=null}
  }
  function visualFor(){if(!visualService)throw new Error('Pre 当前页视觉桥未加载，无法补图。');return visualService}
  async function acceptDesignProposal(sessionId,proposalId){
    const repository=await repositoryFor(sessionId);const proposal=repository.getState().proposals.find(row=>row.id===proposalId)
    if(proposal?.kind==='design.visual.v1')return visualFor().accept({sessionId,proposalId})
    if(proposal?.kind==='design.content.v1')return (await contentFor(sessionId)).accept({sessionId,proposalId})
    return (await designFor(sessionId)).accept({sessionId,proposalId})
  }
  async function layoutFor(sessionId) {
    const repository=await repositoryFor(sessionId)
    if(!layouts.has(repository)) layouts.set(repository,createLayoutService({repository,layoutRoot:join(sessionBindings.get(cleanSessionId(sessionId))??repository.root,'layouts')}))
    return layouts.get(repository)
  }
  async function batchFor(sessionId) {
    const repository=await repositoryFor(sessionId)
    if(!batches.has(repository)) batches.set(repository,createDesignBatchService({repository,layoutService:await layoutFor(sessionId)}))
    return batches.get(repository)
  }
  async function deliveryFor(sessionId) {
    const repository=await repositoryFor(sessionId)
    if(!deliveries.has(repository)) deliveries.set(repository,createDeliveryExportService({repository,layoutService:await layoutFor(sessionId)}))
    return deliveries.get(repository)
  }
  async function designFor(sessionId) {
    const repository = await repositoryFor(sessionId)
    let service = designs.get(repository)
    if (!service) {
      const layoutService = await layoutFor(sessionId)
      const base = createDesignService({repository,layoutService})
      service = Object.freeze({...base,context:async input=>{
        const context=designContextResource(await base.context(input));const state=repository.getState()
        const projectAssets=projectAssetCatalog(state).map(asset=>({...asset,previewAvailable:['image/png','image/jpeg'].includes(asset.objectRef?.mimeType),previewGap:asset.referenceError??(['image/png','image/jpeg'].includes(asset.objectRef?.mimeType)?null:'原文件可打开，没有图像预览；不计入视觉覆盖。'),openUrl:asset.objectRef?`/report-studio/api/assets/${encodeURIComponent(asset.id)}/content?sessionId=${encodeURIComponent(input.sessionId)}`:null}))
        return {...context,page:structuredClone(state.pages.find(page=>page.id===input.pageId)),projectAssets}
      },currentPreview:async({pageId})=>{
        const current=await layoutService.get({pageId,reconcile:false})
        if(!current.layout||current.stale)throw new Error('当前页没有有效布局预览；请先准备候选。')
        return {layout:current.layout,renderPlan:current.renderPlan,pageAssets:(await layoutService.designContext({pageId})).pageAssets,candidateSha:current.layoutRef.sha256}
      }})
      designs.set(repository,service)
    }
    return service
  }
  const taskRunner = createReviewTaskRunner({ getRepository: repositoryFor, agentBridge, leaseMs, applyProposal: ({ sessionId, proposalId }) => acceptProposal(sessionId, proposalId) })

  function sessionWorkspace(sessionId) {
    const session = sessions?.get(sessionId)
    const cwd = session?.header?.cwd
    if (typeof cwd !== 'string' || !cwd.trim()) {
      throw new StudioError(ERROR_CODES.WORKSPACE_UNAVAILABLE, '当前 DSH Session 没有可用的 Workspace。', { sessionId }, 404)
    }
    return cwd
  }

  function statusFor(entry, override = {}) {
    const source = entry.status ?? { status: 'watcher_disconnected', workspaceRoot: entry.workspaceRoot }
    const { snapshot: _snapshot, ...safe } = source
    return {
      ...structuredClone(safe),
      appliedFingerprint: entry.appliedFingerprint ?? null,
      candidateFingerprint: entry.candidate?.fingerprint ?? null,
      candidateSourceRevision: entry.candidate?.sourceRevision ?? null,
      hasUpstreamCandidate: Boolean(entry.candidate && entry.candidate.fingerprint !== entry.appliedFingerprint),
      ...structuredClone(override),
    }
  }

  async function publishCandidate(entry, { discardLocalChanges = false } = {}) {
    const candidate = entry.candidate
    if (!candidate || candidate.fingerprint === entry.appliedFingerprint) {
      entry.candidate = null
      return statusFor(entry)
    }
    const repository = await entry.repository
    try { await repository.publishUpstreamSnapshot({
      snapshot: candidate.snapshot,
      fingerprint: candidate.fingerprint,
      workspaceRoot: candidate.workspaceRoot,
      sourceRevision: candidate.sourceRevision,
      sourceRevisions: candidate.sourceRevisions,
      discardLocalChanges,
    }) } catch (error) {
      if (error.code !== ERROR_CODES.WORKSPACE_SAVED_CONFLICT) throw error
      entry.savedConflictFingerprint = candidate.fingerprint
      entry.status = { ...candidate, status: ERROR_CODES.WORKSPACE_SAVED_CONFLICT, conflict: error.details, message: error.message }
      return statusFor(entry)
    }
    entry.savedConflictFingerprint = null
    entry.appliedFingerprint = candidate.fingerprint
    entry.candidate = null
    entry.status = { ...candidate, status: 'connected' }
    return statusFor(entry)
  }

  function lastAppliedFingerprint(repository) {
    return [...(repository.getState().revisions ?? [])].reverse()
      .find(revision => revision.detail?.actionType === 'workspace.upstream_publish')?.detail?.fingerprint ?? null
  }

  async function workspaceEntry(workspaceRoot) {
    let entry = workspaceEntries.get(workspaceRoot)
    if (entry) return entry.ready

    entry = {
      workspaceRoot,
      sessions: new Set(),
      repository: repositoryFactory(join(root, 'workspaces', sessionDirectoryName(workspaceRoot))),
      watcher: null,
      status: { status: 'watcher_disconnected', workspaceRoot },
      candidate: null,
      appliedFingerprint: null,
      ready: null,
    }
    workspaceEntries.set(workspaceRoot, entry)
    entry.ready = (async () => {
      const repository = await entry.repository
      entry.appliedFingerprint = lastAppliedFingerprint(repository)
      entry.watcher = workspaceWatcherFactory({
        workspaceRoot,
        putBlob: repository.putBlob,
        async onCandidate(candidate) {
          entry.candidate = structuredClone(candidate)
          if (!entry.appliedFingerprint) await publishCandidate(entry)
        },
        onStatus(status) {
          entry.status = structuredClone(status)
          if (entry.candidate && entry.candidate.fingerprint !== entry.appliedFingerprint && status.status === 'connected') {
            entry.status.status = entry.savedConflictFingerprint === entry.candidate.fingerprint ? ERROR_CODES.WORKSPACE_SAVED_CONFLICT : 'upstream_update_available'
          }
        },
      })
      await entry.watcher.start()
      return entry
    })().catch(async error => {
      workspaceEntries.delete(workspaceRoot)
      await entry.watcher?.close?.().catch(() => undefined)
      await entry.repository.then(repository => repository.close()).catch(() => undefined)
      throw error
    })
    return entry.ready
  }

  async function detachSession(sessionId) {
    const workspaceRoot = sessionBindings.get(sessionId)
    if (!workspaceRoot) return
    sessionBindings.delete(sessionId)
    const entry = workspaceEntries.get(workspaceRoot)
    if (!entry) return
    entry.sessions.delete(sessionId)
    if (entry.sessions.size) return
    workspaceEntries.delete(workspaceRoot)
    const ready = await entry.ready.catch(() => entry)
    await ready.watcher?.close?.()
    await ready.repository.then(repository => repository.close())
  }

  async function openWorkspace(rawSessionId) {
    const sessionId = cleanSessionId(rawSessionId)
    let workspaceRoot
    try {
      workspaceRoot = await workspaceRootResolver(sessionWorkspace(sessionId))
    } catch (error) {
      await detachSession(sessionId)
      throw error
    }
    const previousRoot = sessionBindings.get(sessionId)
    if (previousRoot === workspaceRoot) return statusFor(await workspaceEntry(workspaceRoot))
    await detachSession(sessionId)
    const entry = await workspaceEntry(workspaceRoot)
    entry.sessions.add(sessionId)
    sessionBindings.set(sessionId, workspaceRoot)
    return statusFor(entry)
  }

  async function repositoryFor(rawSessionId) {
    const sessionId = cleanSessionId(rawSessionId)
    if (sessions) {
      await openWorkspace(sessionId)
      return workspaceEntries.get(sessionBindings.get(sessionId)).repository
    }
    let pending = repositories.get(sessionId)
    if (!pending) {
      pending = repositoryFactory(join(root, 'sessions', sessionDirectoryName(sessionId)))
      repositories.set(sessionId, pending)
    }
    return pending
  }

  async function workspaceStatus(sessionId) {
    await openWorkspace(sessionId)
    return statusFor(workspaceEntries.get(sessionBindings.get(cleanSessionId(sessionId))))
  }

  async function reloadWorkspace(sessionId, { dirty = false } = {}) {
    await openWorkspace(sessionId)
    const entry = workspaceEntries.get(sessionBindings.get(cleanSessionId(sessionId)))
    await entry.watcher.rescan()
    if (!entry.candidate || entry.candidate.fingerprint === entry.appliedFingerprint) return statusFor(entry)
    if (dirty) return statusFor(entry, { status: ERROR_CODES.WORKSPACE_DIRTY_CONFLICT })
    return publishCandidate(entry)
  }

  async function applyWorkspaceCandidate(sessionId, input = {}) {
    await openWorkspace(sessionId)
    const entry = workspaceEntries.get(sessionBindings.get(cleanSessionId(sessionId)))
    return publishCandidate(entry, { discardLocalChanges: input.discardLocalChanges === true })
  }

  async function close() {
    const entries = [...workspaceEntries.values()]
    workspaceEntries.clear()
    sessionBindings.clear()
    await Promise.allSettled(entries.map(async entry => {
      const ready = await entry.ready.catch(() => entry)
      await ready.watcher?.close?.()
      await ready.repository.then(repository => repository.close())
    }))
    const legacy = [...repositories.values()]
    repositories.clear()
    await Promise.allSettled(legacy.map(async pending => (await pending).close()))
  }

  function prepareNativeRun(state, reviewRun, sessionId) {
    if (agentBridge?.configured) return
    const run = state.reviewRuns.find(row => row.reviewRunId === reviewRun.reviewRunId)
    run.executionMode = 'native'
    const live = sessions?.get?.(sessionId)
    if (Array.isArray(live?.events)) run.nativeStartSeq = live.events.length
    Object.assign(reviewRun, structuredClone(run))
  }

  function nativeModel(source) {
    const identifier = value => typeof value === 'string' && value.length <= 128 && /^[\w.-]+(?:\/[\w.-]+)*$/.test(value)
    return identifier(source?.provider) && identifier(source?.model) ? { provider: source.provider, model: source.model } : null
  }

  function nativeFailure(reason) {
    const code = String(reason?.error?.code ?? '').toUpperCase()
    const message = String(reason?.error?.message ?? '')
    if (code === 'QUOTA' || /quota|额度|配额/i.test(message)) return '模型服务额度已耗尽，本次批注未保存。恢复额度后可重试。'
    if (/429|rate.limit/i.test(message)) return '模型服务请求受限，本次批注未保存。请稍后重试。'
    if (/AUTH|UNAUTHORIZED|FORBIDDEN/.test(code) || /401|403/.test(message)) return '模型服务鉴权失败，本次批注未保存。请检查 DSH 模型配置。'
    if (/timeout|timed out|超时/i.test(message)) return 'DSH 本轮执行超时，本次批注未保存。可重试。'
    if (reason?.kind === 'error') return 'DSH 模型执行失败，本次批注未保存。请查看主会话后重试。'
    if (reason?.kind === 'aborted' || reason?.kind === 'interrupted') return 'DSH 本轮执行已中断，本次批注未保存。可重试。'
    return 'DSH 本轮已结束，但没有提交可保存的批注修改。批注仍未完成，可重试。'
  }

  function nativeEvidence(session, run) {
    const events = session?.events
    if (!Array.isArray(events) || !Number.isInteger(run.nativeStartSeq)) return null
    let folds = nativeFolds.get(session)
    if (!folds) { folds = new Map(); nativeFolds.set(session, folds) }
    let fold = folds.get(run.reviewRunId)
    if (!fold || fold.cursor > events.length) {
      fold = { cursor: run.nativeStartSeq, currentTurn: null, turn: null, dequeueTurn: null, removed: false, queues: new Map(), seen: false, model: null, ended: false, error: null }
      folds.set(run.reviewRunId, fold)
    }
    const matches = message => message?.role === 'user' && message?.source?.kind === 'user' && (message.content ?? []).some(block =>
      block.type === 'text' && typeof block.text === 'string'
      && block.text.startsWith('[Report Studio v0.1.1 · DSH Native Review]\n')
      && block.text.includes(`\nReviewSubmission ID: ${run.reviewSubmissionId}\n`)
      && block.text.includes(`\nReviewRun ID: ${run.reviewRunId}\n`))
    for (; fold.cursor < events.length; fold.cursor++) {
      const event = events[fold.cursor]
      const data = event?.data
      if (event?.type === 'turn/start') fold.currentTurn = data.turn
      else if (event?.type === 'agent/inbox/spliced') {
        const queue = fold.queues.get(data.target) ?? []
        const inserted = (data.inserted ?? []).map(matches)
        if (inserted.includes(true)) fold.seen = true
        // Queue entries that predate this ReviewRun still occupy their original indices.
        while (queue.length < data.start) queue.push(false)
        const removed = queue.splice(data.start, data.removedCount ?? 0, ...inserted)
        if (removed.includes(true) && !inserted.includes(true)) {
          fold.removed = true
          fold.dequeueTurn = data.outcome === 'canceled' ? null : fold.currentTurn
        }
        fold.queues.set(data.target, queue)
      } else if (event?.type === 'user/message' && matches(data) && Number.isInteger(fold.currentTurn)) {
        fold.turn = fold.currentTurn
        fold.seen = true
      } else if (event?.type === 'assistant/message' && data.turn === fold.turn && fold.turn !== null && data.message?.source?.kind === 'model') {
        fold.model = nativeModel(data.message?.source) ?? fold.model
      } else if (event?.type === 'request/header' && fold.currentTurn === fold.turn && fold.turn !== null) {
        fold.model = nativeModel(data.header?.config) ?? fold.model
      } else if (event?.type === 'turn/end') {
        if (data.turn === fold.turn && fold.turn !== null) { fold.ended = true; fold.error = nativeFailure(data.reason) }
        if (data.turn === fold.dequeueTurn && fold.turn === null) fold.dequeueTurn = null
        if (data.turn === fold.currentTurn) fold.currentTurn = null
      }
    }
    const queued = [...fold.queues.values()].some(queue => queue.includes(true))
    const cancelled = fold.seen && fold.removed && !queued && fold.turn === null && fold.dequeueTurn === null
    return { seen: fold.seen, turn: fold.turn, model: fold.model, ended: fold.ended, error: fold.error,
      cancelled, queued }
  }

  async function refreshNativeReviews(repository, session, { disposed = false } = {}) {
    if (!session?.id) return
    const current = repository.getState()
    const updates = current.reviewRuns.filter(run => run.parentSessionId === session.id && Number.isInteger(run.nativeStartSeq)
      && ['pending_dispatch', 'dispatched'].includes(run.integrationState)).map(run => ({ run, evidence: nativeEvidence(session, run) }))
      .filter(({ run, evidence }) => evidence && (disposed || evidence.ended || evidence.cancelled || evidence.seen && (run.leaseExpiresAt !== null
        || run.phase !== (evidence.turn === null ? 'queued' : 'processing') || run.nativeTurn !== evidence.turn
        || evidence.model && (run.executionModel?.provider !== evidence.model.provider || run.executionModel?.model !== evidence.model.model))))
    if (!updates.length) return
    await repository.transactOperational(state => {
      for (const { run: previous, evidence } of updates) {
        const submission = state.reviewSubmissions.find(row => row.id === previous.reviewSubmissionId)
        let run = state.reviewRuns.find(row => row.reviewRunId === previous.reviewRunId)
        if (!run || submission?.activeReviewRunId !== run.reviewRunId || !['pending_dispatch', 'dispatched'].includes(submission.status)) continue
        if (evidence.seen && submission.status === 'pending_dispatch') {
          state = markSubmissionDispatch(state, submission.id, { status: 'dispatched', reviewRunId: run.reviewRunId, sessionId: session.id }).state
          run = state.reviewRuns.find(row => row.reviewRunId === previous.reviewRunId)
        }
        if (evidence.seen) {
          run.leaseExpiresAt = null
          run.phase = evidence.turn === null ? 'queued' : 'processing'
          run.nativeTurn = evidence.turn
          if (evidence.model) run.executionModel = evidence.model
        }
        if (evidence.ended || evidence.cancelled || disposed) {
          state = markReviewApplicationFailure(state, submission.id, { reviewRunId: run.reviewRunId,
            error: new Error(evidence.error || (evidence.cancelled ? '批注请求已从 DSH 队列移除，本次未执行修改。可重新提交。' : 'DSH 会话已关闭，本次批注未保存。重新打开会话后可重试。')) }).state
        }
      }
      return state
    })
  }

  function handleNativeSessionEvent(session, event, options = {}) {
    if (nativeClosing || !session?.id || !['agent/inbox/spliced', 'user/message', 'assistant/message', 'request/header', 'turn/end', 'session/disposed'].includes(event?.type)) return
    const pending = workspaceEntries.get(sessionBindings.get(session.id))?.repository ?? repositories.get(session.id)
    if (!pending) return
    const task = Promise.resolve(pending).then(repository => refreshNativeReviews(repository, session, options))
    nativePending.add(task)
    void task.finally(() => nativePending.delete(task)).catch(() => undefined)
    return task
  }

  async function getState(sessionId) {
    const repository = await repositoryFor(sessionId)
    const nativeSessionIds = new Set(repository.getState().reviewRuns.filter(run => Number.isInteger(run.nativeStartSeq)
      && ['pending_dispatch', 'dispatched'].includes(run.integrationState)).map(run => run.parentSessionId))
    for (const id of nativeSessionIds) await refreshNativeReviews(repository, sessions?.get?.(id))
    const current = repository.getState()
    if (!recoverExpiredReviewDispatches(current).recoveredReviewRunIds.length) return structuredClone(current)
    const recovered = await repository.transactOperational(state => recoverExpiredReviewDispatches(state).state)
    return structuredClone(recovered)
  }

  async function executeAction(sessionId, action) {
    const repository = await repositoryFor(sessionId)
    if (isContentAction(action?.type)) {
      if (!Number.isInteger(action.baseRevision)) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '内容操作必须携带 baseRevision。', undefined, 400)
      const cleanAction = { ...structuredClone(action) }
      delete cleanAction.baseRevision
      return repository.transactContent(
        { baseRevision: action.baseRevision, source: 'human', detail: { actionType: action.type } },
        state => executeCoreAction(state, cleanAction).state,
      )
    }
    return repository.transactOperational(state => executeCoreAction(state, action).state)
  }

  async function submitReview(sessionId, input) {
    const id = cleanSessionId(sessionId)
    const repository = await repositoryFor(id)
    let submitted
    let begun
    await repository.transactOperational(state => {
      submitted = submitReviewRound(state, input)
      begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: id, leaseMs })
      prepareNativeRun(begun.state, begun.reviewRun, id)
      return begun.state
    })
    const task = agentBridge?.configured
      ? await taskRunner.start({ sessionId: id, submissionId: submitted.submission.id, reviewRunId: begun.reviewRun.reviewRunId })
      : { ...begun.reviewRun, executionMode: 'native' }
    return {
      state: structuredClone(repository.getState()),
      round: structuredClone(submitted.round),
      submission: structuredClone(begun.submission),
      reviewRun: structuredClone(begun.reviewRun),
      task: structuredClone(task),
      dshPrompt: {
        kind: 'report_studio.review_submission',
        sessionId: id,
        text: reviewPrompt(id, submitted.state, submitted.round, submitted.submission, begun.reviewRun),
      },
    }
  }

  async function prepareChat(sessionId, input) {
    const id = cleanSessionId(sessionId)
    const state = (await repositoryFor(id)).getState()
    return {
      dshPrompt: {
        kind: 'report_studio.chat',
        sessionId: id,
        text: chatPrompt(id, state, input),
      },
    }
  }

  async function acceptProposal(sessionId, proposalId) {
    const repository = await repositoryFor(sessionId)
    const proposal = repository.getState().proposals.find(item => item.id === proposalId)
    if (!proposal) throw new Error('未找到 Proposal')
    if(proposal.kind==='layout'||String(proposal.kind).startsWith('design.'))throw new Error('设计提案必须通过宿主设计入口确认。')
    try {
      const state = await repository.transactContent(
        { baseRevision: proposal.baseRevision, source: 'agent', detail: { proposalId, submissionId: proposal.submissionId } },
        current => {
          const accepted = acceptCoreProposal(current, proposalId).state
          if (agentBridge?.configured) {
            for (const run of accepted.reviewRuns ?? []) {
              if (run.reviewSubmissionId !== proposal.submissionId) continue
              run.phase = 'proposal_created'
              run.closedAt = null
            }
          }
          return accepted
        },
      )
      await taskRunner.closeSubmission({ sessionId, submissionId: proposal.submissionId })
      const closedState = repository.getState()
      return { state: closedState, revision: structuredClone(closedState.revisions.at(-1)) }
    } catch (error) {
      if (error?.code !== ERROR_CODES.STALE_REVISION && error?.message !== 'stale_revision') throw error
      await repository.transactOperational(current => markProposalStale(current, proposalId).state)
      await taskRunner.closeSubmission({ sessionId, submissionId: proposal.submissionId })
      throw error
    }
  }

  async function updateProposal(sessionId, proposalId, action) {
    const repository = await repositoryFor(sessionId)
    let result
    let submitted
    let begun
    await repository.transactOperational(current => {
      result = action === 'reject' ? rejectCoreProposal(current, proposalId) : returnCoreProposalToAgent(current, proposalId)
      if (action === 'return' && agentBridge?.configured) {
        const previous = current.reviewSubmissions.find(item => item.id === result.proposal.submissionId)
        const annotationIds = new Set(previous.annotationSnapshots.map(item => item.annotationId))
        for (const annotation of result.state.annotations) {
          if (annotationIds.has(annotation.id) && annotation.resolution === 'open') annotation.lifecycle = 'draft'
        }
        submitted = submitReviewRound(result.state, { reviewRoundId: previous.reviewRoundId, scopeKey: previous.scopeKey, stage: previous.stage, pageId: previous.pageId })
        begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: cleanSessionId(sessionId), leaseMs })
        return begun.state
      }
      return result.state
    })
    if (action === 'reject') await taskRunner.closeSubmission({ sessionId, submissionId: result.proposal.submissionId })
    if (begun) {
      const task = await taskRunner.start({ sessionId, submissionId: submitted.submission.id, reviewRunId: begun.reviewRun.reviewRunId })
      return { state: repository.getState(), proposal: result.proposal, submission: begun.submission, reviewRun: begun.reviewRun, task }
    }
    return { state: repository.getState(), proposal: result.proposal }
  }

  async function getContext(sessionId, submissionId) {
    const id = cleanSessionId(sessionId)
    const repository = await repositoryFor(id)
    const state = repository.getState()
    const cleanSubmissionId = String(submissionId ?? '').trim()
    if (!cleanSubmissionId) throw new StudioError(ERROR_CODES.INVALID_COMMAND, 'submissionId 必填。', undefined, 400)
    const submission = state.reviewSubmissions.find(item => item.id === cleanSubmissionId)
    if (!submission) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, `ReviewSubmission '${cleanSubmissionId}' 不存在。`, undefined, 404)
    if (state.project.currentRevision !== submission.baseRevision) {
      throw new StudioError(ERROR_CODES.STALE_REVIEW_SUBMISSION, 'ReviewSubmission 的基线已经过期，请重新提交批注。', {
        submissionId: cleanSubmissionId,
        baseRevision: submission.baseRevision,
        currentRevision: state.project.currentRevision,
      }, 409)
    }
    const snapshot = await repository.getSnapshotAt(submission.baseRevision)
    const projection = reviewSubmissionContext(snapshot, submission)
    return {
      sessionId: id,
      ...projection,
    }
  }

  async function applyCommands(sessionId, input) {
    const id = cleanSessionId(sessionId)
    const repository = await repositoryFor(id)
    const submissionId = String(input?.submissionId ?? '').trim()
    assertStudioApplyCommands(input)
    const existingState = repository.getState()
    const existingSubmission = existingState.reviewSubmissions.find(item => item.id === submissionId)
    if (['accepted', 'no_changes'].includes(existingSubmission?.status)) {
      const reused = applyCommandsFromAgent(existingState, submissionId, structuredClone(input))
      return { submissionId, reviewRoundId: existingSubmission.reviewRoundId, baseRevision: existingSubmission.baseRevision,
        status: existingSubmission.status, currentRevision: existingState.project.currentRevision, message: reused.summary,
        completionStatus: reused.completionStatus, annotationResults: existingSubmission.annotationResults, reused: true }
    }
    let applied
    let submission
    const apply = state => {
      submission = state.reviewSubmissions.find(item => item.id === submissionId)
      // A real native tool call is delivery evidence even when browser ACK is late.
      if (submission?.status === 'pending_dispatch') state = markSubmissionDispatch(state, submissionId, {
        status: 'dispatched', reviewRunId: submission.activeReviewRunId, sessionId: id,
      }).state
      applied = applyCommandsFromAgent(state, submissionId, structuredClone(input))
      return applied.state
    }
    try {
      if (!input.commands.length) await repository.transactOperational(apply)
      else await repository.transactContent({ baseRevision: input.baseRevision, source: 'agent', detail: {
        submissionId, summary: input.message, commandCount: input.commands.length,
        annotationResults: structuredClone(input.annotationResults ?? []),
      } }, apply)
    } catch (error) {
      if (existingSubmission) await repository.transactOperational(state => markReviewApplicationFailure(state, submissionId,
        { reviewRunId: existingSubmission.activeReviewRunId, error }).state).catch(() => undefined)
      throw error
    }
    return {
      completionStatus: applied.completionStatus,
      annotationResults: repository.getState().reviewSubmissions.find(row => row.id === submissionId)?.annotationResults,
      submissionId,
      reviewRoundId: submission.reviewRoundId,
      baseRevision: submission.baseRevision,
      status: repository.getState().reviewSubmissions.find(row => row.id === submissionId).status,
      currentRevision: repository.getState().project.currentRevision,
      message: applied.summary,
    }
  }

  async function updateDispatch(sessionId, submissionId, input) {
    if (!['dispatched', 'dispatch_failed'].includes(input?.status)) throw new StudioError(ERROR_CODES.INVALID_SUBMISSION_TRANSITION, '无效投递回执状态。', undefined, 400)
    const id = cleanSessionId(sessionId)
    const repository = await repositoryFor(id)
    await refreshNativeReviews(repository, sessions?.get?.(id))
    let result
    await repository.transactOperational(state => {
      const submission = state.reviewSubmissions.find(row => row.id === submissionId)
      const run = state.reviewRuns.find(row => row.reviewRunId === input.reviewRunId && row.reviewSubmissionId === submissionId && row.parentSessionId === id)
      if (run && submission?.activeReviewRunId === run.reviewRunId && !['pending_dispatch', 'dispatched'].includes(submission.status)) {
        result = { state, submission: structuredClone(submission) }; return state
      }
      if (run && submission?.activeReviewRunId === run.reviewRunId && submission.status === 'dispatched'
        && Number.isInteger(run.nativeStartSeq) && run.leaseExpiresAt === null && input.status === 'dispatch_failed') {
        result = { state, submission: structuredClone(submission) }; return state
      }
      result = markSubmissionDispatch(state, submissionId, { ...input, sessionId: id })
      return result.state
    })
    return result.submission
  }

  async function retrySubmission(sessionId, submissionId) {
    const id = cleanSessionId(sessionId)
    const repository = await repositoryFor(id)
    let result
    await repository.transactOperational(state => {
      const submission = state.reviewSubmissions.find(item => item.id === submissionId)
      if (!submission) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到 ReviewSubmission', { submissionId }, 404)
      let recoverable = state
      if (submission.status === 'pending_dispatch' && submission.activeReviewRunId) {
        recoverable = transitionReviewSubmission(state, submissionId, 'dispatch_failed', {
          reviewRunId: submission.activeReviewRunId,
          error: '用户请求继续投递。',
        }).state
      }
      const previous = recoverable.reviewSubmissions.find(item => item.id === submissionId)
      if (previous.supersededBy) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '已有新的重试任务，请查看该任务。', { submissionId: previous.supersededBy }, 409)
      const retryable = ['dispatch_failed', 'apply_failed', 'conflict'].includes(previous.status)
      const staleAnnotations = previous.annotationSnapshots.some(snapshot => {
        const annotation = recoverable.annotations.find(row => row.id === snapshot.annotationId)
        return !annotation || annotation.version !== snapshot.annotationVersion || annotation.instruction !== snapshot.instruction
      })
      if (retryable && (previous.baseRevision !== recoverable.project.currentRevision || staleAnnotations)) {
        const previousIndex = recoverable.reviewSubmissions.findIndex(row => row.id === previous.id)
        const newerIds = new Set(recoverable.reviewSubmissions.slice(previousIndex + 1).flatMap(row => row.annotationSnapshots.map(a => a.annotationId)))
        const ids = previous.annotationSnapshots.map(row => row.annotationId).filter(id => !newerIds.has(id) && recoverable.annotations.some(a => a.id === id && a.resolution === 'open'))
        if (!ids.length) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '批注已处理或已在后续任务中，请查看新任务。', undefined, 409)
        for (const annotation of recoverable.annotations) if (ids.includes(annotation.id) && annotation.resolution === 'open') annotation.lifecycle = 'draft'
        const submitted = submitReviewRound(recoverable, { reviewRoundId: previous.reviewRoundId, scopeKey: previous.scopeKey,
          stage: previous.stage, pageId: previous.pageId, annotationIds: ids })
        submitted.state.reviewSubmissions.find(row => row.id === previous.id).supersededBy = submitted.submission.id
        submitted.state.reviewSubmissions.find(row => row.id === submitted.submission.id).retryOf = previous.id
        result = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: id, leaseMs })
      } else result = retryable ? retryReviewSubmission(recoverable, submissionId, { sessionId: id, leaseMs })
        : beginReviewDispatch(recoverable, submissionId, { sessionId: id, leaseMs })
      prepareNativeRun(result.state, result.reviewRun, id)
      return result.state
    })
    const current = repository.getState()
    const round = current.reviewRounds.find(item => item.id === result.submission.reviewRoundId)
    const task = agentBridge?.configured
      ? await taskRunner.start({ sessionId: id, submissionId: result.submission.id, reviewRunId: result.reviewRun.reviewRunId })
      : { ...result.reviewRun, executionMode: 'native' }
    return {
      state: current,
      submission: result.submission,
      reviewRun: result.reviewRun,
      task: structuredClone(task),
      dshPrompt: { kind: 'report_studio.review_submission', sessionId: id, text: reviewPrompt(id, current, round, result.submission, result.reviewRun) },
    }
  }

  async function confirmTask(sessionId, taskId) {
    const repository = await repositoryFor(cleanSessionId(sessionId))
    const state = repository.getState()
    const run = (state.reviewRuns ?? []).find(item => item.taskId === taskId && item.parentSessionId === sessionId)
    if (!run) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到批注任务。', undefined, 404)
    if (run.closedAt) return { state }
    if (run.phase !== 'completed') throw new StudioError(ERROR_CODES.INVALID_COMMAND, '任务尚未完成。', undefined, 409)
    await taskRunner.closeSubmission({ sessionId, submissionId: run.reviewSubmissionId })
    return { state: repository.getState() }
  }

  return Object.freeze({
    dataRoot: root,
    reviewWorkerConfigured: Boolean(agentBridge?.configured),
    reviewWorkerMode: agentBridge?.mode ?? (agentBridge?.configured ? 'http-worker' : 'native'),
    confirmTask,
    repositoryFor,
    designFor,
    layoutFor,
    batchFor,
    deliveryFor,
    contentFor,
    designProgress,
    recordDesignFailure,
    bindDesignVisual,
    visualFor,
    acceptDesignProposal,
    openWorkspace,
    workspaceStatus,
    reloadWorkspace,
    applyWorkspaceCandidate,
    getState,
    executeAction,
    submitReview,
    prepareChat,
    acceptProposal,
    rejectProposal(sessionId, proposalId) { return updateProposal(sessionId, proposalId, 'reject') },
    returnProposal(sessionId, proposalId) { return updateProposal(sessionId, proposalId, 'return') },
    getContext,
    applyCommands,
    updateDispatch,
    handleNativeSessionEvent,
    retrySubmission,
    close: async () => { nativeClosing = true; await Promise.allSettled([...nativePending]); visualService?.dispose(); await taskRunner.close(); return close() },
  })
}
