import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { test } from 'node:test'
import vm from 'node:vm'
import { chromium } from 'playwright-core'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const browserExecutable = process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
const fixture = () => ({ layout: { sourceStateHash: `sha256:${'c'.repeat(64)}` }, candidateSha: 'a'.repeat(64), renderPlan: { canvas: { width: 320, height: 180 }, elements: [
  { layoutElementId: 'image', type: 'image', zIndex: 1, frame: { x: 8, y: 8, width: 80, height: 80 }, payload: { assetId: 'asset-1' } },
  { layoutElementId: 'text', type: 'text', zIndex: 2, frame: { x: 100, y: 8, width: 210, height: 100 }, style: { fontSize: 20 }, payload: { content: '真实预览 Hello' } },
] }, pageAssets: [{ pageAssetId: 'page-asset-1', assetId: 'asset-1', objectRef: { sha256: hash(png), mimeType: 'image/png', sizeBytes: png.length } }], readAsset: async () => png })

async function renderer(options = {}) {
  const module = await import('./layout-preview.mjs').catch(() => ({}))
  assert.equal(typeof module.createLayoutPreviewRenderer, 'function', 'real preview renderer must exist')
  return module.createLayoutPreviewRenderer({ browserExecutable, ...options })
}

test('real Edge PNG contains image and text and binds the actual render metadata', async () => {
  const result = await (await renderer()).render(fixture())
  assert.ok(Buffer.isBuffer(result.png))
  assert.equal(result.png.readUInt32BE(16), 320)
  assert.equal(result.png.readUInt32BE(20), 180)
  assert.ok(result.png.length > 1000, 'text must be painted, not an empty canvas')
  assert.equal(result.sha256, hash(result.png))
  assert.equal(result.candidateSha, 'a'.repeat(64))
  assert.deepEqual(result.checks.blockers, [])
  assert.ok(result.fonts.length > 0)
  assert.deepEqual(result.materials, [{ pageAssetId: 'page-asset-1', assetId: 'asset-1', sha256: hash(png), mimeType: 'image/png' }])
  const { createPreviewFingerprint } = await import('../../packages/studio-layout-core/preview-fingerprint.mjs')
  assert.equal(result.fingerprint, createPreviewFingerprint(result.fingerprintInputs))
})

test('broken decoding, mismatched hashes, wrong MIME, and missing page assets are blockers', async () => {
  const render = await renderer()
  for (const reason of ['decode', 'hash', 'mime', 'missing']) {
    const input = fixture()
    if (reason === 'decode') {
      const bytes = png.subarray(0, 24)
      input.readAsset = async () => bytes
      input.pageAssets[0].objectRef = { sha256: hash(bytes), sizeBytes: bytes.length, mimeType: 'image/png' }
    }
    if (reason === 'hash') input.readAsset = async () => Buffer.from('wrong bytes')
    if (reason === 'mime') input.pageAssets[0].objectRef.mimeType = 'image/jpeg'
    if (reason === 'missing') input.pageAssets = []
    const result = await render.render(input)
    assert.ok(result.checks.blockers.some(item => item.code.startsWith('asset_')), reason)
  }
})

test('small long-text frames and off-canvas bounds are observed by the real DOM', async () => {
  const input = fixture()
  input.renderPlan.elements[1].frame = { x: 300, y: 8, width: 100, height: 24 }
  input.renderPlan.elements[1].payload.content = '长段正文内容'.repeat(80)
  const result = await (await renderer()).render(input)
  assert.ok(result.checks.blockers.some(item => item.code === 'text_overflow' && item.layoutElementId === 'text'))
  assert.ok(result.checks.blockers.some(item => item.code === 'element_out_of_bounds'))
})

for (const type of ['group', 'shape']) {
  test(`real ${type} labels clipped by their parent frame produce text overflow blockers`, async () => {
    const input = fixture()
    input.renderPlan.elements = [{ layoutElementId: 'label', type, zIndex: 1, frame: { x: 20, y: 20, width: 30, height: 12 }, payload: { label: '这是必须完整显示的长中文说明内容' } }]
    const result = await (await renderer()).render(input)
    assert.ok(result.checks.blockers.some(item => item.code === 'text_overflow' && item.layoutElementId === 'label'))
  })
}

