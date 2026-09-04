import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createInitialState, executeAction } from '../../packages/studio-core/index.mjs'

const clone = value => structuredClone(value)
function element(overrides = {}) { return { hidden: false, textContent: '', innerHTML: '', value: '', dataset: {}, classList: { toggle() {} }, focus() {}, ...overrides } }

function stateWithPages(count = 1) {
  let state = createInitialState()
  for (let index = 0; index < count; index += 1) {
    state = executeAction(state, { type: 'outline.add', parentId: null, title: `页面 ${index + 1}` }).state
    state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline.at(-1).id }).state
  }
  state = executeAction(state, { type: 'ui.setPage', pageId: state.pages[0].id }).state
  return executeAction(state, { type: 'ui.setStage', stage: 'draft' }).state
}

function target({ id = '', dataset = {}, matches = [] } = {}) {
  return { id, dataset, closest(selector) { return matches.includes(selector) ? this : null } }
}

async function loadBrowser({ initialState = stateWithPages(), onAction } = {}) {
  const source = await readFile(new URL('./public/app.js', import.meta.url), 'utf8')
  let serverState = clone(initialState)
  const listeners = new Map(); const timers = []; const windowListeners = new Map(); const requests = []
  const elements = new Map([
    ['#toast', element({ hidden: true })], ['#project-title', element()], ['#save-status', element()], ['#page-strip', element({ hidden: true })], ['#revision-number', element()], ['#outline-stage', element()], ['#draft-stage', element()], ['#scope-label', element()], ['#annotation-count', element()], ['#annotation-target', element()], ['#composer-title', element()], ['#clear-composer-round', element({ hidden: true })], ['#review-history', element()], ['#proposal-attention', element({ hidden: true })], ['#agent-status', element()], ['#agent-context-page', element()], ['#agent-context-stage', element()], ['#agent-feed', element()], ['#agent-modal', element({ hidden: true })], ['#annotation-input', element()], ['#agent-input', element()], ['#migration-gate', element({ hidden: true })], ['#migration-detail', element()], ['#migration-apply', element()], ['#draft-heading', element({ id: 'draft-heading' })], ['#draft-body', element({ id: 'draft-body' })], ['#draft-script', element({ id: 'draft-script' })], ['#standard-project-result', element()], ['#standard-import-path', element()],
  ])
  const document = {
    querySelector(selector) { return elements.get(selector) ?? null }, querySelectorAll() { return [] },
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]) },
  }
  const window = {
    setTimeout(callback) { timers.push(callback); return timers.length }, clearTimeout() {}, requestAnimationFrame(callback) { callback() }, confirm() { return true }, location: { pathname: '/', origin: 'http://localhost', search: '' },
    addEventListener(type, listener) { windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]) },
  }
  const response = (value, ok = true) => ({ ok, async json() { return clone(value) } })
  const fetch = async (path, options = {}) => {
    if (path === '/api/health') return response({ ok: true, agentConfigured: false })
    if (path === '/api/migration/status') return response({ status: 'ready' })
    if (path === '/api/state') return response(serverState)
    if (path === '/api/action') {
      const action = JSON.parse(options.body); requests.push(action)
      const handled = await onAction?.({ action, serverState, setState: value => { serverState = clone(value) } })
      if (handled) return response(handled.body, handled.ok)
      const cleanAction = { ...action }; delete cleanAction.baseRevision
      serverState = executeAction(serverState, cleanAction).state
      return response(serverState)
    }
    if (/^\/api\/review\/.+\/retry$/.test(path)) return response({ state: serverState, bridgeResult: null })
    throw new Error(`unexpected fetch: ${path}`)
  }
  const context = { document, window, fetch, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, FileReader: class {}, console, structuredClone, crypto: globalThis.crypto, location: { pathname: '/' }, URL, URLSearchParams }
  vm.runInNewContext(source, context, { filename: 'app.js' })
  await new Promise(resolve => setTimeout(resolve, 0))
  context.render()
  const emit = async (type, event) => { for (const listener of listeners.get(type) ?? []) await listener(event) }
  return { context, elements, emit, requests, timers, windowListeners, getState: () => clone(serverState) }
}

test('a failed draft flush blocks asset removal and never replaces the error with a success toast', async () => {
  const app = await loadBrowser({ onAction: async () => ({ ok: false, body: { error: { code: 'request_failed', message: '磁盘不可写' } } }) })
  const body = app.elements.get('#draft-body'); body.value = '仍需保留的正文'
  await app.emit('input', { target: body })
  await app.emit('click', { target: target({ dataset: { removeAsset: 'pageAsset_missing' }, matches: ['[data-remove-asset]'] }) })
  assert.equal(app.requests.length, 1, 'flush failure must block the remove action')
  assert.match(app.elements.get('#toast').textContent, /未保存/)
  assert.notEqual(app.elements.get('#toast').textContent, '素材已移出本页')
})

