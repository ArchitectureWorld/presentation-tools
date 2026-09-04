import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  closeBrowserHarnessResources,
  renderBrowserHostPage,
  startBrowserSmokeHarness,
} from './browser-harness.mjs'

test('browser host page implements the managed editor bridge without embedding launch secrets', () => {
  const html = renderBrowserHostPage()

  assert.match(html, /op-bridge\/init/u)
  assert.match(html, /op-bridge\/open-document/u)
  assert.match(html, /op-bridge\/snapshot/u)
  assert.match(html, /__smoke\/map-selection/u)
  assert.match(html, /<iframe[^>]+allow="local-fonts"[^>]+data-testid="editor-frame"/u)
  assert.doesNotMatch(html, /token=[A-Za-z0-9_-]{16,}/u)
})

test('browser harness closes its listening server when controller disposal fails', async () => {
  const server = createServer((_request, response) => response.end('ok'))
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  let detached = false

  await assert.rejects(
    closeBrowserHarnessResources({
      detachRoute: () => { detached = true },
      controller: { dispose: async () => { throw new Error('dispose failed') } },
      server,
    }),
    /dispose failed/u,
  )

  assert.equal(detached, true)
  await assert.rejects(fetch(origin), /fetch failed/u)
})

test('real browser harness launches on loopback and returns a managed editor session', async t => {
  const runtimeRoot = process.env.OPENPENCIL_RUNTIME_ROOT
  if (!runtimeRoot) {
    t.skip('OPENPENCIL_RUNTIME_ROOT is required for the real browser host smoke')
    return
  }

  const documentsDir = await mkdtemp(join(runtimeRoot, 'rs-openpencil-browser-'))
  let harness
  try {
    harness = await startBrowserSmokeHarness({ runtimeRoot, documentsDir })
    assert.match(harness.origin, /^http:\/\/127\.0\.0\.1:\d+$/u)
    assert.equal((await fetch(harness.origin)).status, 200)
    assert.equal((await fetch(`${harness.origin}/favicon.ico`)).status, 204)

    const launchResponse = await fetch(`${harness.origin}/__smoke/launch`, {
      method: 'POST',
      headers: { origin: harness.origin },
    })
    assert.equal(launchResponse.status, 200)
    const launch = await launchResponse.json()
    assert.match(launch.iframeUrl, /^http:\/\/127\.0\.0\.1:\d+\//u)
    assert.equal(typeof launch.token, 'string')
    assert.equal(typeof launch.selectionUrl, 'string')

    const closeResponse = await fetch(`${harness.origin}${launch.closeUrl}`, {
      method: 'DELETE',
      headers: { origin: harness.origin },
    })
    assert.equal(closeResponse.status, 200)
  } finally {
    await harness?.close()
    await rm(documentsDir, { recursive: true, force: true })
  }
})