test('computed invisibility blocks zero-opacity text and fully transparent glyph colours', async () => {
  const input = fixture()
  input.renderPlan.elements = [
    { role: 'page_title', style: { opacity: 0 } },
    { role: 'body', style: { opacity: 0 } },
    { role: 'body', style: { textColor: 'transparent' } },
    { role: 'body', style: { textColor: '#00000000' } },
    { role: 'body', style: { textColor: 'rgba(20, 30, 40, 0)' } },
  ].map(({ role, style }, index) => ({ layoutElementId: `hidden-${index}`, type: 'text', zIndex: 1, frame: { x: 10, y: 10 + index * 30, width: 300, height: 28 }, style: { fontSize: 20, ...style }, payload: { role, content: '应当可见的关键文本' } }))
  const result = await (await renderer()).render(input)
  assert.deepEqual(result.checks.blockers.filter(item => item.code === 'text_not_visible').map(item => item.layoutElementId).sort(), ['hidden-0', 'hidden-1', 'hidden-2', 'hidden-3', 'hidden-4'])
})

test('fitting labels, visible text and overlapping decorative backgrounds remain valid', async () => {
  const input = fixture()
  input.renderPlan.elements = [
    { layoutElementId: 'background', type: 'shape', zIndex: 0, frame: { x: 0, y: 0, width: 320, height: 180 }, style: { fill: '#dddddd' }, payload: { decorative: true, label: '不应显示的装饰说明'.repeat(20) } },
    { layoutElementId: 'transparent-decoration', type: 'shape', zIndex: 1, frame: { x: 8, y: 8, width: 30, height: 12 }, style: { opacity: 0 }, payload: { decorative: true } },
    { layoutElementId: 'group-label', type: 'group', zIndex: 2, frame: { x: 20, y: 20, width: 100, height: 40, rotation: 15 }, payload: { label: '说明' } },
    { layoutElementId: 'shape-label', type: 'shape', zIndex: 2, frame: { x: 180, y: 20, width: 100, height: 40 }, payload: { label: '说明' } },
    { layoutElementId: 'visible-text', type: 'text', zIndex: 2, frame: { x: 20, y: 90, width: 280, height: 40 }, style: { fontSize: 20, opacity: 0.5 }, payload: { content: '正常可见的正文' } },
    { layoutElementId: 'empty-text', type: 'text', zIndex: 2, frame: { x: 20, y: 140, width: 100, height: 24 }, style: { opacity: 0 }, payload: { content: '' } },
  ]
  assert.deepEqual((await (await renderer()).render(input)).checks.blockers, [])
})

test('external URLs, CSS requests, and SVG subresources never reach the network', async () => {
  let requests = 0
  const server = createServer((req, res) => { requests++; res.writeHead(302, { location: 'https://example.com/' }); res.end() })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/tracking`
  try {
    for (const attack of ['url', 'css', 'svg']) {
      const input = fixture()
      if (attack === 'url') input.renderPlan.elements[0].payload.src = url
      if (attack === 'css') input.renderPlan.elements.push({ layoutElementId: 'shape', type: 'shape', zIndex: 0, frame: { x: 0, y: 0, width: 320, height: 180 }, style: { fill: `url(${url})` }, payload: { decorative: true } })
      if (attack === 'svg') {
        const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><image href="${url}"/></svg>`)
        input.pageAssets[0].objectRef = { sha256: hash(bytes), sizeBytes: bytes.length, mimeType: 'image/svg+xml' }
        input.readAsset = async () => bytes
      }
      const result = await (await renderer()).render(input)
      assert.ok(result.checks.blockers.length > 0, attack)
    }
    assert.equal(requests, 0)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('shared markup escapes user text while editing affordances remain opt-in', async () => {
  const module = await import('./public/layout-renderer.js').catch(() => ({}))
  assert.equal(typeof module.renderLayoutElements, 'function', 'shared renderer must exist')
  const input = fixture()
  input.renderPlan.elements[1].payload.content = '<script>alert("bad")</script>'
  const assetUrl = () => '/safe-image'
  const html = module.renderLayoutElements(input.renderPlan, { assetUrl, selectedId: null, editable: false })
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>|layout-resize-handle|is-selected/)
  assert.match(module.renderLayoutElements(input.renderPlan, { assetUrl, selectedId: 'text', editable: true }), /layout-resize-handle/)
})

test('missing browser, timeout, and cancellation are explicit and renderer remains usable', async () => {
  await assert.rejects((await renderer({ browserExecutable: 'C:/missing/edge.exe' })).render(fixture()), { code: 'preview_browser_missing' })
  const abort = new AbortController()
  abort.abort()
  await assert.rejects((await renderer()).render({ ...fixture(), signal: abort.signal }), { code: 'preview_cancelled' })
  const slow = fixture()
  slow.readAsset = () => new Promise(() => {})
  await assert.rejects((await renderer({ timeoutMs: 250 })).render(slow), { code: 'preview_timeout' })
  const pending = new AbortController()
  const render = await renderer()
  const work = render.render({ ...slow, signal: pending.signal })
  setTimeout(() => pending.abort(), 300)
  await assert.rejects(work, { code: 'preview_cancelled' })
  assert.equal((await render.render(fixture())).checks.blockers.length, 0)
})

