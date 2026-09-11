import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createInitialState, executeAction } from '../../packages/studio-core/index.mjs'

const root = new URL('./public/', import.meta.url)

test('production browser loads the native DSH Session bridge before the application', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8')
  const nativeIndex = html.indexOf('./dsh-native-runtime.js')
  const appIndex = html.indexOf('./app.js')
  assert.ok(nativeIndex >= 0)
  assert.ok(appIndex > nativeIndex)
})

test('native browser bridge binds API and prompts to the current DSH Session', async () => {
  const runtime = await readFile(new URL('dsh-native-runtime.js', root), 'utf8')
  for (const token of [
    "window.location.pathname.startsWith('/report-studio')",
    "type: 'report-studio.prompt'",
    'report-studio.prompt-result',
    'window.parent !== window ? window.parent : window.opener',
    "apiPath('/api/state')",
    '/dispatch',
    "reportDispatch(payload.submission?.id, 'dispatch_failed'",
  ]) assert.ok(runtime.includes(token), `missing ${token}`)
})

test('production assets resolve from root and the DSH subpath', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8')
  assert.match(html, /href="\.\/styles\.css"/)
  assert.match(html, /src="\.\/app\.js"/)
  assert.doesNotMatch(html, /href="\/styles\.css"/)
  assert.doesNotMatch(html, /src="\/app\.js"/)
})

test('every top-level Studio page is labelled as a standalone fallback with a return to DSH', async () => {
  const runtime = await readFile(new URL('dsh-native-runtime.js', root), 'utf8')
  const notice = { hidden: true }
  const classes = new Set()
  const window = {
    location: { pathname: '/', search: '', origin: 'http://127.0.0.1:4173' },
  }
  window.parent = window
  vm.runInNewContext(runtime, {
    window,
    URLSearchParams,
    MutationObserver: class {},
    document: {
      documentElement: { classList: { add(value) { classes.add(value) } } },
      querySelector(selector) { return selector === '#report-studio-standalone-notice' ? notice : null },
    },
  }, { filename: 'dsh-native-runtime.js' })
  assert.equal(notice.hidden, false)
  assert.equal(classes.has('report-studio-standalone'), true)

  const html = await readFile(new URL('index.html', root), 'utf8')
  assert.match(html, /id="report-studio-return-dsh" href="\/"/)
})

function element(overrides = {}) {
  return {
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    classList: { toggle() {} },
    focus() {},
    ...overrides,
  }
}

function reviewTaskState() {
  let state = createInitialState()
  state = executeAction(state, { type: 'outline.add', parentId: null, title: '第一章' }).state
  const nodeId = state.outline[0].id
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: nodeId }).state
  const pageId = state.pages[0].id
  state = executeAction(state, { type: 'ui.setPage', pageId }).state
  state = executeAction(state, { type: 'ui.setStage', stage: 'draft' }).state
  state = executeAction(state, {
    type: 'annotation.add',
    scopeKey: `draft:${pageId}`,
    target: { type: 'draft-page', id: pageId, label: '第一章' },
    instruction: '补充目标',
  }).state
  const annotationId = state.annotations[0].id
  const baseRevision = state.project.currentRevision
  state.annotations[0].reviewRoundId = 'reviewRound_ui'
  state.annotations[0].lifecycle = 'submitted'
  state.reviewRounds = [{ id: 'reviewRound_ui', scopeKey: `draft:${pageId}`, createdAt: '2026-09-06T00:00:00.000Z' }]
  state.reviewSubmissions = [{
    id: 'reviewSubmission_ui', reviewRoundId: 'reviewRound_ui', number: 1, baseRevision,
    scopeKey: `draft:${pageId}`, status: 'proposal_created', createdAt: '2026-09-06T00:00:01.000Z',
  }]
  state.reviewRuns = [{
    id: 'reviewRun_ui', reviewRunId: 'reviewRun_ui', reviewSubmissionId: 'reviewSubmission_ui',
    taskId: 'reviewTask_ui', phase: 'proposal_created', integrationState: 'proposal_created',
    resultProposalId: 'proposal_ui', closedAt: null, createdAt: '2026-09-06T00:00:02.000Z',
  }]
  state.proposals = [{
    id: 'proposal_ui', submissionId: 'reviewSubmission_ui', reviewRoundId: 'reviewRound_ui',
    baseRevision, status: 'pending', aggregateRiskLevel: 'ordinary_reversible',
    message: '普通修改正在自动应用', affectedObjectIds: [pageId], commands: [],
    diff: { before: [], after: [] }, createdAt: '2026-09-06T00:00:03.000Z',
  }]
  return { state, pageId, nodeId, annotationId }
}

