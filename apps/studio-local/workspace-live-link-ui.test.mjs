import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createInitialState, executeAction } from '../../packages/studio-core/index.mjs'

const clone = value => structuredClone(value)

function element(overrides = {}) {
  const attributes = new Map()
  return {
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    scrollTop: 0,
    scrollLeft: 0,
    classList: { toggle() {} },
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.get(name) ?? null },
    removeAttribute(name) { attributes.delete(name) },
    focus() {},
    ...overrides,
  }
}

function stateWithPage() {
  let state = createInitialState()
  state = executeAction(state, { type: 'outline.add', parentId: null, title: 'Workspace 页面' }).state
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
  state = executeAction(state, { type: 'ui.setPage', pageId: state.pages[0].id }).state
  return executeAction(state, { type: 'ui.setStage', stage: 'draft' }).state
}

function clickTarget(datasetKey) {
  return {
    id: '',
    dataset: {},
    closest(selector) {
      return selector === `[data-${datasetKey}]` ? this : null
    },
  }
}

async function loadWorkspaceUi() {
  const source = await readFile(new URL('./public/app.js', import.meta.url), 'utf8')
  let serverState = stateWithPage()
  const upstreamState = clone(serverState)
  upstreamState.project.currentRevision += 1
  upstreamState.project.title = '上游更新后的项目'
  upstreamState.pages[0].body = '上游更新后的正文'
  let workspace = {
    status: 'connected',
    workspaceRoot: 'C:\\projects\\current-workspace',
    projectId: serverState.project.id,
    standardVersion: '0.1.0',
    fingerprint: '1'.repeat(64),
    appliedFingerprint: '1'.repeat(64),
    sourceRevision: 42,
    sourceRevisions: [{ provider: 'pre-design', sourceProjectId: 'pre_1', sourceRevision: 42 }],
    readAt: '2026-09-04T08:00:00.000Z',
    validation: { valid: true, errors: [], warnings: [] },
    hasUpstreamCandidate: false,
  }
  const requests = []
  const listeners = new Map()
  const windowListeners = new Map()
  const elements = new Map([
    ['#toast', element({ hidden: true })], ['#project-title', element()], ['#save-status', element()], ['#page-strip', element({ hidden: true })], ['#revision-number', element()], ['#outline-stage', element()], ['#draft-stage', element()], ['#stage-workspace', element()], ['#scope-label', element()], ['#annotation-count', element()], ['#annotation-target', element()], ['#composer-title', element()], ['#clear-composer-round', element({ hidden: true })], ['#review-history', element()], ['#proposal-attention', element({ hidden: true })], ['#agent-status', element()], ['#agent-context-project', element()], ['#agent-context-page', element()], ['#agent-context-stage', element()], ['#agent-feed', element()], ['#agent-modal', element({ hidden: true })], ['#agent-fab', element()], ['#annotation-input', element()], ['#agent-input', element()], ['#migration-gate', element({ hidden: true })], ['#migration-detail', element()], ['#migration-apply', element()], ['#draft-heading', element({ id: 'draft-heading' })], ['#draft-body', element({ id: 'draft-body' })], ['#draft-script', element({ id: 'draft-script' })], ['#standard-project-result', element()], ['#standard-import-path', element()],
    ['#workspace-sync-toggle', element()], ['#workspace-sync-label', element()], ['#workspace-sync-panel', element({ hidden: true })], ['#workspace-sync-details', element()], ['#workspace-conflict-banner', element({ hidden: true })], ['#workspace-update-summary', element()],
  ])
  const document = {
    querySelector(selector) { return elements.get(selector) ?? null },
    querySelectorAll() { return [] },
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]) },
  }
  const window = {
    setTimeout() { return 1 }, clearTimeout() {}, setInterval() { return 1 }, clearInterval() {},
    requestAnimationFrame(callback) { callback() }, confirm() { return true },
    location: { pathname: '/', origin: 'http://localhost', search: '' },
    addEventListener(type, listener) { windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]) },
  }
  const response = (value, ok = true) => ({ ok, status: ok ? 200 : 400, async json() { return clone(value) } })
  const fetch = async (path, options = {}) => {
    requests.push({ path, options })
    if (path === '/api/health') return response({ ok: true, agentConfigured: true })
    if (path === '/api/migration/status') return response({ status: 'ready' })
    if (path === '/api/state') return response(serverState)
    if (path === '/api/workspace/status') return response(workspace)
    if (path === '/api/workspace/apply') {
      serverState = clone(upstreamState)
      workspace = { ...workspace, status: 'connected', fingerprint: workspace.candidateFingerprint, appliedFingerprint: workspace.candidateFingerprint, sourceRevision: workspace.candidateSourceRevision, hasUpstreamCandidate: false, candidateFingerprint: null, candidateSourceRevision: null }
      return response(workspace)
    }
    if (path === '/api/workspace/reload') {
      const input = JSON.parse(options.body || '{}')
      if (input.dirty) return response({ ...workspace, status: 'local_dirty_conflict', hasUpstreamCandidate: true })
      serverState = clone(upstreamState)
      workspace = { ...workspace, status: 'connected', fingerprint: workspace.candidateFingerprint, appliedFingerprint: workspace.candidateFingerprint, sourceRevision: workspace.candidateSourceRevision, hasUpstreamCandidate: false, candidateFingerprint: null, candidateSourceRevision: null }
      return response(workspace)
    }
    if (path === '/api/action') {
      const action = JSON.parse(options.body)
      const cleanAction = { ...action }; delete cleanAction.baseRevision
      serverState = executeAction(serverState, cleanAction).state
      return response(serverState)
    }
    throw new Error(`unexpected fetch: ${path}`)
  }
  const context = { document, window, fetch, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, FileReader: class {}, console, structuredClone, crypto: globalThis.crypto, location: { pathname: '/' }, URL, URLSearchParams }
  vm.runInNewContext(source, context, { filename: 'app.js' })
  await new Promise(resolve => setImmediate(resolve))
  const emit = async (type, event) => { for (const listener of listeners.get(type) ?? []) await listener(event) }
  return {
    context,
    elements,
    emit,
    requests,
    upstreamState,
    setWorkspace(value) { workspace = clone(value) },
    getServerState() { return clone(serverState) },
  }
}

