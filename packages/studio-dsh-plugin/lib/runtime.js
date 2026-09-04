import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRepository } from '../vendor/apps/studio-local/repository.mjs'
import {
  acceptProposal as acceptCoreProposal,
  createProposalFromAgent,
  executeAction as executeCoreAction,
  markSubmissionDispatch,
  rejectProposal as rejectCoreProposal,
  retryReviewSubmission,
  returnProposalToAgent as returnCoreProposalToAgent,
  submitReviewRound,
} from '../vendor/packages/studio-core/index.mjs'
import { ERROR_CODES, StudioError } from '../vendor/packages/studio-contracts/index.mjs'
import { reviewSubmissionContext } from '../vendor/apps/studio-local/agent-context.mjs'

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

export function createStudioDshRuntime({ dataRoot = defaultDshDataRoot() } = {}) {
  const root = resolve(dataRoot)
  const repositories = new Map()

  async function repositoryFor(rawSessionId) {
    const sessionId = cleanSessionId(rawSessionId)
    let pending = repositories.get(sessionId)
    if (!pending) {
      pending = createRepository(join(root, 'sessions', sessionDirectoryName(sessionId)))
      repositories.set(sessionId, pending)
    }
    return pending
  }

  async function getState(sessionId) {
    return structuredClone((await repositoryFor(sessionId)).getState())
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
    await repository.transactOperational(state => {
      submitted = submitReviewRound(state, input)
      return submitted.state
    })
    return {
      state: structuredClone(repository.getState()),
      round: structuredClone(submitted.round),
      submission: structuredClone(submitted.submission),
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
    const state = await repository.transactContent(
      { baseRevision: proposal.baseRevision, source: 'agent', detail: { proposalId, submissionId: proposal.submissionId } },
      current => acceptCoreProposal(current, proposalId).state,
    )
    return { state, revision: structuredClone(state.revisions.at(-1)) }
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
    const repository = await repositoryFor(sessionId)
    let result
    await repository.transactOperational(state => {
      result = markSubmissionDispatch(state, submissionId, input)
      return result.state
    })
    return result.submission
  }

  async function retrySubmission(sessionId, submissionId) {
    const repository = await repositoryFor(sessionId)
    let result
    await repository.transactOperational(state => {
      result = retryReviewSubmission(state, submissionId)
      return result.state
    })
    const current = repository.getState()
    const round = current.reviewRounds.find(item => item.id === result.submission.reviewRoundId)
    return {
      state: current,
      submission: result.submission,
      dshPrompt: { kind: 'report_studio.review_submission', sessionId: cleanSessionId(sessionId), text: reviewPrompt(cleanSessionId(sessionId), current, round, result.submission) },
    }
  }

  return Object.freeze({
    dataRoot: root,
    repositoryFor,
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
  })
}
