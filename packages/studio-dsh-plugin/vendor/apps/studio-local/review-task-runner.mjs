import {
  applyCommandsFromAgent,
  completeReviewWithoutChanges,
  markReviewApplicationFailure,
  markSubmissionDispatch,
  updateReviewTask,
} from '../../packages/studio-core/index.mjs'
import { ERROR_CODES, StudioError } from '../../packages/studio-contracts/index.mjs'
import { reviewSubmissionContext } from './agent-context.mjs'

const timeoutError = error => /超时|timeout|timed out/i.test(String(error?.message || error))

export function createReviewTaskRunner({ getRepository, agentBridge, leaseMs = 120_000, applyProposal = null } = {}) {
  const active = new Map()
  const controls = new Map()
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
    const controller = new AbortController()
    controls.set(initialRun.taskId, controller)
    try {
      if (stopped) throw new Error('Review worker stopped')
      await update(repository, reviewRunId, { phase: 'reading_context', workerSessionRef: initialRun.taskId, at: new Date().toISOString() })
      const snapshot = await repository.getSnapshotAt(initialSubmission.baseRevision)
      const context = reviewSubmissionContext(snapshot, initialSubmission)
      await update(repository, reviewRunId, { phase: 'processing', at: new Date().toISOString() })
      if (!agentBridge?.configured || typeof agentBridge.submit !== 'function') throw new Error('独立任务执行器未配置。')
      let timeoutId
      const timeout = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
        timeoutId = setTimeout(() => controller.abort(new Error('独立批注任务请求超时')), leaseMs)
      })
      let result
      try {
        result = await Promise.race([agentBridge.submit({
          taskId: initialRun.taskId,
          parentSessionId: initialRun.parentSessionId || sessionId,
          submission: initialSubmission,
          context,
          leaseMs,
          signal: controller.signal,
        }), timeout])
      } finally {
        clearTimeout(timeoutId)
      }
      await update(repository, reviewRunId, {
        workerSessionRef: result.sessionRef ?? initialRun.taskId,
        summary: result.message,
        at: new Date().toISOString(),
      })
      let applied = null
      const dispatchedState = state => {
        const activeSubmission = state.reviewSubmissions.find(item => item.id === submissionId)
        if (stopped || activeSubmission?.activeReviewRunId !== reviewRunId || activeSubmission.status !== 'pending_dispatch') throw new Error('Review task was superseded')
        let next = markSubmissionDispatch(state, submissionId, {
          status: 'dispatched',
          reviewRunId,
          sessionId: result.sessionRef ?? sessionId,
        }).state
        const current = next.reviewSubmissions.find(item => item.id === submissionId)
        if (!result.commands?.length) current.agentMessage = result.message
        return next
      }
      if (result.commands?.length) {
      await repository.transactContent(
          { baseRevision: result.baseRevision, source: 'agent', detail: { submissionId, taskId: initialRun.taskId, summary: result.message } },
          current => {
            applied = applyCommandsFromAgent(dispatchedState(current), submissionId, {
              submissionId: result.submissionId,
              projectId: result.projectId,
              baseRevision: result.baseRevision,
              scopeKey: result.scopeKey,
              idempotencyKey: result.idempotencyKey ?? current.reviewSubmissions.find(item => item.id === submissionId)?.idempotencyKey,
              message: result.message,
              commands: result.commands,
              ...(result.annotationResults ? { annotationResults: result.annotationResults } : {}),
            })
            // Content completion is durable before executor release is attempted.
            for (const run of applied.state.reviewRuns ?? []) {
              if (run.reviewSubmissionId === submissionId && !current.reviewRuns.find(item => item.reviewRunId === run.reviewRunId)?.closedAt) run.closedAt = null
            }
            return applied.state
          },
        )
      } else {
        await repository.transactOperational(state => {
          state = dispatchedState(state)
          const current = state.reviewSubmissions.find(item => item.id === submissionId)
          if (!current || current.status !== 'dispatched') return state
          return completeReviewWithoutChanges(state, submissionId, result.message).state
        })
      }
      await update(repository, reviewRunId, {
        phase: applied?.completionStatus ?? 'no_changes',
        summary: applied?.summary || result.message,
        closedAt: null,
        at: new Date().toISOString(),
      })
      await closeSubmission({ sessionId, submissionId })
      return { proposal: null, result, applied }
    } catch (error) {
      controller.abort(error)
      const message = error?.message || '独立任务执行失败。'
      await repository.transactOperational(state => {
        const current = state.reviewSubmissions.find(item => item.id === submissionId)
        if (!current || current.activeReviewRunId !== reviewRunId) return state
        return markReviewApplicationFailure(state, submissionId, { reviewRunId, error }).state
      }).catch(() => undefined)
      await update(repository, reviewRunId, {
        phase: repository.getState().reviewSubmissions.find(row => row.id === submissionId)?.status === 'conflict' ? 'conflict' : timeoutError(error) ? 'timed_out' : 'failed',
        summary: message,
        closedAt: null,
        at: new Date().toISOString(),
      }).catch(() => undefined)
      return { error }
    } finally {
      controls.delete(initialRun.taskId)
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
    const submission = state.reviewSubmissions.find(item => item.id === submissionId)
    if (!submission || !['accepted', 'rejected', 'stale', 'no_changes', 'partially_completed'].includes(submission.status)) {
      throw new StudioError(ERROR_CODES.INVALID_COMMAND, '本轮尚未完成或确认结束，不能释放执行器。', undefined, 409)
    }
    const completedIds = new Set([submissionId])
    for (const proposal of state.proposals) {
      if (proposal.status === 'returned_to_agent' && proposal.reviewRoundId === submission?.reviewRoundId) completedIds.add(proposal.submissionId)
    }
    const runs = (state.reviewRuns ?? []).filter(item => completedIds.has(item.reviewSubmissionId) && item.taskId)
    for (const runRecord of runs) {
      try {
        if (typeof agentBridge?.close === 'function') {
          await agentBridge.close({ taskId: runRecord.taskId, workerSessionRef: runRecord.workerSessionRef, parentSessionId: runRecord.parentSessionId })
        }
      } catch (error) {
        await update(repository, runRecord.reviewRunId, {
          phase: 'completed',
          summary: `${runRecord.summary || '本轮已确认'}；执行器释放失败，请重试结束任务：${error.message}`,
          closedAt: null,
          at: new Date().toISOString(),
        })
        continue
      }
      if (!runRecord.closedAt) await update(repository, runRecord.reviewRunId, { phase: 'completed', summary: runRecord.summary || '本轮批注已确认，任务已结束', closedAt: new Date().toISOString(), at: new Date().toISOString() })
    }
    return repository.getState()
  }

  async function close() {
    stopped = true
    for (const controller of controls.values()) controller.abort(new Error('Review worker stopped'))
    await Promise.allSettled([...active.values()])
    await agentBridge?.dispose?.()
    active.clear()
  }

  return Object.freeze({ start, wait, closeSubmission, close })
}