async function loadTaskUi({ nativeAutoApply = false } = {}) {
  const source = await readFile(new URL('./public/app.js', import.meta.url), 'utf8')
  const fixture = reviewTaskState()
  const initialState = structuredClone(fixture.state)
  const listeners = new Map()
  const elements = new Map([
    ['#toast', element({ hidden: true })], ['#project-title', element()], ['#save-status', element()],
    ['#page-strip', element({ hidden: true })], ['#revision-number', element()], ['#outline-stage', element()],
    ['#draft-stage', element()], ['#scope-label', element()], ['#annotation-count', element()],
    ['#proposal-attention', element({ hidden: true })], ['#annotation-target', element()],
    ['#composer-title', element()], ['#clear-composer-round', element({ hidden: true })],
    ['#review-history', element()], ['#agent-status', element()], ['#agent-context-page', element()],
    ['#agent-context-stage', element()], ['#agent-context-project', element()], ['#agent-feed', element()],
    ['#agent-modal', element({ hidden: true })], ['#annotation-input', element()], ['#agent-input', element()],
    ['#migration-gate', element({ hidden: true })], ['#migration-detail', element()], ['#migration-apply', element()],
  ])
  const document = {
    querySelector(selector) { return elements.get(selector) ?? null },
    querySelectorAll() { return [] },
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]) },
  }
  const window = {
    location: { pathname: nativeAutoApply ? '/report-studio/' : '/', search: nativeAutoApply ? '?sessionId=session-ui' : '', origin: 'http://studio.local' },
    setTimeout() { return 1 }, clearTimeout() {}, setInterval() {}, requestAnimationFrame(callback) { callback() },
    addEventListener() {}, confirm() { return true },
    ...(nativeAutoApply ? { reportStudioNativeCapabilities: { ordinaryProposalAutoApply: true } } : {}),
  }
  const response = value => ({ ok: true, async json() { return structuredClone(value) } })
  const context = vm.createContext({
    window, document, structuredClone, console, FileReader: class {}, crypto: globalThis.crypto,
    URL, URLSearchParams, fetch: async path => {
      if (path === '/api/health') return response({ ok: true, agentConfigured: nativeAutoApply })
      if (path === '/api/migration/status') return response({ status: 'ready' })
      if (path === '/api/state') return response(initialState)
      throw new Error(`unexpected fetch: ${path}`)
    },
  })
  vm.runInContext(source, context, { filename: 'app.js' })
  await new Promise(resolve => setImmediate(resolve))
  return { context, window, elements, fixture, initialState }
}

test('async auto-apply terminal state refreshes Revision and annotations without discarding a dirty draft buffer', async () => {
  const app = await loadTaskUi({ nativeAutoApply: true })
  const dirtyBody = element({ id: 'draft-body', value: '本地尚未保存的正文' })
  assert.equal(app.context.updateDraftBufferFromInput(dirtyBody), true)

  const terminal = structuredClone(app.initialState)
  terminal.project.currentRevision += 1
  terminal.outline[0].title = '第一章：目标'
  terminal.pages[0].body = 'Agent 自动应用后的正文'
  terminal.annotations[0].resolution = 'resolved'
  terminal.proposals[0].status = 'accepted'
  terminal.reviewSubmissions[0].status = 'accepted'
  terminal.reviewRuns[0].phase = 'completed'
  terminal.reviewRuns[0].integrationState = 'accepted'
  terminal.reviewRuns[0].closedAt = '2026-09-06T00:00:04.000Z'

  const complete = app.window.reportStudioApplyTaskState(terminal, {
    submissionId: 'reviewSubmission_ui', reviewRunId: 'reviewRun_ui', autoApplyOrdinary: true,
  })
  assert.equal(complete, true, 'terminal accepted state should end native polling')
  assert.equal(app.elements.get('#revision-number').textContent, terminal.project.currentRevision)
  assert.equal(vm.runInContext('state.outline[0].title', app.context), '第一章：目标')
  assert.equal(vm.runInContext('state.annotations[0].resolution', app.context), 'resolved')
  assert.match(app.elements.get('#draft-stage').innerHTML, /本地尚未保存的正文/)
  assert.doesNotMatch(app.elements.get('#draft-stage').innerHTML, /Agent 自动应用后的正文/)
})

test('ordinary pending actions reflect standalone, native auto-apply, and failed acceptance capability', async () => {
  const standalone = await loadTaskUi()
  const standaloneHtml = standalone.context.proposalHtml(standalone.initialState.proposals[0])
  assert.match(standaloneHtml, /data-accept-proposal="proposal_ui"/)
  assert.match(standaloneHtml, /data-reject-proposal="proposal_ui"/)
  assert.match(standaloneHtml, /data-return-proposal="proposal_ui"/)

  const native = await loadTaskUi({ nativeAutoApply: true })
  const processingHtml = native.context.proposalHtml(native.initialState.proposals[0])
  assert.doesNotMatch(processingHtml, /data-accept-proposal="proposal_ui"/)
  assert.match(processingHtml, /自动应用中/)
  assert.match(processingHtml, /data-reject-proposal="proposal_ui"/)
  assert.match(processingHtml, /data-return-proposal="proposal_ui"/)

  const failed = structuredClone(native.initialState)
  failed.reviewRuns[0].phase = 'failed'
  failed.reviewRuns[0].closedAt = '2026-09-06T00:00:05.000Z'
  native.window.reportStudioApplyTaskState(failed, {
    submissionId: 'reviewSubmission_ui', reviewRunId: 'reviewRun_ui', autoApplyOrdinary: true,
  })
  const failedHtml = native.context.proposalHtml(failed.proposals[0])
  assert.match(failedHtml, /data-accept-proposal="proposal_ui"/)
  assert.match(failedHtml, /data-reject-proposal="proposal_ui"/)
  assert.match(failedHtml, /data-return-proposal="proposal_ui"/)
})
