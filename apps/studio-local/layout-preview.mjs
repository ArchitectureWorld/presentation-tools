import { analyzeLayoutQuality, observeLayoutQuality } from '../../packages/studio-layout-core/layout-quality.mjs'
import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { chromium } from 'playwright-core'
import { imageDimensions, MAX_ASSET_BYTES } from './asset-service.mjs'
import { renderLayoutElements } from './public/layout-renderer.js'
import { createPreviewFingerprint, PREVIEW_CHECKS_VERSION } from '../../packages/studio-layout-core/preview-fingerprint.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const hashPattern = /^[a-f0-9]{64}$/
const error = (code, message) => Object.assign(new Error(message), { code })
const rendererSource = new URL('./public/layout-renderer.js', import.meta.url)

export function previewBrowserCandidates(platform = process.platform, explicit) {
  return explicit ? [explicit] : platform === 'win32' ? [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ] : platform === 'darwin' ? [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
}

async function executablePath(explicit) {
  // Linux Edge can stall during cold launch; prefer the verified native Chrome runtime.
  // Explicit configuration remains authoritative and never silently switches browsers.
  for (const candidate of previewBrowserCandidates(process.platform, explicit)) {
    try { await access(candidate, constants.F_OK); return candidate } catch {}
  }
  throw error('preview_browser_missing', '预览需要已安装的 Edge 或 Chromium；请配置 browserExecutable。')
}

function hasResourceUrl(value) {
  if (typeof value === 'string') return /(?:[a-z][a-z\d+.-]*:|\/\/|url\s*\(|@import|\\)/i.test(value)
  if (Array.isArray(value)) return value.some(hasResourceUrl)
  return value && typeof value === 'object' ? Object.values(value).some(hasResourceUrl) : false
}

function hasExternalLocation(value) {
  if (typeof value === 'string') return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value.trim())
  return value && typeof value === 'object' ? Object.values(value).some(hasExternalLocation) : false
}

export function createLayoutPreviewRenderer({ browserExecutable, timeoutMs = 30_000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive')
  return { async render(input) {
    const { signal, readAsset } = input
    if (signal?.aborted) throw error('preview_cancelled', '预览已取消。')
    // Freeze caller data before awaiting I/O. A callback receives a copy of the exact allowed objectRef.
    const { layout, renderPlan, pageAssets = [], candidateSha } = structuredClone({ layout: input.layout, renderPlan: input.renderPlan, pageAssets: input.pageAssets, candidateSha: input.candidateSha })
    const canvas = { width: renderPlan?.canvas?.width, height: renderPlan?.canvas?.height }
    if (![canvas.width, canvas.height].every(n => Number.isInteger(n) && n > 0 && n <= 16_384) || canvas.width * canvas.height > 100_000_000 || !hashPattern.test(candidateSha ?? '') || !/^(?:sha256:)?[a-f0-9]{64}$/.test(layout?.sourceStateHash ?? '')) {
      throw error('preview_invalid_input', '预览需要有效画布、冻结候选 SHA 和来源状态 SHA。')
    }
    const checks = { blockers: [], warnings: [] }
    const deadline = Date.now() + timeoutMs
    const block = (code, detail = {}) => checks.blockers.push({ code, ...detail })
    let browser, browserPromise, stopped = false, stopReason
    let stop
    const cancelled = new Promise((_, reject) => { stop = reason => { if (!stopReason) { stopReason = reason; reject(reason) } } })
    // A handler is installed immediately, including the pre-browser validation phase.
    cancelled.catch(() => {})
    const onAbort = () => stop(error('preview_cancelled', '预览已取消。'))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    const timer = setTimeout(() => stop(error('preview_timeout', '预览超时。')), timeoutMs)
    const wait = promise => Promise.race([promise, cancelled])
    try {
      const executable = await wait(executablePath(browserExecutable))
      const [baseCss, layoutCss, source, hostSource, qualitySource] = await wait(Promise.all([
        readFile(new URL('./public/styles.css', import.meta.url)),
        readFile(new URL('./public/layout.css', import.meta.url)),
        readFile(rendererSource), readFile(new URL(import.meta.url)), readFile(new URL('../../packages/studio-layout-core/layout-quality.mjs', import.meta.url)),
      ]))
      const cssSha256 = sha256(Buffer.concat([baseCss, layoutCss]))
      const rendererVersion = `layout-renderer-v1:${sha256(Buffer.concat([source, hostSource, qualitySource, baseCss, layoutCss]))}`
      const materials = pageAssets.map(asset => ({ pageAssetId: asset.pageAssetId, assetId: asset.assetId, sha256: asset.objectRef?.sha256, mimeType: asset.objectRef?.mimeType }))
        .sort((a, b) => compare(a.pageAssetId, b.pageAssetId) || compare(a.assetId, b.assetId))
      const byId = new Map()
      for (const asset of pageAssets) {
        if (byId.has(asset.assetId)) {
          const old = byId.get(asset.assetId)
          if (old.objectRef?.sha256 !== asset.objectRef?.sha256 || old.objectRef?.mimeType !== asset.objectRef?.mimeType) throw error('preview_invalid_input', '同一素材 ID 对应了不一致的对象。')
        }
        if (!asset.pageAssetId || !asset.assetId || !hashPattern.test(asset.objectRef?.sha256 ?? '') || !asset.objectRef?.mimeType) throw error('preview_invalid_input', '本页素材对象引用不完整。')
        byId.set(asset.assetId, asset)
      }
      const routes = new Map()
      const imagePaths = new Map()
      if (!Array.isArray(renderPlan.elements) || renderPlan.elements.length > 1000) throw error('preview_invalid_input', '预览最多支持1000个元素。')
      for (const element of renderPlan.elements ?? []) {
        if (!element.frame || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(element.frame[key])) || element.frame.width <= 0 || element.frame.height <= 0) throw error('preview_invalid_input', '排版元素缺少有效几何。')
        if (hasResourceUrl(element.style) || (element.type === 'image' && hasResourceUrl(Object.fromEntries(Object.entries(element.payload ?? {}).filter(([key]) => !['caption', 'originalFileName', 'label'].includes(key)))))) {
          block('external_resource_rejected', { layoutElementId: element.layoutElementId })
        }
        if (element.type !== 'image') continue
        const asset = byId.get(element.payload?.assetId)
        if (!asset) { block('asset_not_allowed', { layoutElementId: element.layoutElementId }); continue }
        const ref = asset.objectRef
        if (hasExternalLocation(ref)) {
          block('external_resource_rejected', { assetId: asset.assetId }); continue
        }
        if (!['image/png', 'image/jpeg'].includes(ref.mimeType)) {
          block('asset_mime_rejected', { layoutElementId: element.layoutElementId, assetId: asset.assetId }); continue
        }
        if (!Number.isSafeInteger(ref.sizeBytes) || ref.sizeBytes <= 0 || ref.sizeBytes > MAX_ASSET_BYTES) {
          block('asset_size_invalid', { assetId: asset.assetId }); continue
        }
        const route = `/assets/${ref.sha256}`
        if (!routes.has(route)) {
          let bytes
          try { bytes = await wait(Promise.resolve().then(() => readAsset(structuredClone(ref)))) } catch (failure) {
            if (stopReason) throw stopReason
            block('asset_read_failed', { assetId: asset.assetId }); continue
          }
          if (!Buffer.isBuffer(bytes) || bytes.length !== ref.sizeBytes || sha256(bytes) !== ref.sha256) { block('asset_hash_mismatch', { assetId: asset.assetId }); continue }
          const dimensions = imageDimensions(ref.mimeType, bytes)
          if (!dimensions || !dimensions.widthPx || !dimensions.heightPx || dimensions.widthPx > 16_384 || dimensions.heightPx > 16_384 || dimensions.widthPx * dimensions.heightPx > 100_000_000) { block('asset_mime_mismatch', { assetId: asset.assetId }); continue }
          routes.set(route, { type: ref.mimeType, bytes })
        } else if (routes.get(route).type !== ref.mimeType) { block('asset_mime_mismatch', { assetId: asset.assetId }); continue }
        else if (routes.get(route).bytes.length !== ref.sizeBytes) { block('asset_hash_mismatch', { assetId: asset.assetId }); continue }
        const image = routes.get(route)
        imagePaths.set(element.layoutElementId, `data:${image.type};base64,${image.bytes.toString('base64')}`)
      }
      const markup = renderLayoutElements(renderPlan, { assetUrl: element => imagePaths.get(element.layoutElementId) ?? '', selectedId: null, editable: false })
      // Only verified in-memory bytes reach the browser. No loopback socket or external request is needed.
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>${baseCss}</style><style>${layoutCss}</style></head><body><div class="layout-canvas" data-layout-canvas style="width:${canvas.width}px;height:${canvas.height}px">${markup}</div></body></html>`
      browserPromise = chromium.launch({ executablePath: executable, headless: true, timeout: Math.max(1, deadline - Date.now()), args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check'] })
      browser = await wait(browserPromise)
      const context = await wait(browser.newContext({ viewport: canvas, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' }))
      await wait(context.route('**/*', route => { block('external_resource_rejected'); return route.abort('blockedbyclient') }))
      const page = await wait(context.newPage())
      page.on('requestfailed', () => block('asset_load_failed'))
      await wait(page.setContent(html, { waitUntil: 'load', timeout: timeoutMs }))
      await wait(page.mouse.move(canvas.width + 1, canvas.height + 1))
      const observed = await wait(page.evaluate(async () => {
        await document.fonts.ready
        const failures = []
        await Promise.all([...document.images].map(async image => {
          try { await image.decode(); if (!image.naturalWidth || !image.naturalHeight) throw new Error('empty image') } catch { failures.push({ code: 'asset_decode_failed', layoutElementId: image.closest('[data-layout-element]').dataset.layoutElement }) }
        }))
        const canvasNode = document.querySelector('[data-layout-canvas]')
        const canvasBounds = canvasNode.getBoundingClientRect()
        for (const node of canvasNode.querySelectorAll('[data-layout-element]')) {
          const bounds = node.getBoundingClientRect()
          const id = node.dataset.layoutElement
          if (bounds.left < canvasBounds.left - 0.5 || bounds.top < canvasBounds.top - 0.5 || bounds.right > canvasBounds.right + 0.5 || bounds.bottom > canvasBounds.bottom + 0.5) failures.push({ code: 'element_out_of_bounds', layoutElementId: id })
          for (const text of node.querySelectorAll(':scope > .layout-text-content, :scope > span')) {
            if (!text.textContent.trim()) continue
            // Local, unrotated offsets detect clipping by the parent grid frame,
            // including centered span labels whose own scroll box does not overflow.
            const parentClips = text.offsetParent === node && (text.offsetLeft < -1 || text.offsetTop < -1 || text.offsetLeft + text.offsetWidth > node.clientWidth + 1 || text.offsetTop + text.offsetHeight > node.clientHeight + 1)
            if (parentClips || text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1) failures.push({ code: 'text_overflow', layoutElementId: id, scrollWidth: text.scrollWidth, scrollHeight: text.scrollHeight, clientWidth: text.clientWidth, clientHeight: text.clientHeight, frameWidth: node.clientWidth, frameHeight: node.clientHeight })
            const textStyle = getComputedStyle(text)
            const transparentColor = textStyle.color === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(textStyle.color)
            let hidden = transparentColor || ['hidden', 'collapse'].includes(textStyle.visibility) || ![...text.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)
            for (let ancestor = text; ancestor; ancestor = ancestor.parentElement) {
              const style = getComputedStyle(ancestor)
              if (style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) hidden = true
              if (ancestor === canvasNode) break
            }
            if (hidden) failures.push({ code: 'text_not_visible', layoutElementId: id })
          }
        }
        return failures
      }))
      checks.blockers.push(...observed)
      const metrics = await wait(page.evaluate(observeLayoutQuality))
      const quality = analyzeLayoutQuality({renderPlan, ...metrics, constraints: input.designIntent?.constraints ?? {}})
      checks.blockers.push(...quality.blockers); checks.warnings.push(...quality.warnings)
      const cdp = await wait(context.newCDPSession(page))
      await wait(cdp.send('DOM.enable'))
      await wait(cdp.send('CSS.enable'))
      const { root } = await wait(cdp.send('DOM.getDocument'))
      const { nodeIds } = await wait(cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.layout-text-content, .layout-element > span' }))
      const usedFonts = new Map()
      for (const nodeId of nodeIds) {
        const { fonts } = await wait(cdp.send('CSS.getPlatformFontsForNode', { nodeId }))
        for (const font of fonts) usedFonts.set(font.familyName, { family: font.familyName, custom: font.isCustomFont, postScriptName: font.postScriptName ?? null })
      }
      // These hashes bind observed system-font descriptors and the render environment,
      // not the bytes of user-installed font files. No profiles or font files are read.
      const fonts = [...usedFonts.values()].sort((a, b) => compare(a.family, b.family)).map(font => ({ family: font.family, sha256: sha256(JSON.stringify({ ...font, cssSha256, platform: process.platform, browserVersion: browser.version() })) }))
      const png = await wait(page.locator('[data-layout-canvas]').screenshot({ type: 'png', animations: 'disabled', timeout: timeoutMs }))
      const fingerprintInputs = { candidateSha, sha256: sha256(png), rendererVersion, canvas, fonts, materials, checksVersion: PREVIEW_CHECKS_VERSION, sourceStateHash: layout.sourceStateHash }
      return { png, ...fingerprintInputs, fingerprint: createPreviewFingerprint(fingerprintInputs), fingerprintInputs, checks }
    } catch (failure) {
      if (stopReason) throw stopReason
      if (failure.name === 'TimeoutError') throw error('preview_timeout', '预览超时。')
      if (!failure.code) throw error('preview_render_failed', `预览渲染失败：${failure.message}`)
      throw failure
    } finally {
      stopped = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      // A launch that finishes during cancellation still belongs to this renderer.
      if (!browser && browserPromise) browser = await browserPromise.catch(() => null)
      await browser?.close()
    }
  } }
}