test('an editor canvas at 100 percent produces the same pixels as a frozen preview', async () => {
  const input = fixture()
  const result = await (await renderer()).render(input)
  const module = await import('./public/layout-renderer.js')
  const root = { addEventListener() {}, style: {}, append() {} }
  const context = { ...module, document: { createElement: () => root, querySelector: () => null }, window: { location: { pathname: '/', origin: 'http://editor.test', search: '' } }, structuredClone, URL, URLSearchParams, input }
  const source = (await readFile(new URL('./public/layout-ui.js', import.meta.url), 'utf8')).replace(/^import[^\n]*\n/gm, '')
  vm.runInNewContext(source, context)
  vm.runInNewContext("hostState = { pages: [{ id: 'page-1', heading: '预览' }], ui: { stage: 'layout', activePageId: 'page-1' } }; record = input; zoom = 1; selectedId = null; render()", context)
  const css = await readFile(new URL('./public/styles.css', import.meta.url), 'utf8')
  const layoutCss = await readFile(new URL('./public/layout.css', import.meta.url), 'utf8')
  const browser = await chromium.launch({ executablePath: browserExecutable, headless: true })
  try {
    const browserContext = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' })
    await browserContext.route('**/*', route => route.request().url() === 'http://editor.test/api/assets/asset-1/content' ? route.fulfill({ contentType: 'image/png', body: png }) : route.abort())
    const page = await browserContext.newPage()
    await page.setContent(`<html lang="zh-CN"><base href="http://editor.test/"><style>${css}\n${layoutCss}</style><section class="layout-studio">${root.innerHTML}</section></html>`)
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())) })
    await page.mouse.move(1199, 799)
    const editorPng = await page.locator('[data-layout-canvas]').screenshot({ type: 'png', animations: 'disabled' })
    assert.equal(hash(editorPng), result.sha256, 'editor and preview canvas pixels must match')
  } finally { await browser.close() }
})

test('shared blobs cannot bypass size validation', async () => {
  const input = fixture()
  input.pageAssets.push({ ...structuredClone(input.pageAssets[0]), pageAssetId: 'p2', assetId: 'asset-2' })
  input.pageAssets[1].objectRef.sizeBytes = png.length + 1
  input.renderPlan.elements.push({ ...structuredClone(input.renderPlan.elements[0]), layoutElementId: 'image-2', payload: { assetId: 'asset-2' } })
  assert.ok((await (await renderer()).render(input)).checks.blockers.some(item => item.code === 'asset_hash_mismatch'))
})

test('objectRef URLs cannot invoke the asset reader', async () => {
  const remote = fixture()
  remote.pageAssets[0].objectRef.url = 'http://example.invalid/private'
  let reads = 0
  remote.readAsset = async () => { reads++; return png }
  assert.ok((await (await renderer()).render(remote)).checks.blockers.some(item => item.code === 'external_resource_rejected'))
  assert.equal(reads, 0)
})

test('real layout source hashes preserve the sha256 prefix in verification inputs', async () => {
  const input = fixture()
  input.layout.sourceStateHash = `sha256:${'c'.repeat(64)}`
  const result = await (await renderer()).render(input)
  assert.equal(result.fingerprintInputs.sourceStateHash, input.layout.sourceStateHash)
  assert.deepEqual(result.checks.blockers, [])
})

test('cancelling during browser launch closes its child process and loopback listener', async () => {
  const ownedHandles = () => process._getActiveHandles().filter(handle => handle.constructor?.name === 'ChildProcess' || handle.constructor?.name === 'Server')
  const baseline = new Set(ownedHandles())
  const abort = new AbortController()
  const work = (await renderer()).render({ ...fixture(), signal: abort.signal })
  const polling = setInterval(() => {
    if (ownedHandles().some(handle => handle.constructor?.name === 'ChildProcess' && !baseline.has(handle))) abort.abort()
  }, 5)
  try { await assert.rejects(work, { code: 'preview_cancelled' }) } finally { clearInterval(polling) }
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(ownedHandles().filter(handle => !baseline.has(handle) && (handle.constructor.name === 'Server' ? handle.listening : handle.exitCode === null && handle.signalCode === null)), [], 'renderer-owned processes and loopback listeners must close')
})
