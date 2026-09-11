import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptProposal,
  beginReviewDispatch,
  createProposalFromAgent,
  createInitialState,
  executeAction,
  markProposalStale,
  markSubmissionDispatch,
  recoverExpiredReviewDispatches,
  rejectProposal,
  submitReviewRound,
  transitionReviewSubmission,
} from './index.mjs'
import { createStudioId } from '../studio-contracts/index.mjs'

const SUBMISSION_ID = 'review_submission_01992a80-0000-7000-8000-000000000801'
const RUN_ID = 'review_run_01992a80-0000-7000-8000-000000000802'

function stateAt(status, runStatus = status) {
  const state = createInitialState()
  state.reviewSubmissions = [{
    id: SUBMISSION_ID,
    reviewSubmissionId: SUBMISSION_ID,
    status,
    dispatchAttempts: 1,
    idempotencyKey: `review:${SUBMISSION_ID}`,
  }]
  state.reviewRuns = [{
    id: RUN_ID,
    reviewRunId: RUN_ID,
    reviewSubmissionId: SUBMISSION_ID,
    sessionId: 'session-matrix',
    dispatchAttempt: 1,
    integrationState: runStatus,
    createdAt: '2026-09-04T00:00:00.000Z',
    deliveredAt: runStatus === 'dispatched' ? '2026-09-04T00:00:01.000Z' : null,
    resultProposalId: null,
    lastError: null,
  }]
  return state
}

const legalEdges = [
  ['pending_dispatch', 'dispatched'],
  ['pending_dispatch', 'dispatch_failed'],
  ['dispatch_failed', 'pending_dispatch'],
  ['dispatched', 'proposal_created'],
  ['proposal_created', 'accepted'],
  ['proposal_created', 'rejected'],
  ['proposal_created', 'stale'],
]

test('the complete legal ReviewSubmission transition matrix updates only the matching run', () => {
  for (const [from, to] of legalEdges) {
    const otherRun = { ...stateAt('accepted').reviewRuns[0], id: 'other', reviewRunId: 'other', reviewSubmissionId: 'other-submission' }
    const options = {
      reviewRunId: RUN_ID,
      at: '2026-09-04T00:00:02.000Z',
      ...(to === 'proposal_created' ? { resultProposalId: 'proposal_01992a80-0000-7000-8000-000000000803' } : {}),
      ...(to === 'dispatch_failed' ? { error: 'offline' } : {}),
    }
    const input = stateAt(from, from === 'dispatch_failed' ? 'dispatch_failed' : from)
    input.reviewRuns.push(otherRun)
    const result = transitionReviewSubmission(input, SUBMISSION_ID, to, options)
    assert.equal(result.submission.status, to, `${from} -> ${to}`)
    const run = result.state.reviewRuns.find(item => item.reviewRunId === RUN_ID)
    if (from === 'dispatch_failed' && to === 'pending_dispatch') assert.equal(run.integrationState, 'dispatch_failed')
    else assert.equal(run.integrationState, to)
    assert.deepEqual(result.state.reviewRuns.find(item => item.reviewRunId === 'other'), otherRun)
  }
})

test('all graph edges outside the declared matrix are rejected, including terminal regressions', () => {
  const states = ['pending_dispatch', 'dispatched', 'dispatch_failed', 'proposal_created', 'accepted', 'rejected', 'stale']
  const legal = new Set(legalEdges.map(edge => edge.join('->')))
  for (const from of states) for (const to of states) {
    if (legal.has(`${from}->${to}`) || (from === 'dispatched' && to === 'dispatched')) continue
    assert.throws(
      () => transitionReviewSubmission(stateAt(from), SUBMISSION_ID, to, { reviewRunId: RUN_ID }),
      error => error.code === 'invalid_submission_transition',
      `${from} must not transition to ${to}`,
    )
  }
})

test('duplicate dispatched report is idempotent and does not increment attempts or create a run', () => {
  const input = stateAt('dispatched')
  const result = transitionReviewSubmission(input, SUBMISSION_ID, 'dispatched', { reviewRunId: RUN_ID })
  assert.equal(result.idempotent, true)
  assert.equal(result.submission.dispatchAttempts, 1)
  assert.equal(result.state.reviewRuns.length, 1)
  assert.deepEqual(result.state, input)
})

test('beginning and retrying dispatch creates auditable runs for one immutable submission', () => {
  const initial = createInitialState()
  initial.reviewSubmissions = [{ id: SUBMISSION_ID, reviewSubmissionId: SUBMISSION_ID, status: 'pending_dispatch', dispatchAttempts: 0, idempotencyKey: `review:${SUBMISSION_ID}` }]
  const first = beginReviewDispatch(initial, SUBMISSION_ID, { sessionId: 'session-a', at: '2026-09-04T00:00:00.000Z', leaseMs: 30_000 })
  assert.equal(first.reviewRun.reviewSubmissionId, SUBMISSION_ID)
  assert.equal(first.reviewRun.dispatchAttempt, 1)
  assert.equal(first.reviewRun.integrationState, 'pending_dispatch')
  assert.equal(first.reviewRun.createdAt, '2026-09-04T00:00:00.000Z')
  assert.equal(first.reviewRun.deliveredAt, null)
  assert.equal(first.reviewRun.resultProposalId, null)
  assert.equal(first.reviewRun.lastError, null)
  const failed = transitionReviewSubmission(first.state, SUBMISSION_ID, 'dispatch_failed', { reviewRunId: first.reviewRun.reviewRunId, error: 'network down' })
  const pending = transitionReviewSubmission(failed.state, SUBMISSION_ID, 'pending_dispatch')
  const second = beginReviewDispatch(pending.state, SUBMISSION_ID, { sessionId: 'session-a', at: '2026-09-04T00:01:00.000Z' })
  assert.equal(second.submission.id, SUBMISSION_ID)
  assert.equal(second.submission.idempotencyKey, `review:${SUBMISSION_ID}`)
  assert.equal(second.submission.dispatchAttempts, 2)
  assert.deepEqual(second.state.reviewRuns.map(run => run.dispatchAttempt), [1, 2])
})