test('asset caption input is buffered and saved with the original PageAsset identity', async () => {
  const initialState = stateWithPages(); const page = initialState.pages[0]
  page.pageAssets = [{ pageAssetId: 'pageAsset_caption', assetId: 'asset_caption', role: 'visual', caption: '原说明', order: 0, sourceRefs: [] }]
  page.assets = [{ ...page.pageAssets[0], id: 'asset_caption', name: 'sample.png', type: 'image/png' }]
  const app = await loadBrowser({ initialState })
  assert.match(app.elements.get('#draft-stage').innerHTML, /data-asset-caption="pageAsset_caption"/)
  const caption = target({ dataset: { assetCaption: 'pageAsset_caption' } }); caption.value = '更新后的说明'
  await app.emit('input', { target: caption })
  assert.equal(await app.context.flushDraftBuffer({ reason: '保存素材说明' }), true)
  const saved = app.getState().pages[0].pageAssets[0]
  assert.deepEqual([saved.pageAssetId, saved.assetId, saved.caption], ['pageAsset_caption', 'asset_caption', '更新后的说明'])
})

test('editing the body then adding a list item flushes the body before the structural action', async () => {
  const app = await loadBrowser()
  const body = app.elements.get('#draft-body'); body.value = '先保存的正文'
  await app.emit('input', { target: body })
  await app.emit('click', { target: target({ id: 'add-bullet' }) })
  assert.deepEqual(app.requests.map(request => request.type), ['draft.update', 'draft.list.insert'])
  assert.equal(app.getState().pages[0].body, '先保存的正文')
  assert.equal(app.getState().pages[0].contentBlocks.find(block => block.type === 'list').items.length, 1)
})

test('editing the script then switching pages flushes the script before the View action', async () => {
  const app = await loadBrowser({ initialState: stateWithPages(2) })
  const script = app.elements.get('#draft-script'); script.value = '切页前的讲解稿'
  await app.emit('input', { target: script })
  await app.emit('click', { target: target({ dataset: { pageId: app.getState().pages[1].id }, matches: ['[data-page-id]'] }) })
  assert.deepEqual(app.requests.map(request => request.type), ['draft.update', 'ui.setPage'])
  assert.equal(app.getState().pages[0].script, '切页前的讲解稿')
  assert.equal(app.getState().ui.activePageId, app.getState().pages[1].id)
})

test('dirty input is flushed before Proposal refresh and remains visible after a stale save', async () => {
  let stale = true
  const app = await loadBrowser({ onAction: async ({ action, serverState, setState }) => {
    if (action.type === 'draft.update' && stale) {
      stale = false
      setState(executeAction(serverState, { type: 'project.rename', title: '远端已更新' }).state)
      return { ok: false, body: { error: { code: 'stale_revision', message: '项目已更新', details: { currentRevision: serverState.project.currentRevision + 1 } } } }
    }
    return null
  } })
  const body = app.elements.get('#draft-body'); body.value = '本地仍要保留'
  await app.emit('input', { target: body })
  let operationRan = false
  assert.equal(await app.context.runAfterDraftFlush('刷新 Proposal', () => { operationRan = true }), null)
  assert.equal(operationRan, false)
  assert.match(app.elements.get('#draft-stage').innerHTML, /本地仍要保留/)
  assert.match(app.elements.get('#toast').textContent, /冲突/)
})

test('beforeunload asks for confirmation while a draft is dirty', async () => {
  const app = await loadBrowser()
  const body = app.elements.get('#draft-body'); body.value = '未保存正文'
  await app.emit('input', { target: body })
  const event = { preventDefault() { this.prevented = true } }
  for (const listener of app.windowListeners.get('beforeunload') ?? []) listener(event)
  assert.equal(event.prevented, true)
  assert.match(event.returnValue, /尚未保存/)
})

test('autosave and a protected operation share one in-flight flush instead of creating a false stale', async () => {
  let release
  const app = await loadBrowser({ onAction: async () => new Promise(resolve => { release = () => resolve(null) }) })
  const body = app.elements.get('#draft-body'); body.value = '并发保存正文'
  await app.emit('input', { target: body })
  const autosave = app.timers.at(-1)()
  let operationRan = 0
  const protectedOperation = app.context.runAfterDraftFlush('结构操作', () => { operationRan += 1 })
  assert.equal(app.requests.length, 1)
  release()
  await autosave
  await protectedOperation
  assert.equal(operationRan, 1)
  assert.equal(app.requests.length, 1)
})