function upstreamCandidate(overrides = {}) {
  return {
    status: 'upstream_update_available',
    workspaceRoot: 'C:\\projects\\current-workspace',
    projectId: 'project_live',
    standardVersion: '0.1.0',
    fingerprint: '1'.repeat(64),
    appliedFingerprint: '1'.repeat(64),
    candidateFingerprint: '2'.repeat(64),
    sourceRevision: 42,
    candidateSourceRevision: 43,
    sourceRevisions: [{ provider: 'pre-design', sourceProjectId: 'pre_1', sourceRevision: 43 }],
    readAt: '2026-09-04T08:01:00.000Z',
    validation: { valid: true, errors: [], warnings: [] },
    hasUpstreamCandidate: true,
    ...overrides,
  }
}

test('workspace status panel exposes the required identity, revision, fingerprint and structured validation error', async () => {
  const app = await loadWorkspaceUi()
  app.setWorkspace(upstreamCandidate({
    status: 'workspace_contract_invalid',
    validation: { valid: false, errors: [{ filePath: 'outline.json', instancePath: '/nodes/0', message: '缺少 title' }], warnings: [] },
  }))
  await app.context.refreshWorkspaceStatus({ allowAutoApply: false })
  assert.match(app.elements.get('#workspace-sync-label').textContent, /Contract 校验失败/)
  assert.match(app.elements.get('#workspace-sync-details').innerHTML, /current-workspace/)
  assert.match(app.elements.get('#workspace-sync-details').innerHTML, /0\.1\.0/)
  assert.match(app.elements.get('#workspace-sync-details').innerHTML, /43/)
  assert.match(app.elements.get('#workspace-sync-details').innerHTML, /222222222222/)
  assert.match(app.elements.get('#workspace-sync-details').innerHTML, /outline\.json/)
  assert.match(app.elements.get('#workspace-sync-details').innerHTML, /缺少 title/)
})

test('clicking the label inside the Workspace status button opens its details panel', async () => {
  const app = await loadWorkspaceUi()
  const child = {
    id: 'workspace-sync-label',
    closest(selector) { return selector === '#workspace-sync-toggle' ? app.elements.get('#workspace-sync-toggle') : null },
  }
  await app.emit('click', { target: child })
  assert.equal(app.elements.get('#workspace-sync-panel').hidden, false)
  assert.equal(app.elements.get('#workspace-sync-toggle').getAttribute('aria-expanded'), 'true')
})

