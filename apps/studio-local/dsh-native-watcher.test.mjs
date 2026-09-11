import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('native Proposal watcher ignores another Submission and resolves only its own review', async () => {
  const source = await readFile(new URL('./public/dsh-native-runtime.js', import.meta.url), 'utf8')
  const listeners = new Map()
  let posted
  let reloads = 0
  let stateReads = 0
  let timerId = 0
  const location = {
    pathname: '/report-studio/',
    search: '?sessionId=session-watcher',
    origin: 'http://studio.local',
    reload() { reloads += 1 },
  }
  const parent = { postMessage(message) { posted = message } }
  const nativeFetch = async input => {
    const path = String(input)
    if (path.includes('/api/review/submit')) {
      return new Response(JSON.stringify({
        submission: { id: 'submission-current' },
        reviewRun: { reviewRunId: 'run-current' },
        state: { proposals: [] },
        dshPrompt: { kind: 'report_studio.review_submission', text: 'review' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (path.includes('/dispatch')) return new Response(JSON.stringify({ status: 'dispatched' }), { status: 200 })
    if (path.includes('/api/state')) {
      stateReads += 1
      const proposals = stateReads < 3
        ? [{ id: 'proposal-other', submissionId: 'submission-other' }]
        : [{ id: 'proposal-other', submissionId: 'submission-other' }, { id: 'proposal-current', submissionId: 'submission-current' }]
      return new Response(JSON.stringify({ reviewSubmissions: [{ id: 'submission-current' }], reviewRuns: [{ reviewRunId: 'run-current', resultProposalId: stateReads >= 3 ? 'proposal-current' : null }], proposals }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${path}`)
  }
  const document = {
    documentElement: { classList: { add() {} } },
    body: { appendChild() {} },
    activeElement: null,
    querySelector() { return null },
    createElement() { return { addEventListener() {}, style: {}, classList: { add() {} } } },
  }
  const window = {
    location,
    parent,
    opener: null,
    fetch: nativeFetch,
    addEventListener(type, listener) { listeners.set(type, listener) },
    setTimeout(callback, delay) {
      timerId += 1
      if (delay === 1500) queueMicrotask(callback)
      return timerId
    },
    clearTimeout() {},
  }
  const context = { window, document, URLSearchParams, URL, Response, MutationObserver: class { observe() {} }, console, queueMicrotask }
  vm.runInNewContext(source, context, { filename: 'dsh-native-runtime.js' })

  const request = window.fetch('/api/review/submit', { method: 'POST' })
  await new Promise(resolve => setImmediate(resolve))
  listeners.get('message')({
    origin: location.origin,
    data: { type: 'report-studio.prompt-result', requestId: posted.requestId, sessionId: 'session-watcher', ok: true },
  })
  await request
  for (let index = 0; index < 5; index += 1) await new Promise(resolve => setImmediate(resolve))

  assert.equal(stateReads, 3, 'watcher must keep polling after an unrelated Proposal')
  assert.equal(reloads, 1, 'watcher reloads only after the matching Proposal arrives')
})

test('native Proposal watcher keeps polling through ordinary proposal_created until auto-apply reaches a terminal state', async () => {
  const source = await readFile(new URL('./public/dsh-native-runtime.js', import.meta.url), 'utf8')
  const listeners = new Map()
  const appliedPhases = []
  let posted
  let stateReads = 0
  const location = { pathname: '/report-studio/', search: '?sessionId=session-auto', origin: 'http://studio.local', reload() { throw new Error('app state sync should avoid reload') } }
  const nativeFetch = async input => {
    const path = String(input)
    if (path.includes('/api/review/submit')) return new Response(JSON.stringify({
      submission: { id: 'submission-auto' }, reviewRun: { reviewRunId: 'run-auto' }, state: { proposals: [] },
      dshPrompt: { kind: 'report_studio.review_submission', text: 'review' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path.includes('/dispatch')) return new Response('{}', { status: 200 })
    if (path.includes('/api/state')) {
      stateReads += 1
      const completed = stateReads >= 3
      return new Response(JSON.stringify({
        project: { currentRevision: completed ? 2 : 1 }, pages: [],
        reviewSubmissions: [{ id: 'submission-auto', status: completed ? 'accepted' : 'proposal_created' }],
        reviewRuns: [{ reviewRunId: 'run-auto', reviewSubmissionId: 'submission-auto', resultProposalId: 'proposal-auto', phase: completed ? 'completed' : 'proposal_created', integrationState: completed ? 'accepted' : 'proposal_created', closedAt: completed ? 'done' : null }],
        proposals: [{ id: 'proposal-auto', submissionId: 'submission-auto', status: completed ? 'accepted' : 'pending', aggregateRiskLevel: 'ordinary_reversible' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected fetch: ${path}`)
  }
  const document = {
    documentElement: { classList: { add() {} } }, body: { appendChild() {} }, activeElement: null,
    querySelector() { return null }, createElement() { return { addEventListener() {}, style: {} } },
  }
  const window = {
    location, parent: { postMessage(message) { posted = message } }, opener: null, fetch: nativeFetch,
    reportStudioApplyTaskState(current) { appliedPhases.push(current.reviewRuns[0].phase); return current.reviewRuns[0].phase === 'completed' },
    addEventListener(type, listener) { listeners.set(type, listener) },
    setTimeout(callback, delay) { if (delay === 1500) queueMicrotask(callback); return 1 }, clearTimeout() {},
  }
  vm.runInNewContext(source, { window, document, URLSearchParams, URL, Response, MutationObserver: class { observe() {} }, queueMicrotask }, { filename: 'dsh-native-runtime.js' })

  const request = window.fetch('/api/review/submit', { method: 'POST' })
  await new Promise(resolve => setImmediate(resolve))
  listeners.get('message')({ origin: location.origin, data: { type: 'report-studio.prompt-result', requestId: posted.requestId, sessionId: 'session-auto', ok: true } })
  await request
  for (let index = 0; index < 5; index += 1) await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(appliedPhases, ['proposal_created', 'completed'])
  assert.equal(stateReads, 3, 'one adapted response read plus two watcher reads are expected')
})

test('native review watcher follows a live DSH turn beyond the original two-minute dispatch lease', async () => {
  const source = await readFile(new URL('./public/dsh-native-runtime.js', import.meta.url), 'utf8')
  const phases = []
  let clock = Date.now()
  let stateReads = 0
  const run = { reviewRunId: 'run-long', reviewSubmissionId: 'submission-long', parentSessionId: 'session-long',
    taskId: 'task-long', executionMode: 'native', nativeStartSeq: 0, phase: 'processing', integrationState: 'dispatched',
    leaseExpiresAt: null, closedAt: null }
  const state = () => ({ reviewRuns: [{ ...run, phase: stateReads >= 4 ? 'completed' : 'processing', closedAt: stateReads >= 4 ? 'done' : null }],
    reviewSubmissions: [{ id: 'submission-long', status: stateReads >= 4 ? 'accepted' : 'dispatched' }], proposals: [] })
  const window = {
    location: { pathname: '/report-studio/', search: '?sessionId=session-long', origin: 'http://studio.local' },
    parent: {}, opener: null,
    fetch: async () => { stateReads++; return new Response(JSON.stringify(state()), { status: 200 }) },
    reportStudioApplyTaskState(current) { phases.push(current.reviewRuns[0].phase); return current.reviewRuns[0].phase === 'completed' },
    addEventListener() {}, clearTimeout() {},
    setTimeout(callback, delay) { if (delay === 1500) queueMicrotask(() => { clock += 70000; callback() }); return 1 },
  }
  const document = { documentElement: { classList: { add() {} } }, querySelector() { return null } }
  class Clock extends Date { static now() { return clock } }
  vm.runInNewContext(source, { window, document, URL, URLSearchParams, Response, Date: Clock, MutationObserver: class { observe() {} } })
  await window.fetch('/api/state')
  for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(phases, ['processing', 'processing', 'completed'])
})
