import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepository } from './repository.mjs'
import { createReviewTaskRunner } from './review-task-runner.mjs'
import { createInitialState, executeAction, submitReviewRound, beginReviewDispatch, retryReviewSubmission } from '../../packages/studio-core/index.mjs'
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

test('isolated review runner directly applies an ordinary review task and closes its worker', async () => {
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
    assert.equal(state.reviewRuns[0].workerSessionRef, 'worker-1')
    assert.equal(received.taskId, reviewRun.taskId)
    assert.equal(received.parentSessionId, 'parent-1')
    assert.equal('pages' in received.context, false)
    assert.equal(state.outline[0].title, '第一章：目标')
    assert.equal(state.proposals.length, 0)
    assert.equal(state.reviewRuns[0].phase, 'completed')
    assert.ok(state.reviewRuns[0].closedAt)
    assert.equal(closed, 1)
  } finally {
    await runner.close()
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('isolated review runner directly applies structural review commands', async () => {
  const { dir, repository, submission, reviewRun } = await setup()
  let closed = 0
  const runner = createReviewTaskRunner({
    getRepository: async () => repository,
    agentBridge: {
      configured: true,
      async submit() {
        return {
          submissionId: submission.id,
          projectId: submission.projectId,
          baseRevision: submission.baseRevision,
          scopeKey: submission.scopeKey,
          idempotencyKey: submission.idempotencyKey,
          sessionRef: 'worker-structural',
          message: '结构性候选等待确认',
          commands: [{
            commandId: createStudioId('command'),
            type: 'outline.add',
            nodeId: createStudioId('outlineNode'),
            parentId: null,
            title: '第二章',
            scopeKey: submission.scopeKey,
            baseRevision: submission.baseRevision,
            riskLevel: 'structural_review_required',
            sourceAnnotationIds: [submission.annotationSnapshots[0].annotationId],
          }],
        }
      },
      async close() {
        const current = repository.getState()
        assert.equal(current.project.currentRevision, submission.baseRevision + 1)
        assert.equal(current.reviewRuns[0].phase, 'completed')
        assert.ok(current.reviewRuns[0].finishedAt)
        assert.equal(current.reviewRuns[0].closedAt, null)
        closed += 1
      },
    },
  })
  try {
    await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
    await runner.wait(reviewRun.taskId)
    const state = repository.getState()
    assert.equal(state.outline.length, 2)
    assert.equal(state.proposals.length, 0)
    assert.equal(state.reviewRuns[0].phase, 'completed')
    assert.ok(state.reviewRuns[0].closedAt)
    assert.equal(state.reviewSubmissions[0].status, 'accepted')
    assert.equal(closed, 1)
  } finally {
    await runner.close()
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('ordinary review task applies even when no callback is provided', async () => {
  const { dir, repository, submission, reviewRun, nodeId } = await setup()
  const runner = createReviewTaskRunner({
    getRepository: async () => repository,
    agentBridge: {
      configured: true,
      async submit() {
        return {
          submissionId: submission.id, projectId: submission.projectId, baseRevision: submission.baseRevision,
          scopeKey: submission.scopeKey, idempotencyKey: submission.idempotencyKey, message: '等待人工应用',
          commands: [{ commandId: createStudioId('command'), type: 'outline.rename', nodeId, title: '第一章：人工应用', scopeKey: submission.scopeKey, baseRevision: submission.baseRevision, riskLevel: 'ordinary_reversible', sourceAnnotationIds: [submission.annotationSnapshots[0].annotationId] }],
        }
      },
    },
  })
  try {
    await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
    await runner.wait(reviewRun.taskId)
    const state = repository.getState()
    assert.equal(state.outline[0].title, '第一章：人工应用')
    assert.equal(state.proposals.length, 0)
    assert.equal(state.reviewRuns[0].phase, 'completed')
    assert.ok(state.reviewRuns[0].closedAt)
  } finally {
    await runner.close()
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('direct review task reports a single completed result without Proposal acceptance', async () => {
  const { dir, repository, submission, reviewRun, nodeId } = await setup()
  const runner = createReviewTaskRunner({
    getRepository: async () => repository,
    agentBridge: {
      configured: true,
      async submit() {
        return {
          submissionId: submission.id, projectId: submission.projectId, baseRevision: submission.baseRevision,
          scopeKey: submission.scopeKey, idempotencyKey: submission.idempotencyKey, message: '准备自动应用',
          commands: [{ commandId: createStudioId('command'), type: 'outline.rename', nodeId, title: '第一章：不应落盘', scopeKey: submission.scopeKey, baseRevision: submission.baseRevision, riskLevel: 'ordinary_reversible', sourceAnnotationIds: [submission.annotationSnapshots[0].annotationId] }],
        }
      },
    },
  })
  try {
    await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
    const outcome = await runner.wait(reviewRun.taskId)
    const state = repository.getState()
    assert.equal(outcome.error, undefined)
    assert.equal(state.outline[0].title, '第一章：不应落盘')
    assert.equal(state.proposals.length, 0)
    assert.equal(state.reviewSubmissions[0].status, 'accepted')
    assert.equal(state.reviewRuns[0].phase, 'completed')
    assert.match(state.reviewRuns[0].summary, /准备自动应用/)
    assert.ok(state.reviewRuns[0].closedAt)
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
    assert.equal(state.reviewRuns[0].closedAt, null)
    assert.ok(state.reviewRuns[0].finishedAt)
  } finally {
    await runner.close()
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('failed tasks retain worker audit and retries get a new task and worker reference', async () => {
  const { dir, repository, submission, reviewRun } = await setup()
  let closes = 0
  const tasks = []
  const runner = createReviewTaskRunner({
    getRepository: async () => repository,
    agentBridge: { configured: true,
      async submit(input) { tasks.push(input.taskId); throw new Error('Schema failure') },
      async close() { closes++ },
    },
  })
  try {
    await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
    await runner.wait(reviewRun.taskId)
    assert.equal(closes, 0)
    const failed = repository.getState().reviewRuns[0]
    assert.equal(failed.phase, 'failed')
    assert.equal(failed.closedAt, null)
    assert.equal(failed.workerSessionRef, failed.taskId)
    await assert.rejects(runner.closeSubmission({ sessionId: 'parent-1', submissionId: submission.id }), /尚未|确认/)
    let retry
    await repository.transactOperational(state => { retry = retryReviewSubmission(state, submission.id, { sessionId: 'parent-1' }); return retry.state })
    await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: retry.reviewRun.reviewRunId })
    await runner.wait(retry.reviewRun.taskId)
    const runs = repository.getState().reviewRuns
    assert.equal(runs.length, 2)
    assert.notEqual(tasks[0], tasks[1])
    assert.notEqual(runs[0].workerSessionRef, runs[1].workerSessionRef)
    assert.equal(closes, 0)
  } finally { await runner.close(); await repository.close(); await rm(dir, { recursive: true, force: true }) }
})

test('successful apply retains completed audit when worker close fails and allows close retry', async () => {
  const { dir, repository, submission, reviewRun } = await setup()
  let attempts = 0
  const runner = createReviewTaskRunner({ getRepository: async () => repository, agentBridge: {
    configured: true,
    async submit() { return { message: '无需修改', commands: [], sessionRef: reviewRun.taskId } },
    async close() { if (++attempts === 1) throw new Error('close unavailable') },
  } })
  try {
    await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
    await runner.wait(reviewRun.taskId)
    let run = repository.getState().reviewRuns[0]
    assert.equal(run.phase, 'completed')
    assert.equal(run.closedAt, null)
    assert.match(run.summary, /释放失败.*重试/)
    await runner.closeSubmission({ sessionId: 'parent-1', submissionId: submission.id })
    run = repository.getState().reviewRuns[0]
    assert.ok(run.closedAt)
    assert.equal(attempts, 2)
  } finally { await runner.close(); await repository.close(); await rm(dir, { recursive: true, force: true }) }
})

test('CAS conflict keeps failed task retryable without closing worker or changing content', async () => {
  const { dir, repository, submission, reviewRun, nodeId } = await setup()
  let closes = 0
  const runner = createReviewTaskRunner({ getRepository: async () => repository, agentBridge: {
    configured: true,
    async submit() {
      await repository.transactContent({ baseRevision: submission.baseRevision, source: 'user' }, state => executeAction(state, { type: 'outline.rename', nodeId, title: 'Concurrent user edit' }).state)
      return { submissionId: submission.id, projectId: submission.projectId, baseRevision: submission.baseRevision, scopeKey: submission.scopeKey,
        message: 'Worker edit', commands: [{ commandId: createStudioId('command'), type: 'outline.rename', nodeId, title: 'Worker edit', scopeKey: submission.scopeKey, baseRevision: submission.baseRevision, riskLevel: 'ordinary_reversible', sourceAnnotationIds: [submission.annotationSnapshots[0].annotationId] }] }
    },
    async close() { closes++ },
  } })
  try {
    await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
    const outcome = await runner.wait(reviewRun.taskId)
    assert.ok(outcome.error)
    const state = repository.getState()
    assert.equal(state.outline[0].title, 'Concurrent user edit')
    assert.equal(state.reviewRuns[0].phase, 'conflict')
    assert.equal(state.reviewRuns[0].closedAt, null)
    assert.equal(state.reviewSubmissions[0].status, 'conflict')
    assert.equal(state.reviewRuns[0].integrationState, 'conflict')
    assert.equal(closes, 0)
  } finally { await runner.close(); await repository.close(); await rm(dir, { recursive: true, force: true }) }
})
