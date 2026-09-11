import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import { escapeHtml, elementLabel, renderLayoutElements } from './public/layout-renderer.js'

const source = await readFile(new URL('./public/layout-ui.js', import.meta.url), 'utf8')
const pageState = {
  project: { currentRevision: 1 },
  pages: [{ id: 'page-1', heading: '汇报页面' }],
  ui: { stage: 'layout', activePageId: 'page-1' },
}
const layoutRecord = {
  layout: { layoutRevision: 1 },
  renderPlan: { canvas: { width: 1600, height: 900 }, elements: [] },
  stale: false,
  state: { ...pageState, project: { currentRevision: 2 } },
}

function createUi(responses) {
  const handlers = new Map()
  const root = { innerHTML: '', addEventListener: (type, handler) => handlers.set(type, handler) }
  const window = { location: { pathname: '/report-studio/', origin: 'http://127.0.0.1:3080', search: '?sessionId=session-ui' } }
  const requests = []
  const queue = [...responses]
  vm.runInNewContext(source.replace(/^import[^\r\n]+[\r\n]+/u, ''), {
    window, URL, URLSearchParams, structuredClone, escapeHtml, elementLabel, renderLayoutElements,
    document: { createElement: () => root, querySelector: () => ({ append() {} }) },
    async fetch(url, options) {
      const response = queue.shift()
      requests.push({ url, method: options.method ?? 'GET' })
      if (!response) throw new Error(`Unexpected request: ${url}`)
      assert.equal(url, `/report-studio/api/layout/pages/page-1${response.suffix ?? ''}?sessionId=session-ui`)
      assert.equal(options.method ?? 'GET', response.method ?? 'GET')
      return {
        ok: !response.error,
        status: response.error ? 409 : 200,
        json: async () => response.error ? { error: { code: 'layout_text_overflow', message: response.error } } : structuredClone(response.payload),
      }
    },
  }, { filename: 'layout-ui.js' })
  window.reportStudioApplyExternalState = state => window.reportStudioLayoutSync(state)
  return {
    root, requests,
    async sync(state = pageState) {
      window.reportStudioLayoutSync(structuredClone(state))
      await setImmediate()
    },
    async click(selector, dataset = {}) {
      const attribute = selector.slice(1, -1)
      assert.ok(root.innerHTML.includes(attribute), `visible control ${selector} is required`)
      const target = { dataset, closest: value => value === selector ? target : null }
      handlers.get('click')({ target })
      await setImmediate()
    },
  }
}

test('load failure remains visible after the loading state finishes', async () => {
  const ui = createUi([{ error: '无法读取 <页面> & 排版' }])
  await ui.sync()
  assert.match(ui.root.innerHTML, /无法读取 &lt;页面&gt; &amp; 排版/u)
  assert.doesNotMatch(ui.root.innerHTML, /正在读取排版/u)
})

test('manual layout overflow stays visible with a usable retry button', async () => {
  const ui = createUi([
    { payload: { layout: null } },
    { suffix: '/ensure', method: 'POST', error: '当前页面正文超过可读的单页容量，请先拆分草案内容再创建排版。' },
    { suffix: '/ensure', method: 'POST', payload: layoutRecord },
  ])
  await ui.sync()
  await ui.click('[data-layout-ensure]')
  assert.match(ui.root.innerHTML, /当前页面正文超过可读的单页容量/u)
  assert.doesNotMatch(ui.root.innerHTML, /正在读取排版/u)
  await ui.click('[data-layout-ensure]')
  assert.match(ui.root.innerHTML, /layout-canvas/u)
  assert.doesNotMatch(ui.root.innerHTML, /超过可读的单页容量/u)
  assert.equal(ui.requests.length, 3)
})

test('layout footer escapes request errors and retains them when zoom rerenders the view', async () => {
  const ui = createUi([
    { payload: layoutRecord },
    { suffix: '/reconcile', method: 'POST', error: '同步失败 <img src=x onerror="alert(1)"> & 请重试' },
  ])
  await ui.sync()
  await ui.click('[data-layout-reconcile]')
  assert.match(ui.root.innerHTML, /同步失败 &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; 请重试/u)
  assert.doesNotMatch(ui.root.innerHTML, /<img src=x/u)
  await ui.click('[data-layout-zoom]', { layoutZoom: 'in' })
  assert.match(ui.root.innerHTML, /同步失败 &lt;img/u)
})

test('empty layout identifies its manual template action and explains the DSH design route', async () => {
  const ui = createUi([{ payload: { layout: null } }])
  await ui.sync()
  assert.match(ui.root.innerHTML, /data-layout-ensure[^>]*>创建手工基础排版</u)
  assert.match(ui.root.innerHTML, /智能排版[^<]*DSH[^<]*Agent[^<]*Pre/u)
})

test('manual layout creation keeps its success message after state sync and zoom', async () => {
  const ui = createUi([
    { payload: { layout: null } },
    { suffix: '/ensure', method: 'POST', payload: layoutRecord },
  ])
  await ui.sync()
  await ui.click('[data-layout-ensure]')
  assert.match(ui.root.innerHTML, /手工基础排版已创建/u)
  await ui.click('[data-layout-zoom]', { layoutZoom: 'in' })
  assert.match(ui.root.innerHTML, /手工基础排版已创建/u)
  assert.equal(ui.requests.length, 2)
})
test('page lock control is reachable and preserves the human protection version',async()=>{
 const locked={...structuredClone(layoutRecord),protection:{pageId:'page-1',revision:4,pageLocked:true,elements:[]}}
 const ui=createUi([{payload:{...structuredClone(layoutRecord),protection:{pageId:'page-1',revision:3,pageLocked:false,elements:[]}}},{suffix:'/protection',method:'POST',payload:locked}])
 await ui.sync();assert.match(ui.root.innerHTML,/锁定此页/u)
 await ui.click('[data-layout-page-lock]');assert.match(ui.root.innerHTML,/解除页面锁定/u);assert.equal(ui.requests.length,2)
})
