import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { createRepository } from '../apps/studio-local/repository.mjs'
import { createLayoutService } from '../apps/studio-local/layout-service.mjs'
import { serveReferencedAsset } from '../apps/studio-local/asset-service.mjs'
import { readStandardProject } from '../packages/studio-standard-adapter/index.mjs'

const workspace = process.argv[2]
const noBrowser = process.argv.includes('--no-browser')
assert.ok(workspace && isAbsolute(workspace), 'Pass the absolute read-only draft workspace to verify')
const chrome = [process.env.CHROMIUM_PATH,
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(path => path && existsSync(path))
assert.ok(noBrowser || chrome, 'Set CHROMIUM_PATH to a Chromium browser for real text and image verification')
const temporary = await mkdtemp(join(tmpdir(), 'studio-layout-browser-'))
const layoutRoot = join(resolve(workspace), 'layouts', `verification-${Date.now()}`)
const repository = await createRepository(join(temporary, 'repository'))
let server
try {
  const imported = await readStandardProject(workspace, { putBlob: repository.putBlob, archiveScope: 'managed' })
  await repository.initializeFromStandardProject({ snapshot: imported.snapshot })
  const service = createLayoutService({ repository, layoutRoot })
  const domRoot = { addEventListener() {}, style: {}, append() {} }
  const context = { document: { createElement: () => domRoot, querySelector: () => null },
    window: { location: { pathname: '/', search: '', origin: 'http://localhost' } }, structuredClone, URL, URLSearchParams }
  vm.runInNewContext(await readFile(new URL('../apps/studio-local/public/layout-ui.js', import.meta.url), 'utf8'), context)
  const [appCss, layoutCss] = await Promise.all(['styles.css', 'layout.css'].map(name => readFile(new URL(`../apps/studio-local/public/${name}`, import.meta.url), 'utf8')))
  const failures = []
  const plans = []
  for (const page of imported.snapshot.pages) {
    try {
      const result = await service.ensure({ pageId: page.id, baseRevision: repository.getState().project.currentRevision })
      const elements = result.renderPlan.elements
      assert.ok(elements.every(element => element.frame.y + element.frame.height <= 900 && element.frame.x + element.frame.width <= 1600), 'layout element exceeded its canvas')
      assert.equal(elements.filter(element => ['script', 'script-block', 'table-cell'].includes(element.payload?.kind)).length, 0, 'notes or loose table cells reached the canvas')
      assert.equal(elements.filter(element => element.type === 'image' && element.payload.role === 'reference').length, 0, 'reference original reached the canvas')
      const eligibleImages = page.pageAssets.filter(asset => /^image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|webp|x-icon|vnd\.microsoft\.icon)$/iu.test(asset.mimeType ?? ''))
      const expectedImageIds = [eligibleImages.find(asset => asset.role === 'background'),
        ...eligibleImages.filter(asset => ['primary', 'supporting'].includes(asset.role)).slice(0, 2)]
        .filter(Boolean).map(asset => asset.pageAssetId).sort()
      assert.deepEqual(elements.filter(element => element.type === 'image').map(element => element.sourceKey.slice('page-asset:'.length)).sort(), expectedImageIds,
        'a supported linked page image was lost during standard import or default layout generation')
      const expectedTexts = page.contentBlocks.flatMap(block => ['heading', 'text'].includes(block.type) ? [block.content]
        : block.type === 'list' ? block.items.map(item => item.content)
          : block.type === 'metric_group' ? block.metrics.map(metric => `${metric.label} ${String(metric.value)}${metric.unit ? ` ${metric.unit}` : ''}`) : [])
      const actualTexts = elements.filter(element => element.type === 'text').map(element => element.payload.kind === 'metric'
        ? `${element.payload.label} ${String(element.payload.value)}${element.payload.unit ? ` ${element.payload.unit}` : ''}` : element.payload.content)
      assert.deepEqual(actualTexts.sort(), expectedTexts.sort(), 'default layout dropped a paragraph, list item, heading or metric')
      plans.push({ pageId: page.id, elements })
    } catch (error) { failures.push({ pageId: page.id, code: error.code, message: error.message }) }
    if ((plans.length + failures.length) % 15 === 0) console.log(`Checked ${plans.length + failures.length}/${imported.snapshot.pages.length} pages`)
  }
  if (noBrowser) {
    const texts = plans.flatMap(plan => plan.elements.filter(element => element.type === 'text'))
    const summary = { pageCount: imported.snapshot.pages.length, generated: plans.length, layoutRoot, failures,
      imageCount: plans.reduce((sum, plan) => sum + plan.elements.filter(element => element.type === 'image').length, 0),
      minimumFontSize: Math.min(...texts.map(element => element.style.fontSize)), maximumTextFrameBottom: Math.max(...texts.map(element => element.frame.y + element.frame.height)),
      longestPage: plans.map(plan => ({ pageId: plan.pageId, characters: plan.elements.filter(element => element.type === 'text').reduce((sum, element) => sum + String(element.payload.content ?? '').length, 0) })).sort((a, b) => b.characters - a.characters)[0] }
    console.log(JSON.stringify(summary, null, 2))
    assert.equal(failures.length, 0, 'layout verification failed')
  } else {
  console.log(`Generated ${plans.length}/${imported.snapshot.pages.length} fresh layouts; checking browser geometry and image decoding`)
  const markup = plans.map(plan => `<section data-page-id="${plan.pageId}" class="layout-canvas" style="position:relative;width:1600px;height:900px">${plan.elements.map(context.elementHtml).join('')}</section>`).join('')
  const html = `<!doctype html><meta charset="utf-8"><style>${appCss}\n${layoutCss}</style><body>${markup}<script>
    window.addEventListener('load', async () => {
      await document.fonts.ready;
      const textOverflow = [], outsideCanvas = [], brokenImages = [], imageFrameMismatch = [];
      for (const page of document.querySelectorAll('[data-page-id]')) {
        for (const element of page.querySelectorAll('.layout-element')) {
          const id = element.dataset.layoutElement;
          if (element.offsetTop + element.offsetHeight > 900 || element.offsetLeft + element.offsetWidth > 1600) outsideCanvas.push({pageId:page.dataset.pageId,id});
          const text = element.querySelector('.layout-text-content');
          if (text && (text.scrollHeight > text.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1)) textOverflow.push({pageId:page.dataset.pageId,id,height:text.clientHeight,scrollHeight:text.scrollHeight});
          const image = element.querySelector('img');
          if (image && (!image.complete || !image.naturalWidth)) brokenImages.push({pageId:page.dataset.pageId,id});
          if (image && (Math.abs(image.offsetWidth - element.clientWidth) > 1 || Math.abs(image.offsetHeight - element.clientHeight) > 1)) {
            imageFrameMismatch.push({pageId:page.dataset.pageId,id,frameWidth:element.clientWidth,frameHeight:element.clientHeight,imageWidth:image.offsetWidth,imageHeight:image.offsetHeight});
          }
        }
      }
      document.body.setAttribute('data-layout-audit', encodeURIComponent(JSON.stringify({textOverflow,outsideCanvas,brokenImages,imageFrameMismatch})));
    });
  </script></body>`
  server = http.createServer(async (request, response) => {
    try {
      const match = /^\/api\/assets\/([^/]+)\/content$/.exec(request.url)
      if (match) return await serveReferencedAsset({ repository, assetId: decodeURIComponent(match[1]), response })
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(html)
    } catch (error) { response.writeHead(500); response.end(error.message) }
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const { stdout } = await promisify(execFile)(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(temporary, 'browser')}`, '--dump-dom', '--virtual-time-budget=5000', `http://127.0.0.1:${server.address().port}/`],
  { windowsHide: true, timeout: 60000, maxBuffer: 24 * 1024 * 1024 })
  const matched = /data-layout-audit="([^"]+)"/.exec(stdout)
  assert.ok(matched, 'browser did not complete layout measurement')
  const browser = JSON.parse(decodeURIComponent(matched[1]))
  const summary = { pageCount: imported.snapshot.pages.length, generated: plans.length, layoutRoot, failures, ...browser }
  console.log(JSON.stringify(summary, null, 2))
  assert.equal(failures.length + browser.textOverflow.length + browser.outsideCanvas.length + browser.brokenImages.length + browser.imageFrameMismatch.length, 0, 'layout verification failed')
  }
} finally {
  if (server) await new Promise(resolveClose => server.close(resolveClose))
  await repository.close()
  assert.equal(dirname(temporary), resolve(tmpdir()))
  await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 })
}