test('expired pending dispatch lease follows failure then recoverable retry without getting stuck', () => {
  const initial = createInitialState()
  initial.reviewSubmissions = [{ id: SUBMISSION_ID, reviewSubmissionId: SUBMISSION_ID, status: 'pending_dispatch', dispatchAttempts: 0, idempotencyKey: `review:${SUBMISSION_ID}` }]
  const begun = beginReviewDispatch(initial, SUBMISSION_ID, { sessionId: 'session-timeout', at: '2026-09-04T00:00:00.000Z', leaseMs: 1_000 })
  const recovered = recoverExpiredReviewDispatches(begun.state, { at: '2026-09-04T00:00:02.000Z' })
  assert.equal(recovered.state.reviewSubmissions[0].status, 'dispatch_failed')
  assert.equal(recovered.state.reviewRuns[0].integrationState, 'dispatch_failed')
  assert.match(recovered.state.reviewRuns[0].lastError, /超时/)
  const pending = transitionReviewSubmission(recovered.state, SUBMISSION_ID, 'pending_dispatch')
  assert.equal(pending.submission.status, 'pending_dispatch')
})

function dispatchedSubmission() {
  let state = createInitialState()
  ;({ state } = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', instruction: '修改项目名' }))
  const submitted = submitReviewRound(state, { scopeKey: 'outline:root' })
  const begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: 'session-linkage' })
  const dispatched = markSubmissionDispatch(begun.state, submitted.submission.id, {
    status: 'dispatched',
    reviewRunId: begun.reviewRun.reviewRunId,
    sessionId: 'session-linkage',
  })
  const input = {
    submissionId: submitted.submission.id,
    projectId: submitted.state.project.id,
    baseRevision: submitted.submission.baseRevision,
    scopeKey: submitted.submission.scopeKey,
    idempotencyKey: submitted.submission.idempotencyKey,
    message: '修改项目名',
    commands: [{
      commandId: createStudioId('command'),
      type: 'project.rename',
      projectId: submitted.state.project.id,
      title: '新项目名',
      scopeKey: submitted.submission.scopeKey,
      baseRevision: submitted.submission.baseRevision,
      riskLevel: 'ordinary_reversible',
      sourceAnnotationIds: [submitted.submission.annotationSnapshots[0].annotationId],
    }],
  }
  return { state: dispatched.state, submission: submitted.submission, reviewRun: begun.reviewRun, input }
}

test('Proposal creation is guarded by dispatched and links only its Submission and ReviewRun', () => {
  const setup = dispatchedSubmission()
  const pending = structuredClone(setup.state)
  pending.reviewSubmissions[0].status = 'pending_dispatch'
  pending.reviewRuns[0].integrationState = 'pending_dispatch'
  assert.throws(
    () => createProposalFromAgent(pending, setup.submission.id, setup.input),
    error => error.code === 'invalid_submission_transition',
  )

  const otherRun = { ...setup.state.reviewRuns[0], id: 'other-run', reviewRunId: 'other-run', reviewSubmissionId: 'other-submission' }
  setup.state.reviewRuns.push(otherRun)
  const proposed = createProposalFromAgent(setup.state, setup.submission.id, setup.input)
  assert.equal(proposed.state.reviewSubmissions[0].status, 'proposal_created')
  assert.equal(proposed.state.reviewRuns[0].integrationState, 'proposal_created')
  assert.equal(proposed.state.reviewRuns[0].resultProposalId, proposed.proposal.id)
  assert.deepEqual(proposed.state.reviewRuns[1], otherRun)
})

test('Proposal accept, reject and stale decisions update the matching ReviewRun monotonically', () => {
  for (const decision of ['accepted', 'rejected', 'stale']) {
    const setup = dispatchedSubmission()
    const proposed = createProposalFromAgent(setup.state, setup.submission.id, setup.input)
    const decided = decision === 'accepted'
      ? acceptProposal(proposed.state, proposed.proposal.id)
      : decision === 'rejected'
        ? rejectProposal(proposed.state, proposed.proposal.id)
        : markProposalStale(proposed.state, proposed.proposal.id)
    const submission = decided.state.reviewSubmissions.find(item => item.id === setup.submission.id)
    const run = decided.state.reviewRuns.find(item => item.reviewRunId === setup.reviewRun.reviewRunId)
    assert.equal(submission.status, decision)
    assert.equal(run.integrationState, decision)
    assert.equal(run.resultProposalId, proposed.proposal.id)
  }
})
