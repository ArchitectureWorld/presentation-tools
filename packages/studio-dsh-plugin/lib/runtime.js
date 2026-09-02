import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRepository } from '../../../apps/studio-local/repository.mjs'
import {
  acceptProposal as acceptCoreProposal,
  createProposalFromAgent,
  executeAction as executeCoreAction,
  submitReviewRound,
} from '../../studio-core/index.mjs'

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
    '[Report Studio v0.1.0 · DSH Native Review]',
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
    '[Report Studio v0.1.0 · DSH Native Chat]',
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
    const result = executeCoreAction(repository.getState(), action)
    await repository.replace(result.state)
    return structuredClone(repository.getState())
  }

  async function submitReview(sessionId, input) {
    const id = cleanSessionId(sessionId)
    const repository = await repositoryFor(id)
    const submitted = submitReviewRound(repository.getState(), input)
    await repository.replace(submitted.state)
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
    const result = acceptCoreProposal(repository.getState(), proposalId)
    await repository.replace(result.state)
    return { state: structuredClone(repository.getState()), revision: structuredClone(result.revision) }
  }

  async function getContext(sessionId) {
    const id = cleanSessionId(sessionId)
    const state = await getState(id)
    const latestSubmission = state.reviewSubmissions.at(-1) ?? null
    return {
      contractVersion: 'report-studio.v0.1.0',
      sessionId: id,
      project: state.project,
      ui: state.ui,
      outline: state.outline,
      pages: state.pages,
      annotations: state.annotations,
      reviewRounds: state.reviewRounds,
      reviewSubmissions: state.reviewSubmissions,
      proposals: state.proposals,
      latestSubmissionId: latestSubmission?.id ?? null,
      writableCommands: [
        'project.rename',
        'outline.add',
        'outline.rename',
        'outline.move',
        'outline.delete',
        'draft.ensurePage',
        'draft.update',
      ],
    }
  }

  async function applyCommands(sessionId, input) {
    const id = cleanSessionId(sessionId)
    const repository = await repositoryFor(id)
    const state = repository.getState()
    const submissionId = String(input?.submissionId ?? '').trim()
    if (!submissionId) throw new Error('submissionId 必填；请使用 ReviewSubmission 提示中的稳定 ID。')
    const submission = state.reviewSubmissions.find(item => item.id === submissionId)
    if (!submission) throw new Error(`ReviewSubmission '${submissionId}' 不存在于当前 DSH Session。`)
    const message = String(input?.message ?? '').trim()
    if (!message) throw new Error('message 必填。')
    if (!Array.isArray(input?.commands) || input.commands.length === 0) throw new Error('commands 必须至少包含一条结构化修改命令。')
    const proposed = createProposalFromAgent(state, submissionId, {
      message,
      commands: structuredClone(input.commands),
      sessionRef: id,
    })
    await repository.replace(proposed.state)
    return {
      proposalId: proposed.proposal.id,
      submissionId,
      reviewRoundId: submission.reviewRoundId,
      baseRevision: submission.baseRevision,
      status: proposed.proposal.status,
      currentRevision: repository.getState().project.currentRevision,
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
    getContext,
    applyCommands,
  })
}
