import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioDshRuntime } from './lib/runtime.js'
import { apply } from './lib/index.js'
import { Readable } from 'node:stream'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'studio-native-lifecycle-'))
  const sessionId = 'native-lifecycle'
  const session = { id: sessionId, header: { cwd: root }, events: [], get seq() { return this.events.length } }
  const runtime = createStudioDshRuntime({ dataRoot: join(root, 'data'), sessions: { get: id => id === sessionId ? session : undefined } })
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }) })
  await runtime.executeAction(sessionId, { type: 'outline.add', parentId: null, title: '原始', baseRevision: 0 })
  await runtime.executeAction(sessionId, { type: 'annotation.add', scopeKey: 'outline:root', instruction: '修改标题' })
  const task = await runtime.submitReview(sessionId, { scopeKey: 'outline:root' })
  const repository = await runtime.repositoryFor(sessionId)
  const append = (type, data) => session.events.push({ type, data, seq: session.seq, time: Date.now() })
  const prompt = selected => ({ id: `message-${selected.reviewRun.reviewRunId}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: selected.dshPrompt.text }] })
  const expire = () => repository.transactOperational(state => { state.reviewRuns.at(-1).leaseExpiresAt = '2000-01-01T00:00:00.000Z'; return state })
  const read = () => runtime.getState(sessionId)
  return { runtime, sessionId, task, repository, session, append, prompt, expire, read }
}

test('a native review queued behind another turn survives lease expiry and unrelated turn completion', async t => {
  const f = await fixture(t)
  f.append('turn/start', { turn: 10 })
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [f.prompt(f.task)] })
  await f.runtime.updateDispatch(f.sessionId, f.task.submission.id, { status: 'dispatched', reviewRunId: f.task.reviewRun.reviewRunId })
  await f.expire()
  f.append('turn/end', { turn: 10, reason: { kind: 'error', error: { code: 'QUOTA', message: 'unrelated' } } })
  const state = await f.read()
  assert.equal(state.reviewSubmissions[0].status, 'dispatched')
  assert.equal(state.reviewRuns[0].phase, 'queued')
  assert.equal(state.reviewRuns[0].closedAt, null)
})

test('a native review tracks its long-running turn and only safe actual model identifiers', async t => {
  const f = await fixture(t)
  f.append('turn/start', { turn: 11 })
  f.append('user/message', f.prompt(f.task))
  f.append('assistant/message', { turn: 11, step: 1, message: { source: { kind: 'model', provider: 'antigravity', model: 'gemini-3.8-flash-high', endpoint: 'https://secret.invalid', apiKey: 'do-not-store' } } })
  await f.runtime.updateDispatch(f.sessionId, f.task.submission.id, { status: 'dispatched', reviewRunId: f.task.reviewRun.reviewRunId })
  await f.expire()
  const state = await f.read()
  assert.equal(state.reviewSubmissions[0].status, 'dispatched')
  assert.equal(state.reviewRuns[0].phase, 'processing')
  assert.equal(state.reviewRuns[0].nativeTurn, 11)
  assert.deepEqual(state.reviewRuns[0].executionModel, { provider: 'antigravity', model: 'gemini-3.8-flash-high' })
  assert.doesNotMatch(JSON.stringify(state.reviewRuns), /secret\.invalid|do-not-store/)
})

test('a matching native quota failure is terminal and does not expose the raw provider response', async t => {
  const f = await fixture(t)
  f.append('turn/start', { turn: 12 })
  f.append('user/message', f.prompt(f.task))
  await f.runtime.updateDispatch(f.sessionId, f.task.submission.id, { status: 'dispatched', reviewRunId: f.task.reviewRun.reviewRunId })
  f.append('turn/end', { turn: 12, reason: { kind: 'error', error: { code: 'QUOTA', message: 'HTTP 429 quota exhausted Authorization: Bearer secret-token https://secret.invalid' } } })
  const state = await f.read()
  assert.equal(state.reviewSubmissions[0].status, 'apply_failed')
  assert.equal(state.reviewRuns[0].phase, 'failed')
  assert.match(state.reviewRuns[0].lastError, /额度|配额/)
  assert.doesNotMatch(JSON.stringify(state.reviewRuns), /secret-token|secret\.invalid|Authorization/)
  assert.equal(state.annotations[0].resolution, 'open')
})

test('an old native turn end cannot finish a retry of the same frozen submission', async t => {
  const f = await fixture(t)
  f.append('turn/start', { turn: 13 })
  f.append('user/message', f.prompt(f.task))
  f.append('turn/end', { turn: 13, reason: { kind: 'error', error: { code: 'QUOTA' } } })
  assert.equal((await f.read()).reviewSubmissions[0].status, 'apply_failed')
  const retry = await f.runtime.retrySubmission(f.sessionId, f.task.submission.id)
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [f.prompt(retry)] })
  f.append('turn/end', { turn: 13, reason: { kind: 'error', error: { code: 'QUOTA' } } })
  await f.runtime.updateDispatch(f.sessionId, retry.submission.id, { status: 'dispatched', reviewRunId: retry.reviewRun.reviewRunId })
  await f.expire()
  const state = await f.read()
  assert.equal(state.reviewSubmissions[0].status, 'dispatched')
  assert.equal(state.reviewRuns.at(-1).phase, 'queued')
  assert.equal(state.reviewRuns.at(-1).nativeTurn ?? null, null)
})

test('native lifecycle events persist a failure even when no Studio browser is polling', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-native-event-'))
  const session = { id: 'event-session', header: { cwd: root }, events: [], get seq() { return this.events.length } }
  const listeners = new Map()
  let route
  let cleanup
  apply({
    sessions: { get: id => id === session.id ? session : undefined },
    tools: { register() {} }, systemPrompt: { section() {} },
    webServer: { host: '127.0.0.1', register(value) { route = value; return () => {} } },
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    effect(factory) { cleanup = factory() },
  }, { dataDir: join(root, 'data'), allowNativeReview: true })
  t.after(async () => { await cleanup(); await rm(root, { recursive: true, force: true }) })
  const post = async (path, body) => {
    let result
    await route.handler(Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', url: `/report-studio/api/${path}?sessionId=${session.id}`, headers: { 'content-type': 'application/json' } }),
      { setHeader() {}, end(value) { result = JSON.parse(value) } })
    return result
  }
  await post('action', { type: 'outline.add', parentId: null, title: '事件测试', baseRevision: 0 })
  await post('action', { type: 'annotation.add', scopeKey: 'outline:root', instruction: '改标题' })
  const task = await post('review/submit', { scopeKey: 'outline:root' })
  for (const [type, data] of [
    ['turn/start', { turn: 20 }],
    ['user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: task.dshPrompt.text }] }],
    ['turn/end', { turn: 20, reason: { kind: 'error', error: { code: 'QUOTA' } } }],
  ]) {
    const event = { type, data, seq: session.seq, time: Date.now() }
    session.events.push(event)
    await listeners.get('session/event')?.(session, event)
  }
  // The dispatch route does not run getState reconciliation: the event hook must have persisted the failure.
  const lateAck = await post(`review/${task.submission.id}/dispatch`, { status: 'dispatched', reviewRunId: task.reviewRun.reviewRunId })
  assert.equal(lateAck.status, 'apply_failed')
  assert.match(lateAck.lastDispatchError, /额度|配额/)
})

test('a successful native apply remains final when the matching DSH turn subsequently fails', async t => {
  const f = await fixture(t)
  f.append('turn/start', { turn: 21 })
  f.append('user/message', f.prompt(f.task))
  await f.read()
  const s = f.task.submission
  await f.runtime.applyCommands(f.sessionId, { submissionId: s.id, projectId: s.projectId, baseRevision: s.baseRevision,
    scopeKey: s.scopeKey, message: '资料不足，保持批注未完成', commands: [] })
  f.append('turn/end', { turn: 21, reason: { kind: 'error', error: { code: 'QUOTA' } } })
  const state = await f.read()
  assert.equal(state.reviewSubmissions[0].status, 'no_changes')
  assert.equal(state.reviewRuns[0].phase, 'no_changes')
  assert.equal(state.annotations[0].resolution, 'open')
})

test('a lost browser acknowledgement cannot fail a native request already present in the DSH queue', async t => {
  const f = await fixture(t)
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [f.prompt(f.task)] })
  await f.read()
  const ack = await f.runtime.updateDispatch(f.sessionId, f.task.submission.id, { status: 'dispatch_failed',
    reviewRunId: f.task.reviewRun.reviewRunId, error: 'DSH Session 接收请求超时。' })
  assert.equal(ack.status, 'dispatched')
  assert.equal((await f.read()).reviewRuns[0].phase, 'queued')
})

test('removing the exact native request from an idle DSH queue ends that request without a fake completion', async t => {
  const f = await fixture(t)
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 2, inserted: [f.prompt(f.task)] })
  await f.read()
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 2, removedCount: 1, inserted: [] })
  const state = await f.read()
  assert.equal(state.reviewSubmissions[0].status, 'apply_failed')
  assert.match(state.reviewRuns[0].lastError, /移除|取消/)
  assert.equal(state.annotations[0].resolution, 'open')
})

test('the DSH dequeue-to-user-message gap is still processing the same request', async t => {
  const f = await fixture(t)
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [f.prompt(f.task)] })
  f.append('turn/start', { turn: 23 })
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
  await f.expire()
  assert.equal((await f.read()).reviewSubmissions[0].status, 'dispatched')
  f.append('user/message', f.prompt(f.task))
  f.append('request/header', { header: { config: { provider: 'antigravity', model: 'gemini-3.8-flash-high', headers: { Authorization: 'secret' } }, system: 'not-stored' } })
  const state = await f.read()
  assert.equal(state.reviewRuns[0].phase, 'processing')
  assert.deepEqual(state.reviewRuns[0].executionModel, { provider: 'antigravity', model: 'gemini-3.8-flash-high' })
  assert.doesNotMatch(JSON.stringify(state.reviewRuns), /secret|not-stored|Authorization/)
})

test('explicitly canceled review becomes retryable while an unrelated DSH turn is still running', async t => {
  const f = await fixture(t)
  f.append('turn/start', { turn: 30 })
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [f.prompt(f.task)] })
  await f.read()
  f.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' })
  const state = await f.read()
  assert.equal(state.reviewSubmissions[0].status, 'apply_failed')
  assert.match(state.reviewRuns[0].lastError, /取消|移除/)
  assert.equal(state.annotations[0].resolution, 'open')
})
