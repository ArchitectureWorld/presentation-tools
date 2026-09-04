import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRepository } from '../vendor/apps/studio-local/repository.mjs'
import {
  acceptProposal as acceptCoreProposal,
  beginReviewDispatch,
  createProposalFromAgent,
  executeAction as executeCoreAction,
  markProposalStale,
  markSubmissionDispatch,
  recoverExpiredReviewDispatches,
  rejectProposal as rejectCoreProposal,
  retryReviewSubmission,
  returnProposalToAgent as returnCoreProposalToAgent,
  submitReviewRound,
  transitionReviewSubmission,
} from '../vendor/packages/studio-core/index.mjs'
import { ERROR_CODES, StudioError } from '../vendor/packages/studio-contracts/index.mjs'
import { reviewSubmissionContext } from '../vendor/apps/studio-local/agent-context.mjs'
import { createWorkspaceWatcher, resolveWorkspaceRoot } from '../vendor/apps/studio-local/workspace-live-link.mjs'

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

function reviewPrompt(sessionId, state, round, submission) {
  return [
    '[Report Studio v0.1.1 · DSH Native Review]',
    `DSH Session ID: ${sessionId}`,
    `Project ID: ${state.project.id}`,
    `Project title: ${state.project.title}`,
    `Current revision: ${state.project.currentRevision}`,
    `ReviewRound ID: ${round.id}`,
    `ReviewSubmission ID: ${submission.id}`,
    `Submission number: ${submission.number}`,
    `Base revision: ${submission.baseRevision}`,
    '',
    '处理要求：',
    '1. 必须先调用 studio_get_context 读取当前会话绑定的 Report Studio 项目。',
    `2. 根据本次批注完成修改建议后，调用 studio_apply_commands，并将 submissionId 固定为 ${submission.id}。`,
    '3. studio_apply_commands 只创建 Proposal，不会直接覆盖正式内容；用户会在 Report Studio 中确认。',
    '4. 不要假定所有批注能一次解决；只处理有充分依据的修改。',
    '5. studio_apply_commands 顶层对象只允许 submissionId、projectId、baseRevision、scopeKey、idempotencyKey、message、commands。',
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
    '如用户要求修改正式内容，而当前上下文没有可关联的 ReviewSubmission，请先说明需要用户在界面中添加批注并“提给Agent”；不要绕过 Proposal/Revision 网关直接声称已修改。',
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
} = {}) {
  const root = resolve(dataRoot)
  const repositories = new Map()
  const workspaceEntries = new Map()
  const sessionBindings = new Map()

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

  async function publishCandidate(entry) {
    const candidate = entry.candidate
    if (!candidate || candidate.fingerprint === entry.appliedFingerprint) {
      entry.candidate = null
      return statusFor(entry)
    }
    const repository = await entry.repository
    await repository.publishUpstreamSnapshot({
      snapshot: candidate.snapshot,
      fingerprint: candidate.fingerprint,
      workspaceRoot: candidate.workspaceRoot,
      sourceRevision: candidate.sourceRevision,
      sourceRevisions: candidate.sourceRevisions,
    })
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
            entry.status.status = 'upstream_update_available'
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

  async function applyWorkspaceCandidate(sessionId, _input = {}) {
    await openWorkspace(sessionId)
    const entry = workspaceEntries.get(sessionBindings.get(cleanSessionId(sessionId)))
    return publishCandidate(entry)
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

  async function getState(sessionId) {
    const repository = await repositoryFor(sessionId)
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
      begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: id })
      return begun.state
    })
    return {
      state: structuredClone(repository.getState()),
      round: structuredClone(submitted.round),
      submission: structuredClone(begun.submission),
      reviewRun: structuredClone(begun.reviewRun),
      dshPrompt: {
        kind: 'report_studio.review_submission',
        sessionId: id,
        text: reviewPrompt(id, submitted.state, submitted.round, submitted.submission),
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
    try {
      const state = await repository.transactContent(
        { baseRevision: proposal.baseRevision, source: 'agent', detail: { proposalId, submissionId: proposal.submissionId } },
        current => acceptCoreProposal(current, proposalId).state,
      )
      return { state, revision: structuredClone(state.revisions.at(-1)) }
    } catch (error) {
      if (error?.code !== ERROR_CODES.STALE_REVISION && error?.message !== 'stale_revision') throw error
      await repository.transactOperational(current => markProposalStale(current, proposalId).state)
      throw error
    }
  }

  async function updateProposal(sessionId, proposalId, action) {
    const repository = await repositoryFor(sessionId)
    let result
    const state = await repository.transactOperational(current => {
      result = action === 'reject' ? rejectCoreProposal(current, proposalId) : returnCoreProposalToAgent(current, proposalId)
      return result.state
    })
    return { state, proposal: result.proposal }
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
    let proposed
    let submission
    await repository.transactOperational(state => {
      submission = state.reviewSubmissions.find(item => item.id === submissionId)
      proposed = createProposalFromAgent(state, submissionId, structuredClone(input))
      return proposed.state
    })
    return {
      proposalId: proposed.proposal.id,
      submissionId,
      reviewRoundId: submission.reviewRoundId,
      baseRevision: submission.baseRevision,
      status: proposed.proposal.status,
      currentRevision: repository.getState().project.currentRevision,
    }
  }

  async function updateDispatch(sessionId, submissionId, input) {
    const id = cleanSessionId(sessionId)
    const repository = await repositoryFor(id)
    let result
    await repository.transactOperational(state => {
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
      result = recoverable.reviewSubmissions.find(item => item.id === submissionId).status === 'dispatch_failed'
        ? retryReviewSubmission(recoverable, submissionId, { sessionId: id })
        : beginReviewDispatch(recoverable, submissionId, { sessionId: id })
      return result.state
    })
    const current = repository.getState()
    const round = current.reviewRounds.find(item => item.id === result.submission.reviewRoundId)
    return {
      state: current,
      submission: result.submission,
      reviewRun: result.reviewRun,
      dshPrompt: { kind: 'report_studio.review_submission', sessionId: id, text: reviewPrompt(id, current, round, result.submission) },
    }
  }

  return Object.freeze({
    dataRoot: root,
    repositoryFor,
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
    retrySubmission,
    close,
  })
}
