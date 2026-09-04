import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  createOpenPencilEngineBinding,
  mapOpenPencilSelection,
} from '../../packages/studio-layout-openpencil/index.mjs'
import { validateRealExecutionResult } from '../../packages/studio-layout-openpencil-runtime/index.mjs'
import { resolveInstalledRuntime, runRealCreateSmoke } from './runtime-harness.mjs'

const OWNER_SESSION_ID = 'report-studio-browser-smoke'

function sha256Text(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': body.byteLength,
  })
  response.end(body)
}

async function proxyJson(url, { method = 'GET', origin, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `OpenPencil request failed (${response.status})`)
  return value
}

export async function closeBrowserHarnessResources({ detachRoute, controller, server }) {
  const errors = []
  try {
    detachRoute?.()
  } catch (error) {
    errors.push(error)
  }
  try {
    await controller?.dispose()
  } catch (error) {
    errors.push(error)
  }
  try {
    if (server?.listening) {
      await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
    }
  } catch (error) {
    errors.push(error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'OpenPencil browser harness cleanup failed')
}

export function renderBrowserHostPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Report Studio OpenPencil Browser Smoke</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; font-family: Arial, sans-serif; background: #f4f6f8; color: #17202a; }
    body { display: grid; grid-template-rows: 44px minmax(0, 1fr) 132px; }
    header { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #c8d0d8; background: #fff; }
    button { min-height: 30px; padding: 4px 10px; border: 1px solid #aeb8c2; border-radius: 4px; background: #fff; color: #17202a; cursor: pointer; }
    button:disabled { cursor: default; opacity: .45; }
    #phase { margin-left: auto; font: 12px Consolas, monospace; }
    main { min-height: 0; padding: 8px; }
    iframe { width: 100%; height: 100%; border: 1px solid #9aa6b2; background: #fff; }
    pre { margin: 0; overflow: auto; padding: 8px 10px; border-top: 1px solid #c8d0d8; background: #111820; color: #d7e0e8; font: 11px/1.35 Consolas, monospace; }
  </style>
</head>
<body>
  <header>
    <button type="button" data-testid="refresh-selection">Selection</button>
    <button type="button" data-testid="save-document">Save</button>
    <button type="button" data-testid="reopen-document" disabled>Close + Reopen</button>
    <span id="phase">launching</span>
  </header>
  <main><iframe allow="local-fonts" data-testid="editor-frame" title="OpenPencil managed editor"></iframe></main>
  <pre data-testid="smoke-state"></pre>
  <script>
    const frame = document.querySelector('[data-testid="editor-frame"]')
    const stateNode = document.querySelector('[data-testid="smoke-state"]')
    const phaseNode = document.querySelector('#phase')
    const reopenButton = document.querySelector('[data-testid="reopen-document"]')
    const state = {
      phase: 'launching', ready: false, dirty: false, generation: 0, revision: 0,
      selectedIds: [], mappedLayoutElementIds: [], eventTypes: [], saves: 0, reopens: 0, errors: [],
    }
    let launch
    let editorOrigin
    let initTimer
    let successorLaunchUrl
    const snapshotWaiters = new Map()

    function render() {
      phaseNode.textContent = state.phase + (state.dirty ? ' / dirty' : '')
      stateNode.textContent = JSON.stringify(state, null, 2)
      document.body.dataset.phase = state.phase
      document.body.dataset.dirty = String(state.dirty)
      document.body.dataset.selectionCount = String(state.selectedIds.length)
    }

    function fail(error) {
      state.phase = 'error'
      state.errors.push(error instanceof Error ? error.message : String(error))
      render()
    }

    function post(message) {
      if (!launch || !editorOrigin || !frame.contentWindow) return
      frame.contentWindow.postMessage(JSON.stringify(message), editorOrigin)
    }

    function stopInit() {
      if (initTimer !== undefined) window.clearInterval(initTimer)
      initTimer = undefined
    }

    function sendInit() {
      post({ type: 'op-bridge/init', token: launch.token })
      post({ type: 'op-bridge/theme', colorScheme: 'light' })
      post({ type: 'op-bridge/locale', locale: 'en-US' })
    }

    function startInit() {
      stopInit()
      sendInit()
      initTimer = window.setInterval(sendInit, 500)
    }

    async function requestLaunch(url = '/__smoke/launch') {
      state.phase = 'launching'
      state.ready = false
      render()
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: '${OWNER_SESSION_ID}' }),
      })
      if (!response.ok) throw new Error('Managed editor launch failed (' + response.status + ')')
      launch = await response.json()
      editorOrigin = new URL(launch.iframeUrl).origin
      const iframeUrl = new URL(launch.iframeUrl)
      iframeUrl.searchParams.set('theme', 'light')
      iframeUrl.searchParams.set('locale', 'en-US')
      frame.src = iframeUrl.href
      state.phase = 'loading'
      render()
      startInit()
    }

    async function refreshSelection() {
      if (!launch?.selectionUrl) return
      const response = await fetch(launch.selectionUrl, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('Selection request failed (' + response.status + ')')
      const value = await response.json()
      state.selectedIds = value.selection?.selectedIds ?? value.selectedIds ?? []
      const mappedResponse = await fetch('/__smoke/map-selection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectedIds: state.selectedIds }),
      })
      if (!mappedResponse.ok) throw new Error('Selection mapping failed (' + mappedResponse.status + ')')
      const mapped = await mappedResponse.json()
      state.mappedLayoutElementIds = mapped.layoutElementIds
      render()
    }

    function requestSnapshot() {
      const requestId = 'browser-smoke-' + Date.now()
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          snapshotWaiters.delete(requestId)
          reject(new Error('OpenPencil snapshot timed out'))
        }, 8000)
        snapshotWaiters.set(requestId, value => {
          window.clearTimeout(timeout)
          resolve(value)
        })
        post({ type: 'op-bridge/snapshot', purpose: 'save', requestId })
      })
    }

    async function saveDocument() {
      if (!launch) return
      state.phase = 'saving'
      render()
      const snapshot = await requestSnapshot()
      const response = await fetch(launch.saveUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: launch.sessionId,
          docJson: snapshot.docJson,
          generation: snapshot.generation,
          revision: snapshot.revision,
        }),
      })
      if (!response.ok) throw new Error('Save failed (' + response.status + ')')
      const value = await response.json()
      successorLaunchUrl = value.editor?.launchUrl
      if (!successorLaunchUrl) throw new Error('Save omitted successor launch capability')
      post({ type: 'op-bridge/save-committed', generation: snapshot.generation, revision: snapshot.revision })
      state.saves += 1
      state.dirty = false
      state.phase = 'ready'
      reopenButton.disabled = false
      render()
    }

    async function closeAndReopen() {
      if (!launch || !successorLaunchUrl) return
      stopInit()
      const closeUrl = launch.closeUrl
      frame.src = 'about:blank'
      await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
      await fetch(closeUrl, { method: 'DELETE', credentials: 'same-origin' })
      const next = successorLaunchUrl
      launch = undefined
      successorLaunchUrl = undefined
      reopenButton.disabled = true
      state.reopens += 1
      await requestLaunch(next)
    }

    window.addEventListener('message', event => {
      if (!launch || event.source !== frame.contentWindow || event.origin !== editorOrigin || typeof event.data !== 'string') return
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (!message || typeof message.type !== 'string') return
      state.eventTypes.push(message.type)
      switch (message.type) {
        case 'op-bridge/listening':
          sendInit()
          break
        case 'op-bridge/ready':
          stopInit()
          state.generation = message.generation
          state.revision = message.revision
          post({ type: 'op-bridge/open-document', json: launch.docJson })
          break
        case 'op-bridge/opened':
          state.phase = 'ready'
          state.ready = true
          state.generation = message.generation
          break
        case 'op-bridge/dirty-changed':
          state.dirty = message.dirty
          state.generation = message.generation
          state.revision = message.revision
          break
        case 'op-bridge/snapshot-result':
          snapshotWaiters.get(message.requestId)?.(message)
          snapshotWaiters.delete(message.requestId)
          break
        case 'op-bridge/snapshot-conflict':
          fail(new Error('Snapshot conflict at server version ' + message.serverVersion))
          break
      }
      render()
    })

    document.querySelector('[data-testid="refresh-selection"]').addEventListener('click', () => refreshSelection().catch(fail))
    document.querySelector('[data-testid="save-document"]').addEventListener('click', () => saveDocument().catch(fail))
    reopenButton.addEventListener('click', () => closeAndReopen().catch(fail))
    window.__OPENPENCIL_SMOKE__ = { state }
    render()
    requestLaunch().catch(fail)
  </script>
