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
