import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepository } from './repository.mjs'
import { createReviewTaskRunner } from './review-task-runner.mjs'
import { createInitialState, executeAction, submitReviewRound, beginReviewDispatch } from '../../packages/studio-core/index.mjs'
import { createStudioId } from '../../packages/studio-contracts/index.mjs'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-review-task-'))
  const repository = await createRepository(dir)
  let state = createInitialState()
  ;({ state } = executeAction(state, { type: 'outline.add', parentId: null, title: '第一章' }))
  const nodeId = state.outline[0].id
  ;({ state } = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', target: { type: 'outline-node', id: nodeId, label: '第一章' }, instruction: '补充目标' }))
  const submitted = submitReviewRound(state, { scopeKey: 'outline:root' })
  const begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: 'parent-1' })
  await repository.update(() => begun.state)
  return { dir, repository, submission: begun.submission, reviewRun: begun.reviewRun, nodeId }
}

test('isolated review runner creates a Proposal and keeps task open until confirmation', async () => {
  const { dir, repository, submission, reviewRun, nodeId } = await setup()
  let received
  let closed = 0
  const runner = createReviewTaskRunner({
    getRepository: async () => repository,
    agentBridge: {
      configured: true,
      async submit(input) { received = input; return { submissionId: submission.id, projectId: submission.projectId, baseRevision: submission.baseRevision, scopeKey: submission.scopeKey, idempotencyKey: submission.idempotencyKey, sessionRef: 'worker-1', message: '等待人工确认', commands: [{ commandId: createStudioId('command'), type: 'outline.rename', nodeId, title: '第一章：目标', scopeKey: submission.scopeKey, baseRevision: submission.baseRevision, riskLevel: 'ordinary_reversible', sourceAnnotationIds: [submission.annotationSnapshots[0].annotationId] }] } },
      async close() { closed += 1 },
    },
  })
  try {
    const started = await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
    assert.equal(started.taskId, reviewRun.taskId)
    await runner.wait(started.taskId)
    const state = repository.getState()
    assert.equal(state.reviewRuns[0].phase, 'proposal_created')
    assert.equal(state.reviewRuns[0].closedAt, null)
    assert.equal(state.reviewRuns[0].workerSessionRef, 'worker-1')
    assert.equal(received.taskId, reviewRun.taskId)
    assert.equal(received.parentSessionId, 'parent-1')
    assert.equal('pages' in received.context, false)
    await runner.closeSubmission({ sessionId: 'parent-1', submissionId: submission.id })
    assert.equal(closed, 1)
    assert.ok(repository.getState().reviewRuns[0].closedAt)
  } finally {
    await runner.close()
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('isolated review runner marks bridge timeout as terminal task failure', async () => {
  const { dir, repository, submission, reviewRun } = await setup()
  const runner = createReviewTaskRunner({
    getRepository: async () => repository,
    agentBridge: { configured: true, async submit() { throw new Error('DSH Bridge 请求超时') } },
  })
  try {
    await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
    await runner.wait(reviewRun.taskId)
    const state = repository.getState()
    assert.equal(state.reviewSubmissions[0].status, 'dispatch_failed')
    assert.equal(state.reviewRuns[0].phase, 'timed_out')
    assert.ok(state.reviewRuns[0].closedAt)
  } finally {
    await runner.close()
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})
