import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState, executeAction, submitReviewRound } from '../studio-core/index.mjs'
import { createStudioId } from '../studio-contracts/index.mjs'
import { reviewSubmissionContext } from '../../apps/studio-local/agent-context.mjs'

const isolatedWorkerModule = await import('./lib/isolated-worker.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})

function createWorker(options) {
  assert.equal(
    typeof isolatedWorkerModule.createIsolatedReviewWorker,
    'function',
    'local isolated worker must exist',
  )
  return isolatedWorkerModule.createIsolatedReviewWorker(options)
}

function fixture() {
  let { state } = executeAction(createInitialState(), {
    type: 'outline.add',
    parentId: null,
    title: 'Before',
  })
  ;({ state } = executeAction(state, {
    type: 'annotation.add',
    scopeKey: 'outline:root',
    target: { type: 'outline-node', id: state.outline[0].id },
    instruction: 'Rename to After',
  }))
  const { submission } = submitReviewRound(state, { scopeKey: 'outline:root' })
  return {
    taskId: createStudioId('reviewTask'),
    parentSessionId: 'parent',
    submission,
    context: reviewSubmissionContext(state, submission),
  }
}

function commandResult(input) {
  const submission = input.submission
  return {
    submissionId: submission.id,
    projectId: submission.projectId,
    baseRevision: submission.baseRevision,
    scopeKey: submission.scopeKey,
    message: 'Updated title',
    commands: [{
      commandId: createStudioId('command'),
      type: 'outline.rename',
      nodeId: input.context.outline[0].id,
      title: 'After',
      scopeKey: submission.scopeKey,
      baseRevision: submission.baseRevision,
      riskLevel: 'ordinary_reversible',
      sourceAnnotationIds: [input.context.annotations[0].annotationId],
    }],
  }
}

function llmFor(input, inspect = () => {}, transformResult = value => value) {
  let call = 0
  return {
    async *stream(options) {
      inspect(options)
      const name = call++ === 0 ? 'studio_get_context' : 'studio_apply_commands'
      const args = name === 'studio_get_context'
        ? { submissionId: input.submission.id }
        : transformResult(commandResult(input))
      yield {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: `call-${call}`,
          name,
          arguments: JSON.stringify(args),
        },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    },
  }
}

const resolveModel = async () => ({
  provider: 'test-provider',
  model: 'selected-model',
  reasoningEffort: 'medium',
  messages: ['PRIVATE_HISTORY'],
  apiKey: 'PRIVATE_KEY',
})

test('worker inherits only selected model scalars and exposes only scoped Studio tools', async () => {
  const input = fixture()
  const requests = []
  const worker = createWorker({
    llm: llmFor(input, options => requests.push(options)),
    resolveModel,
  })

  const result = await worker.submit(input)

  assert.equal(result.commands[0].title, 'After')
  assert.equal(worker.status(input.taskId).phase, 'awaiting_confirmation')
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.sessionId, input.taskId)
    assert.equal(request.provider, 'test-provider')
    assert.equal(request.model, 'selected-model')
    assert.equal(request.reasoningEffort, 'medium')
    assert.deepEqual(request.tools.map(tool => tool.name), [
      'studio_get_context',
      'studio_apply_commands',
    ])
    assert.doesNotMatch(JSON.stringify(request), /PRIVATE_HISTORY|PRIVATE_KEY/)
  }
  assert.equal(requests[0].messages.length, 1)
  await worker.close({ taskId: input.taskId, parentSessionId: 'parent' })
  assert.equal(worker.status(input.taskId), null)
})

test('worker rejects unauthorized tools and applying before a prior context turn', async () => {
  for (const name of ['write_file', 'studio_apply_commands']) {
    const input = fixture()
    const worker = createWorker({
      resolveModel,
      llm: {
        async *stream() {
          yield {
            type: 'block-end',
            index: 0,
            block: {
              type: 'tool-call',
              id: 'bad-call',
              name,
              arguments: JSON.stringify(commandResult(input)),
            },
          }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        },
      },
    })

    await assert.rejects(worker.submit(input), /tool|context/i)
    assert.equal(worker.status(input.taskId).phase, 'failed')
  }
})

