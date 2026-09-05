import {
  createProposalFromAgent,
  markSubmissionDispatch,
  updateReviewTask,
} from '../../packages/studio-core/index.mjs'
import { ERROR_CODES, StudioError } from '../../packages/studio-contracts/index.mjs'
import { reviewSubmissionContext } from './agent-context.mjs'

const timeoutError = error => /超时|timeout|timed out/i.test(String(error?.message || error))

export function createReviewTaskRunner({ getRepository, agentBridge, leaseMs = 120_000 } = {}) {
  const active = new Map()
  let stopped = false

  async function update(repository, reviewRunId, patch) {
    return repository.transactOperational(state => updateReviewTask(state, reviewRunId, patch).state)
  }

  async function run({ sessionId, submissionId, reviewRunId }) {
    const repository = await getRepository(sessionId)
    const initial = repository.getState()
    const initialRun = (initial.reviewRuns ?? []).find(item => item.reviewRunId === reviewRunId)
    const initialSubmission = initial.reviewSubmissions.find(item => item.id === submissionId)
    if (!initialRun || !initialSubmission) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'ReviewTask 引用不存在。', { submissionId, reviewRunId }, 404)
    try {
      await update(repository, reviewRunId, { phase: 'reading_context', at: new Date().toISOString() })
      const snapshot = await repository.getSnapshotAt(initialSubmission.baseRevision)
      const context = reviewSubmissionContext(snapshot, initialSubmission)
      await update(repository, reviewRunId, { phase: 'processing', at: new Date().toISOString() })
      if (!agentBridge?.configured || typeof agentBridge.submit !== 'function') throw new Error('独立任务执行器未配置。')
      let timeoutId
      const timeout = new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('独立批注任务请求超时')), leaseMs) })
      let result
      try {
        result = await Promise.race([agentBridge.submit({
          taskId: initialRun.taskId,
          parentSessionId: initialRun.parentSessionId || sessionId,
          submission: initialSubmission,
          context,
          leaseMs,
        }), timeout])
      } finally {
        clearTimeout(timeoutId)
      }
      await update(repository, reviewRunId, {
        workerSessionRef: result.sessionRef ?? null,
        summary: result.message,
        at: new Date().toISOString(),
      })
      let proposal = null
      await repository.transactOperational(state => {
        let next = markSubmissionDispatch(state, submissionId, {
          status: 'dispatched',
          reviewRunId,
          sessionId: result.sessionRef ?? sessionId,
        }).state
        const current = next.reviewSubmissions.find(item => item.id === submissionId)
        if (result.commands?.length) {
          const proposed = createProposalFromAgent(next, submissionId, {
            submissionId: result.submissionId,
            projectId: result.projectId,
            baseRevision: result.baseRevision,
            scopeKey: result.scopeKey,
            idempotencyKey: result.idempotencyKey ?? current.idempotencyKey,
            message: result.message,
            commands: result.commands,
          })
          next = proposed.state
          proposal = proposed.proposal
        } else {
          current.agentMessage = result.message
        }
        return next
      })
      await update(repository, reviewRunId, {
        phase: 'proposal_created',
        summary: result.message,
        at: new Date().toISOString(),
      })
      return { proposal, result }
    } catch (error) {
      const message = error?.message || '独立任务执行失败。'
      await repository.transactOperational(state => {
        const current = state.reviewSubmissions.find(item => item.id === submissionId)
        if (!current || current.status !== 'pending_dispatch') return state
        return markSubmissionDispatch(state, submissionId, {
          status: 'dispatch_failed',
          error: message,
          reviewRunId,
          sessionId,
        }).state
      }).catch(() => undefined)
      await update(repository, reviewRunId, {
        phase: timeoutError(error) ? 'timed_out' : 'failed',
        summary: message,
        at: new Date().toISOString(),
      }).catch(() => undefined)
      return { error }
    }
  }

  async function start({ sessionId, submissionId, reviewRunId }) {
    if (stopped) throw new Error('ReviewTaskRunner 已关闭。')
    const repository = await getRepository(sessionId)
    const state = repository.getState()
    const runRecord = (state.reviewRuns ?? []).find(item => item.reviewRunId === reviewRunId && item.reviewSubmissionId === submissionId)
    if (!runRecord) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到 ReviewTask。', { submissionId, reviewRunId }, 404)
    const existing = active.get(runRecord.taskId)
    if (existing) return runRecord
    const promise = run({ sessionId, submissionId, reviewRunId })
    active.set(runRecord.taskId, promise)
    void promise.finally(() => {
      active.delete(runRecord.taskId)
    }).catch(() => undefined)
    return runRecord
  }

  async function wait(taskId) {
    return active.get(taskId) ?? null
  }

  async function closeSubmission({ sessionId, submissionId }) {
    const repository = await getRepository(sessionId)
    const state = repository.getState()
    const runs = (state.reviewRuns ?? []).filter(item => item.reviewSubmissionId === submissionId && item.workerSessionRef)
    for (const runRecord of runs) {
      if (typeof agentBridge?.close === 'function') {
        await agentBridge.close({ taskId: runRecord.taskId, workerSessionRef: runRecord.workerSessionRef, parentSessionId: runRecord.parentSessionId }).catch(() => undefined)
      }
      if (!runRecord.closedAt) await update(repository, runRecord.reviewRunId, { phase: 'completed', summary: runRecord.summary || '本轮批注已确认', at: new Date().toISOString() })
    }
    return repository.getState()
  }

  async function close() {
    stopped = true
    active.clear()
  }

  return Object.freeze({ start, wait, closeSubmission, close })
}