</body>
</html>`
}

export async function startBrowserSmokeHarness({
  runtimeRoot,
  documentsDir,
  profileName = 'compat-smoke',
  signal = AbortSignal.timeout(90_000),
}) {
  const created = await runRealCreateSmoke({ runtimeRoot, documentsDir, profileName, signal })
  validateRealExecutionResult(created.transaction, created.execution.result.build, {
    real: true,
    runtime: 'dsh-openpencil',
    capability: 'batch_design',
  })
  const binding = createOpenPencilEngineBinding(created.transaction, created.execution.result.build, {
    layoutPageId: created.fixture.renderPlan.layoutPageId,
    engineDocumentRef: {
      provider: 'openpencil',
      documentId: created.fixture.documentPath,
      contentHash: null,
    },
    generatedFromRevision: 0,
    sourceStateHash: sha256Text(JSON.stringify(created.fixture.renderPlan)),
  })

  const installed = resolveInstalledRuntime(runtimeRoot, profileName)
  const editorHost = await import(pathToFileURL(installed.editorHostModule).href)
  const controller = new editorHost.EditorHostController(randomBytes(32))
  let detachRoute = () => {}
  let grant
  let origin
  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', origin ?? 'http://127.0.0.1')
      if (request.method === 'GET' && requestUrl.pathname === '/') {
        const body = Buffer.from(renderBrowserHostPage())
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': body.byteLength,
        })
        response.end(body)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
        response.writeHead(204, { 'cache-control': 'no-store' })
        response.end()
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/__smoke/launch') {
        const launch = await proxyJson(`${origin}${grant.launchUrl}`, {
          method: 'POST',
          origin,
          body: { sessionId: OWNER_SESSION_ID },
        })
        sendJson(response, 200, launch)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/__smoke/map-selection') {
        const body = await readJsonBody(request)
        if (!Array.isArray(body.selectedIds) || body.selectedIds.some(value => typeof value !== 'string')) {
          sendJson(response, 400, { error: 'selectedIds must be an array of strings' })
          return
        }
        sendJson(response, 200, mapOpenPencilSelection(binding, body.selectedIds))
        return
      }
      await controller.handle(request, response)
    })().catch(error => {
      if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      else response.end()
    })
  })

  try {
    detachRoute = controller.attachRoute()
    const sourceBytes = await readFile(created.fixture.documentPath)
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex')
    grant = controller.grantFor(created.fixture.documentPath, sourceHash)
    if (!grant) throw new Error('OpenPencil browser smoke could not issue an editor grant')
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Browser smoke server did not expose a port')
    origin = `http://127.0.0.1:${address.port}`
  } catch (error) {
    try {
      await closeBrowserHarnessResources({ detachRoute, controller, server })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'OpenPencil browser smoke startup and cleanup failed')
    }
    throw error
  }

  let closed = false
  return {
    origin,
    binding,
    documentPath: created.fixture.documentPath,
    async close() {
      if (closed) return
      closed = true
      await closeBrowserHarnessResources({ detachRoute, controller, server })
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const runtimeRoot = process.env.OPENPENCIL_RUNTIME_ROOT
  const documentsDir = process.env.OPENPENCIL_DOCUMENTS_DIR
  if (!runtimeRoot || !documentsDir) {
    console.error('OPENPENCIL_RUNTIME_ROOT and OPENPENCIL_DOCUMENTS_DIR are required')
    process.exit(2)
  }

  const harness = await startBrowserSmokeHarness({ runtimeRoot, documentsDir })
  console.log(JSON.stringify({
    origin: harness.origin,
    documentPath: harness.documentPath,
    nodeCount: harness.binding.nodeMap.length,
  }))

  const stop = async () => {
    await harness.close()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