test('worker rejects an output envelope belonging to another submission', async () => {
  const input = fixture()
  const worker = createWorker({
    resolveModel,
    llm: llmFor(input, () => {}, result => ({
      ...result,
      submissionId: 'reviewSubmission_foreign',
    })),
  })

  await assert.rejects(worker.submit(input), /submission|envelope|task|foreign|identity/i)
  assert.equal(worker.status(input.taskId).phase, 'failed')
})

test('worker feeds ChangeSet schema errors back to the model and accepts its corrected retry', async () => {
  const input = fixture()
  let call = 0
  const requests = []
  const worker = createWorker({
    resolveModel,
    llm: {
      async *stream(options) {
        requests.push(options)
        call += 1
        const name = call === 1 ? 'studio_get_context' : 'studio_apply_commands'
        const result = commandResult(input)
        if (call === 2) delete result.commands[0].riskLevel
        const args = name === 'studio_get_context' ? { submissionId: input.submission.id } : result
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'tool-call', id: `call-${call}`, name, arguments: JSON.stringify(args) },
        }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      },
    },
  })

  const result = await worker.submit(input)

  assert.equal(result.commands[0].title, 'After')
  assert.equal(requests.length, 3)
  assert.match(JSON.stringify(requests[2].messages), /riskLevel|校验|validation/i)
  for (const request of requests) assert.doesNotMatch(JSON.stringify(request), /PRIVATE_HISTORY|PRIVATE_KEY/)
  const feedback = requests[2].messages.at(-1).content[0]
  assert.equal(feedback.isError, true)
  const errors = JSON.parse(feedback.content[0].text).validationErrors
  assert.ok(errors.some(error => error.params.missingProperty === 'riskLevel'))
  assert.ok(errors.every(error => Object.keys(error).sort().join(',') === 'instancePath,keyword,message,params'))
  await worker.close({ taskId: input.taskId, parentSessionId: 'parent' })
})

test('worker strictly validates both corrections and stops after two schema retries', async () => {
  const input = fixture()
  const requests = []
  let attempts = 0
  const worker = createWorker({ resolveModel, llm: llmFor(input, options => requests.push(options), result => {
    attempts += 1
    if (attempts === 1) delete result.commands[0].riskLevel
    else result.commands[0].unexpected = true
    return result
  }) })
  await assert.rejects(worker.submit(input), /Schema/)
  assert.equal(attempts, 3)
  assert.equal(requests.length, 4)
  assert.equal(worker.status(input.taskId).phase, 'failed')
  assert.doesNotMatch(JSON.stringify(requests), /PRIVATE_HISTORY|PRIVATE_KEY/)
  await worker.dispose()
})

test('worker identity mismatches fail immediately even alongside schema errors', async () => {
  for (const [key, value] of [['submissionId', 'foreign'], ['projectId', 'foreign'], ['baseRevision', -1], ['scopeKey', 'foreign'], ['idempotencyKey', 'foreign']]) {
    const input = fixture()
    let requests = 0
    const worker = createWorker({ resolveModel, llm: llmFor(input, () => requests++, result => {
      result[key] = value
      delete result.commands[0].riskLevel
      return result
    }) })
    await assert.rejects(worker.submit(input), /mismatch|identity/)
    assert.equal(requests, 2)
    await worker.dispose()
  }
})

test('worker timeout aborts its model request and permits an independent retry task', async () => {
  const input = fixture()
  const retry = fixture()
  let signal
  const retryLlm = llmFor(retry)
  const worker = createWorker({
    resolveModel,
    timeoutMs: 20,
    llm: {
      async *stream(options) {
        if (options.sessionId === retry.taskId) {
          yield* retryLlm.stream(options)
          return
        }
        signal = options.signal
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
        yield {
          type: 'finish',
          reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled' } },
        }
      },
    },
  })

  await assert.rejects(worker.submit(input), /timeout/i)
  assert.equal(signal.aborted, true)
  assert.equal(worker.status(input.taskId).phase, 'timed_out')
  assert.equal((await worker.submit(retry)).commands[0].title, 'After')
  assert.notEqual(input.taskId, retry.taskId)
  await worker.dispose()
})