test('dirty draft pins the four-action conflict banner and never auto-applies the candidate', async () => {
  const app = await loadWorkspaceUi()
  const body = app.elements.get('#draft-body')
  body.value = '必须保留的本地输入'
  await app.emit('input', { target: body })
  app.setWorkspace(upstreamCandidate())
  await app.context.refreshWorkspaceStatus()
  assert.equal(app.requests.some(request => request.path === '/api/workspace/apply'), false)
  assert.equal(app.elements.get('#workspace-conflict-banner').hidden, false)
  assert.match(app.elements.get('#workspace-update-summary').textContent, /Pre Revision 43/)

  await app.emit('click', { target: clickTarget('workspace-view-update') })
  assert.equal(app.elements.get('#workspace-sync-panel').hidden, false)
  await app.emit('click', { target: clickTarget('workspace-keep-current') })
  assert.equal(app.elements.get('#workspace-conflict-banner').hidden, true)

  app.setWorkspace(upstreamCandidate({ candidateFingerprint: '3'.repeat(64), candidateSourceRevision: 44 }))
  await app.context.refreshWorkspaceStatus()
  assert.equal(app.elements.get('#workspace-conflict-banner').hidden, false, 'a newer candidate must be shown again')
})

test('clean upstream update applies automatically and restores page-strip scroll and active page', async () => {
  const app = await loadWorkspaceUi()
  app.elements.get('#page-strip').scrollLeft = 73
  app.setWorkspace(upstreamCandidate())
  await app.context.refreshWorkspaceStatus()
  assert.equal(app.requests.filter(request => request.path === '/api/workspace/apply').length, 1)
  assert.equal(app.elements.get('#page-strip').scrollLeft, 73)
  assert.equal(app.elements.get('#project-title').value, '上游更新后的项目')
  assert.match(app.elements.get('#page-strip').innerHTML, new RegExp(app.upstreamState.ui.activePageId))
  assert.match(app.elements.get('#workspace-sync-label').textContent, /Pre Revision 43/)
})

test('overlapping status polls coalesce and apply one upstream candidate only once', async () => {
  const app = await loadWorkspaceUi()
  app.setWorkspace(upstreamCandidate())
  await Promise.all([
    app.context.refreshWorkspaceStatus(),
    app.context.refreshWorkspaceStatus(),
  ])
  assert.equal(app.requests.filter(request => request.path === '/api/workspace/apply').length, 1)
})

test('a later invalid upstream write replaces the prior success notice with the Contract error', async () => {
  const app = await loadWorkspaceUi()
  app.setWorkspace(upstreamCandidate())
  await app.context.refreshWorkspaceStatus()
  app.setWorkspace({
    ...upstreamCandidate(),
    status: 'workspace_contract_invalid',
    fingerprint: '2'.repeat(64),
    appliedFingerprint: '2'.repeat(64),
    candidateFingerprint: null,
    candidateSourceRevision: null,
    hasUpstreamCandidate: false,
    validation: { valid: false, errors: [{ filePath: 'outline.json', instancePath: '', message: '上游文件尚未写完' }], warnings: [] },
  })
  await app.context.refreshWorkspaceStatus({ allowAutoApply: false })
  assert.match(app.elements.get('#workspace-sync-label').textContent, /Contract 校验失败/)
})

test('save-then-reload and discard-then-apply are explicit conflict resolutions', async () => {
  const saved = await loadWorkspaceUi()
  const savedBody = saved.elements.get('#draft-body')
  savedBody.value = '先保存的本地输入'
  await saved.emit('input', { target: savedBody })
  saved.setWorkspace(upstreamCandidate())
  await saved.context.refreshWorkspaceStatus()
  await saved.emit('click', { target: clickTarget('workspace-save-reload') })
  const savedPaths = saved.requests.map(request => request.path)
  assert.ok(savedPaths.indexOf('/api/action') < savedPaths.indexOf('/api/workspace/reload'))
  assert.equal(JSON.parse(saved.requests.find(request => request.path === '/api/workspace/reload').options.body).dirty, false)

  const discarded = await loadWorkspaceUi()
  const discardedBody = discarded.elements.get('#draft-body')
  discardedBody.value = '将被明确放弃的输入'
  await discarded.emit('input', { target: discardedBody })
  discarded.setWorkspace(upstreamCandidate())
  await discarded.context.refreshWorkspaceStatus()
  await discarded.emit('click', { target: clickTarget('workspace-discard-reload') })
  assert.equal(discarded.requests.some(request => request.path === '/api/action'), false)
  assert.equal(discarded.requests.filter(request => request.path === '/api/workspace/apply').length, 1)
  assert.equal(discarded.elements.get('#project-title').value, '上游更新后的项目')
})
