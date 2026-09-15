import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState, executeAction, submitReviewRound } from '../studio-core/index.mjs'
import { createStudioId } from '../studio-contracts/index.mjs'
import { reviewSubmissionContext } from '../../apps/studio-local/agent-context.mjs'
import { createDshReviewWorker } from './lib/isolated-worker.js'

function fixture() {
  let { state } = executeAction(createInitialState(), {
    type: 'annotation.add',
    scopeKey: 'outline:root',
    instruction: '检查当前模型解析',
  })
  const { submission } = submitReviewRound(state, { scopeKey: 'outline:root' })
  return {
    taskId: createStudioId('reviewTask'),
    parentSessionId: 'parent-session',
    submission,
    context: reviewSubmissionContext(state, submission),
  }
}

function llmFor(input, requests, validations) {
  let call = 0
  return {
    async resolveModelInfo(provider, model, signal) {
      validations.push({ provider, model, signal })
      return { provider, id: model, name: model }
    },
    async *stream(options) {
      requests.push(options)
      call += 1
      const name = call === 1 ? 'studio_get_context' : 'studio_apply_commands'
      const args = name === 'studio_get_context'
        ? { submissionId: input.submission.id }
        : {
            submissionId: input.submission.id,
            projectId: input.submission.projectId,
            baseRevision: input.submission.baseRevision,
            scopeKey: input.submission.scopeKey,
            message: '无须修改',
            commands: [],
          }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: `call-${call}`, name, arguments: JSON.stringify(args) },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    },
  }
}

function hostContext({ input, nextSelection, defaultSelection, requests, validations, live = true }) {
  const session = { id: input.parentSessionId }
  let resolveAgentCalls = 0
  const ctx = {
    sessions: { get: id => live && id === input.parentSessionId ? session : undefined },
    sessionController: {
      async resolveAgent(id) {
        resolveAgentCalls += 1
        assert.equal(id, input.parentSessionId)
        return { agent: { id, session } }
      },
    },
    sessionProjections: {
      snapshot(value) {
        assert.equal(value, session)
        return { values: { modelSelection: nextSelection ? { next: nextSelection } : undefined } }
      },
    },
    agentDefaultModel: { currentSelection: () => defaultSelection },
    llm: llmFor(input, requests, validations),
  }
  return { ctx, get resolveAgentCalls() { return resolveAgentCalls } }
}

test('DSH 0.1.5 worker inherits the Session Controller projection without apiProxy', async () => {
  const input = fixture()
  const requests = []
  const validations = []
  const nextSelection = { provider: 'projection-provider', model: 'projection-model', reasoningEffort: 'high' }
  const host = hostContext({
    input,
    nextSelection,
    defaultSelection: { provider: 'default-provider', model: 'default-model' },
    requests,
    validations,
  })
  const worker = createDshReviewWorker(host.ctx)
  const result = await worker.submit(input)

  assert.equal(result.status, undefined)
  assert.equal(host.resolveAgentCalls, 0, 'live parent Session must not be resumed')
  assert.equal(validations.length, 1)
  assert.deepEqual(validations[0].provider, 'projection-provider')
  assert.deepEqual(validations[0].model, 'projection-model')
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.provider, 'projection-provider')
    assert.equal(request.model, 'projection-model')
    assert.equal(request.reasoningEffort, 'high')
  }
  await worker.dispose()
})

test('DSH 0.1.5 worker resumes a cold parent and falls back to agentDefaultModel', async () => {
  const input = fixture()
  const requests = []
  const validations = []
  const defaultSelection = { provider: 'default-provider', model: 'default-model' }
  const host = hostContext({ input, nextSelection: null, defaultSelection, requests, validations, live: false })
  const worker = createDshReviewWorker(host.ctx)
  await worker.submit(input)

  assert.equal(host.resolveAgentCalls, 1)
  assert.deepEqual(validations.map(({ provider, model }) => ({ provider, model })), [defaultSelection])
  assert.ok(requests.every(request => request.provider === defaultSelection.provider && request.model === defaultSelection.model))
  await worker.dispose()
})
