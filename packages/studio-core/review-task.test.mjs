import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState, executeAction, submitReviewRound, beginReviewDispatch, updateReviewTask, retryReviewSubmission } from './index.mjs'

function submissionState() {
  let state = createInitialState()
  ;({ state } = executeAction(state, {
    type: 'annotation.add',
    scopeKey: 'outline:root',
    target: { type: 'outline-document', id: 'outline:root', label: '整份大纲' },
    instruction: '补充目标',
  }))
  return submitReviewRound(state, { scopeKey: 'outline:root' })
}

test('beginReviewDispatch creates an isolated review task record', () => {
  const submitted = submissionState()
  const begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: 'parent-session' })
  assert.match(begun.reviewRun.taskId, /^review_task_/)
  assert.equal(begun.reviewRun.parentSessionId, 'parent-session')
  assert.equal(begun.reviewRun.workerSessionRef, null)
  assert.equal(begun.reviewRun.phase, 'queued')
  assert.equal(begun.reviewRun.closedAt, null)
})

test('review task updates expose phase, worker reference, summary, and terminal time', () => {
  const submitted = submissionState()
  const begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: 'parent-session' })
  const running = updateReviewTask(begun.state, begun.reviewRun.reviewRunId, {
    phase: 'processing',
    workerSessionRef: 'worker-1',
  })
  assert.equal(running.reviewRun.phase, 'processing')
  assert.equal(running.reviewRun.workerSessionRef, 'worker-1')
  const proposal = updateReviewTask(running.state, begun.reviewRun.reviewRunId, { phase: 'proposal_created', summary: '等待确认' })
  assert.equal(proposal.reviewRun.closedAt, null)
  const closed = updateReviewTask(running.state, begun.reviewRun.reviewRunId, {
    phase: 'completed',
    summary: '已确认修改建议',
    closedAt: '2026-09-05T00:00:00.000Z',
  })
  assert.equal(closed.reviewRun.summary, '已确认修改建议')
  assert.equal(closed.reviewRun.closedAt, '2026-09-05T00:00:00.000Z')
})

test('retrying a failed submission creates a new isolated task id', () => {
  const submitted = submissionState()
  const begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: 'parent-session' })
  const failed = updateReviewTask(begun.state, begun.reviewRun.reviewRunId, { phase: 'failed', closedAt: '2026-09-05T00:00:00.000Z' })
  const marked = { ...failed, state: { ...failed.state } }
  marked.state.reviewSubmissions[0].status = 'dispatch_failed'
  marked.state.reviewRuns[0].integrationState = 'dispatch_failed'
  const retried = retryReviewSubmission(marked.state, submitted.submission.id, { sessionId: 'parent-session' })
  assert.notEqual(retried.reviewRun.taskId, begun.reviewRun.taskId)
  assert.equal(retried.reviewRun.phase, 'queued')
  assert.equal(retried.reviewRun.dispatchAttempt, 2)
})
