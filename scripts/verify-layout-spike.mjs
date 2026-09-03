#!/usr/bin/env node
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function freePort() {
  const server = net.createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const port = server.address().port
  await new Promise(resolvePromise => server.close(resolvePromise))
  return port
}

function findBrowser() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (!probe.error && probe.status === 0) return candidate
  }
  throw new Error('Chromium/Chrome not found; set CHROMIUM_PATH')
}

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://layout-spike.local')
      let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html'
      const target = resolve(repositoryRoot, relativePath)
      if (target !== repositoryRoot && !target.startsWith(`${repositoryRoot}${sep}`)) {
        response.writeHead(403).end('forbidden')
        return
      }
      const body = await readFile(target)
      response.writeHead(200, {
        'content-type': mimeTypes[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      })
      response.end(body)
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end(error?.message ?? 'error')
    }
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  return { server, port: server.address().port }
}

async function waitForJson(url, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'unavailable'}`)
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  const runtimeErrors = []
  let nextId = 1
  const ready = new Promise((resolvePromise, reject) => {
    socket.onopen = resolvePromise
    socket.onerror = reject
  })

  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`))
      else request.resolve(message.result)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails)
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') runtimeErrors.push(message.params.entry)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') runtimeErrors.push(message.params)
  }

  async function send(method, params = {}) {
    await ready
    return new Promise((resolvePromise, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolvePromise, reject, method })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'browser evaluation failed')
    return result.result.value
  }

  return { send, evaluate, runtimeErrors, close: () => socket.close() }
}

async function waitFor(cdp, expression, description, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(`Boolean(${expression})`)) return
    } catch {}
    await delay(80)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function dragElement(cdp, layoutElementId) {
  const rect = await cdp.evaluate(`(() => {
    const node = document.querySelector('[data-element-id="${layoutElementId}"]')
    if (!node) return null
    const box = node.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height }
  })()`)
  assert.ok(rect?.width > 0 && rect?.height > 0, `missing draggable element ${layoutElementId}`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + 70, y: rect.y + 34, button: 'left', buttons: 1 })
  await delay(80)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 70, y: rect.y + 34, button: 'left', buttons: 0, clickCount: 1 })
}

const staticHost = await startStaticServer()
const browserProfile = await mkdtemp(join(tmpdir(), 'report-studio-layout-spike-browser-'))
const debuggingPort = await freePort()
const browser = spawn(findBrowser(), [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${browserProfile}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let cdp
try {
  await waitForJson(`http://127.0.0.1:${debuggingPort}/json/version`)
  const targets = await waitForJson(`http://127.0.0.1:${debuggingPort}/json/list`)
  const page = targets.find(target => target.type === 'page')
  assert.ok(page, 'Chromium page target unavailable')
  cdp = createCdpClient(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  const results = []
  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${staticHost.port}/tools/layout-spike/` })
    await waitFor(cdp, `document.readyState === 'complete' && window.__layoutSpikeReady === true`, `layout spike ${viewport.width}x${viewport.height}`)

    const initial = await cdp.evaluate(`window.__layoutSpike.getState()`)
    const first = initial.renderPlan.elements[0]
    const viewportState = await cdp.evaluate(`window.__layoutSpike.getViewportState()`)
    assert.equal(viewportState.horizontalOverflow, false, `${viewport.width}x${viewport.height} has horizontal overflow`)
    assert.equal(initial.renderPlan.elements.length, 4)
    assert.deepEqual((await cdp.evaluate(`window.__layoutSpike.getSerialized()`)).changes, [])

    await dragElement(cdp, first.layoutElementId)
    await waitFor(cdp, `window.__layoutSpike.getSerialized().changes.length === 1`, 'drag frame serialization')
    const moved = await cdp.evaluate(`window.__layoutSpike.getState()`)
    const serialized = await cdp.evaluate(`window.__layoutSpike.getSerialized()`)
    const movedIds = moved.renderPlan.elements.map(element => element.layoutElementId)
    const changedIds = serialized.changes.map(change => change.layoutElementId)
    assert.equal(
      serialized.changes[0].layoutElementId,
      first.layoutElementId,
      `drag changed the wrong element; initial=${first.layoutElementId} changed=${JSON.stringify(changedIds)} present=${JSON.stringify(movedIds)}`,
    )
    const movedFirst = moved.renderPlan.elements.find(element => element.layoutElementId === first.layoutElementId)
    assert.ok(movedFirst, `dragged element disappeared; expected=${first.layoutElementId} present=${JSON.stringify(movedIds)}`)
    assert.notEqual(movedFirst.frame.x, first.frame.x)
    assert.notEqual(movedFirst.frame.y, first.frame.y)
    assert.deepEqual(Object.keys(serialized.changes[0]).sort(), ['frame', 'layoutElementId'])

    await cdp.send('Page.reload', { ignoreCache: true })
    await waitFor(cdp, `document.readyState === 'complete' && window.__layoutSpikeReady === true`, 'layout spike reload')
    const reset = await cdp.evaluate(`window.__layoutSpike.getState()`)
    const resetFirst = reset.renderPlan.elements.find(element => element.layoutElementId === first.layoutElementId)
    assert.ok(resetFirst, `reloaded fixture lost element ${first.layoutElementId}`)
    assert.deepEqual(resetFirst.frame, first.frame)
    assert.deepEqual((await cdp.evaluate(`window.__layoutSpike.getSerialized()`)).changes, [])

    results.push(`${viewport.width}x${viewport.height}@${Math.round(viewportState.scale * 100)}%`)
  }

  assert.deepEqual(cdp.runtimeErrors, [], JSON.stringify(cdp.runtimeErrors, null, 2))
  console.log('REPORT_STUDIO_LAYOUT_SPIKE_PASS')
  console.log(`viewports=${results.join(',')}`)
  console.log('drag=PASS frame-only-serialization=PASS reload-reset=PASS')
} finally {
  cdp?.close()
  if (browser.exitCode === null) {
    browser.kill('SIGTERM')
    await Promise.race([
      new Promise(resolvePromise => browser.once('exit', resolvePromise)),
      delay(3000),
    ])
    if (browser.exitCode === null) browser.kill('SIGKILL')
  }
  await new Promise(resolvePromise => staticHost.server.close(resolvePromise))
  await rm(browserProfile, { recursive: true, force: true })
}
