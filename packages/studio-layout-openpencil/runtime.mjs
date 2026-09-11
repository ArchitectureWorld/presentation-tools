import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import {
  compileOpenPencilCreateTransaction,
  compileOpenPencilFramePatchTransaction,
  createOpenPencilEngineBinding,
  mapOpenPencilSelection,
} from './index.mjs'

export const PINNED_DSH_OPENPENCIL_VERSION = '0.1.0-rc.9'
export const PINNED_OPENPENCIL_REVISION = '20cf4316a4a4f56a653cadf627fb44c96bee09d2'
export const PINNED_OPENPENCIL_VERSION = '0.8.5'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const LAYOUT_PAGE_ID = 'layout_page_018f0000-0000-7000-8000-000000000001'
const TITLE_ELEMENT_ID = 'layout_element_018f0000-0000-7000-8000-000000000002'
const SHAPE_ELEMENT_ID = 'layout_element_018f0000-0000-7000-8000-000000000003'

export class OpenPencilRuntimeError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'OpenPencilRuntimeError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details = undefined) {
  throw new OpenPencilRuntimeError(code, message, details)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function defaultPackageRoot() {
  const configured = String(process.env.REPORT_STUDIO_OPENPENCIL_PACKAGE_ROOT ?? '').trim()
  if (configured) return resolve(configured)
  try {
    const require = createRequire(import.meta.url)
    return dirname(require.resolve('@zseven-w/dsh-openpencil/package.json'))
  } catch (error) {
    fail('layout_engine_unavailable', 'Pinned @zseven-w/dsh-openpencil runtime is not installed.', {
      package: `@zseven-w/dsh-openpencil@${PINNED_DSH_OPENPENCIL_VERSION}`,
      cause: error?.message ?? String(error),
    })
  }
}

export async function resolveDshOpenPencilPackage({
  packageRoot = undefined,
  readText = path => readFile(path, 'utf8'),
  statPath = stat,
} = {}) {
  const root = resolve(packageRoot ?? await defaultPackageRoot())
  let packageJson
  let platforms
  try {
    packageJson = JSON.parse(await readText(join(root, 'package.json')))
    platforms = JSON.parse(await readText(join(root, 'platforms.json')))
  } catch (error) {
    fail('layout_engine_unavailable', 'Pinned OpenPencil package metadata is unavailable.', {
      root,
      cause: error?.message ?? String(error),
    })
  }

  if (packageJson?.name !== '@zseven-w/dsh-openpencil' || packageJson?.version !== PINNED_DSH_OPENPENCIL_VERSION) {
    fail('layout_engine_version_mismatch', 'Installed dsh-openpencil package does not match the Report Studio lock.', {
      expectedName: '@zseven-w/dsh-openpencil',
      expectedVersion: PINNED_DSH_OPENPENCIL_VERSION,
      actualName: packageJson?.name ?? null,
      actualVersion: packageJson?.version ?? null,
    })
  }
  if (platforms?.openPencil?.revision !== PINNED_OPENPENCIL_REVISION || platforms?.openPencil?.version !== PINNED_OPENPENCIL_VERSION) {
    fail('layout_engine_version_mismatch', 'Installed OpenPencil runtime revision does not match the Report Studio lock.', {
      expectedVersion: PINNED_OPENPENCIL_VERSION,
      expectedRevision: PINNED_OPENPENCIL_REVISION,
      actualVersion: platforms?.openPencil?.version ?? null,
      actualRevision: platforms?.openPencil?.revision ?? null,
    })
  }

  const editorHostModule = join(root, 'lib', 'editor-host.js')
  const editorRecoveryModule = join(root, 'lib', 'editor-recovery.js')
  for (const modulePath of [editorHostModule, editorRecoveryModule]) {
    try {
      const info = await statPath(modulePath)
      if (!info.isFile()) throw new Error('not a file')
    } catch (error) {
      fail('layout_engine_unavailable', 'Pinned dsh-openpencil managed runtime module is unavailable.', {
        modulePath,
        cause: error?.message ?? String(error),
      })
    }
  }

  return {
    root,
    packageVersion: packageJson.version,
    openPencilVersion: platforms.openPencil.version,
    openPencilRevision: platforms.openPencil.revision,
    editorHostModule,
    editorRecoveryModule,
  }
}

function runtimeRenderPlan() {
  return {
    layoutPageId: LAYOUT_PAGE_ID,
    projectId: 'project_runtime_smoke',
    pageId: 'page_runtime_smoke',
    canvas: { width: 1600, height: 900, unit: 'studio_unit' },
    elements: [
      {
        layoutElementId: SHAPE_ELEMENT_ID,
        type: 'shape',
        frame: { x: 72, y: 64, width: 1456, height: 772, rotation: 0 },
        style: { fill: '#f4f1eb', cornerRadius: 28, opacity: 1 },
        zIndex: 0,
        payload: { shapeKind: 'rectangle', label: 'Runtime background' },
      },
      {
        layoutElementId: TITLE_ELEMENT_ID,
        type: 'text',
        frame: { x: 120, y: 112, width: 1040, height: 104, rotation: 0 },
        style: { fontSize: 54, fontWeight: 700, textColor: '#17191d', opacity: 1 },
        zIndex: 10,
        payload: { content: 'Report Studio · OpenPencil Runtime', role: 'page_title' },
      },
    ],
  }
}

function findNode(value, nodeId) {
  if (!value || typeof value !== 'object') return null
  if (!Array.isArray(value) && value.id === nodeId) return value
  const children = Array.isArray(value)
    ? value
    : Object.values(value).filter(child => child && typeof child === 'object')
  for (const child of children) {
    const match = findNode(child, nodeId)
    if (match) return match
  }
  return null
}

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') fail('layout_engine_runtime_failed', 'Managed editor route did not expose a loopback port.')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server) {
  if (!server?.listening) return
  await new Promise(resolveClose => server.close(() => resolveClose()))
}

async function readJsonResponse(response, label) {
  const text = await response.text()
  if (!response.ok) fail('layout_engine_runtime_failed', `${label} failed (${response.status}).`, { response: text.slice(0, 8000) })
  try { return JSON.parse(text) }
  catch { fail('layout_engine_protocol_error', `${label} returned invalid JSON.`, { response: text.slice(0, 8000) }) }
}

function buildResultOf(batch) {
  const candidates = [batch?.result?.build, batch?.result?.build?.value, batch?.build, batch?.result]
  const result = candidates.find(value => value && typeof value === 'object' && Array.isArray(value.results))
  if (!result) {
    fail('layout_engine_protocol_error', 'Real batch_design did not return results[{binding,nodeId}].', {
      keys: batch && typeof batch === 'object' ? Object.keys(batch) : [],
      resultKeys: batch?.result && typeof batch.result === 'object' ? Object.keys(batch.result) : [],
    })
  }
  return result
}

export function assertOpenPencilRuntimeEvidence(evidence) {
  if (!evidence
    || evidence.status !== 'passed'
    || evidence.runtime !== 'openpencil-managed'
    || evidence.batchDesign !== true
    || evidence.managedEditor !== true
    || evidence.selectionMapped !== true
    || evidence.framePatch !== true
    || evidence.saved !== true
    || evidence.reopened !== true
    || !Number.isSafeInteger(evidence.bindingCount)
    || evidence.bindingCount < 1
    || !Number.isSafeInteger(evidence.width)
    || evidence.width <= 0
    || !Number.isSafeInteger(evidence.height)
    || evidence.height <= 0
    || !SHA256_PATTERN.test(String(evidence.documentSha256 ?? ''))
    || !SHA256_PATTERN.test(String(evidence.reopenedSha256 ?? ''))) {
    fail('layout_engine_protocol_error', 'Real OpenPencil managed runtime smoke returned incomplete evidence.', { evidence })
  }
  return structuredClone(evidence)
}

export async function executeManagedOpenPencilLifecycle({
  runtime,
  temporaryRoot,
  signal = new AbortController().signal,
} = {}) {
  if (!runtime?.editorHostModule || !runtime?.editorRecoveryModule || !temporaryRoot) {
    fail('layout_engine_protocol_error', 'Managed runtime lifecycle requires resolved module paths and an isolated temporary root.')
  }
  signal.throwIfAborted?.()

  const cacheBust = `${Date.now()}-${Math.random()}`
  let EditorHostController
  let EDITOR_ROUTE_PREFIX
  let readManagedDaemonDocument
  try {
    ;({ EditorHostController, EDITOR_ROUTE_PREFIX } = await import(`${pathToFileURL(runtime.editorHostModule).href}?rs=${cacheBust}`))
    ;({ readManagedDaemonDocument } = await import(`${pathToFileURL(runtime.editorRecoveryModule).href}?rs=${cacheBust}`))
  } catch (error) {
    fail('layout_engine_unavailable', 'Unable to load the pinned managed OpenPencil runtime.', {
      cause: error?.message ?? String(error),
    })
  }

  const documentPath = join(temporaryRoot, 'report-studio-runtime-smoke.op')
  const masterKey = Buffer.alloc(32, 29)
  let controller = new EditorHostController(masterKey)
  let detachRoute = null
  let server = null
  try {
    if (!controller.available) {
      fail('layout_engine_unavailable', 'Pinned OpenPencil platform package is unavailable for this operating system.', {
        runtimeRoot: runtime.root,
        runtimeError: controller.runtimeError?.message ?? null,
      })
    }

    const renderPlan = runtimeRenderPlan()
    const transaction = compileOpenPencilCreateTransaction(renderPlan)
    const batch = await controller.createDocumentBatch({
      script: transaction.operations,
      canvasWidth: renderPlan.canvas.width,
      canvasHeight: renderPlan.canvas.height,
      signal,
    })
    if (typeof batch?.documentJson !== 'string' || !batch.documentJson.trim()) {
      fail('layout_engine_protocol_error', 'Real batch_design returned no authoritative document JSON.')
    }
    const initialSha = sha256(batch.documentJson)
    const binding = createOpenPencilEngineBinding(transaction, buildResultOf(batch), {
      layoutPageId: renderPlan.layoutPageId,
      generatedFromRevision: 0,
      sourceStateHash: `sha256:${sha256('report-studio-runtime-source')}`,
      engineDocumentRef: {
        provider: 'openpencil',
        documentId: 'report-studio-runtime-smoke',
        contentHash: `sha256:${initialSha}`,
      },
    })
    await writeFile(documentPath, batch.documentJson, 'utf8')

    detachRoute = controller.attachRoute()
    server = createServer((req, res) => {
      if ((req.url ?? '').startsWith(EDITOR_ROUTE_PREFIX)) void controller.handle(req, res)
      else { res.statusCode = 404; res.end() }
    })
    const origin = await listen(server)
    const grant = controller.grantFor(documentPath, initialSha)
    if (!grant?.launchUrl) fail('layout_engine_runtime_failed', 'Managed editor did not issue a launch capability.')
    const launch = await readJsonResponse(await fetch(`${origin}${grant.launchUrl}`, {
      method: 'POST',
      headers: { origin },
      signal,
    }), 'Managed editor launch')
    const iframeResponse = await fetch(launch.iframeUrl, { signal })
    if (!iframeResponse.ok) fail('layout_engine_runtime_failed', `Managed editor iframe failed (${iframeResponse.status}).`)
    await iframeResponse.arrayBuffer()

    const selectedNodeId = binding.nodeMap.find(entry => entry.layoutElementId === TITLE_ELEMENT_ID)?.engineNodeId
    if (!selectedNodeId) fail('layout_engine_protocol_error', 'Real binding omitted the title LayoutElement.')
    const initialSelection = await controller.getActiveSelection()
    const daemonOrigin = new URL(launch.iframeUrl).origin
    const selectResponse = await fetch(`${daemonOrigin}/api/mcp/selection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedIds: [selectedNodeId], activePageId: initialSelection.activePageId }),
      signal,
    })
    if (!selectResponse.ok) fail('layout_engine_runtime_failed', `Managed editor selection update failed (${selectResponse.status}).`, { response: (await selectResponse.text()).slice(0, 8000) })
    const selection = await controller.getActiveSelection()
    const mapped = mapOpenPencilSelection(binding, selection.selectedIds)
    if (!mapped.layoutElementIds.includes(TITLE_ELEMENT_ID)) {
      fail('layout_engine_protocol_error', 'Managed editor selection did not map back to the expected LayoutElement.', { selection, mapped })
    }

    const nextFrame = { x: 176, y: 154, width: 980, height: 112, rotation: 0 }
    const patch = compileOpenPencilFramePatchTransaction(binding, [{ layoutElementId: TITLE_ELEMENT_ID, frame: nextFrame }])
    await controller.callActiveMcp('batch_design', { script: patch.operations, postProcess: false })
    const authoritative = await readManagedDaemonDocument(daemonOrigin, launch.token, fetch, signal)
    const changedDocument = JSON.parse(authoritative.documentJson)
    const changedNode = findNode(changedDocument, selectedNodeId)
    if (!changedNode || ['x', 'y', 'width', 'height', 'rotation'].some(key => Number(changedNode[key]) !== nextFrame[key])) {
      fail('layout_engine_protocol_error', 'Real OpenPencil frame patch was not present in the authoritative document.', {
        nodeId: selectedNodeId,
        expectedFrame: nextFrame,
        actualNode: changedNode,
      })
    }

    const saveResponse = await fetch(`${origin}${launch.saveUrl}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: launch.sessionId,
        docJson: authoritative.documentJson,
        generation: 1,
        revision: authoritative.version,
      }),
      signal,
    })
    await readJsonResponse(saveResponse, 'Managed editor save')
    const savedBytes = await readFile(documentPath, 'utf8')
    const savedSha = sha256(savedBytes)

    await fetch(`${origin}${launch.closeUrl}`, {
      method: 'DELETE',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: launch.sessionId, dirty: false }),
      signal,
    })
    detachRoute?.()
    detachRoute = null
    await controller.dispose()

    controller = new EditorHostController(masterKey)
    if (!controller.available) fail('layout_engine_unavailable', 'Managed OpenPencil runtime became unavailable during reopen.')
    detachRoute = controller.attachRoute()
    const replayGrant = controller.grantFor(documentPath, savedSha)
    if (!replayGrant?.launchUrl) fail('layout_engine_runtime_failed', 'Managed editor did not issue a reopen capability.')
    const replay = await readJsonResponse(await fetch(`${origin}${replayGrant.launchUrl}`, {
      method: 'POST',
      headers: { origin },
      signal,
    }), 'Managed editor reopen')
    if (sha256(replay.docJson) !== savedSha) {
      fail('layout_engine_protocol_error', 'Reopened managed editor bytes did not match the saved document.', {
        expected: savedSha,
        actual: sha256(replay.docJson ?? ''),
      })
    }
    const reopenedNode = findNode(JSON.parse(replay.docJson), selectedNodeId)
    if (!reopenedNode || Number(reopenedNode.x) !== nextFrame.x || Number(reopenedNode.width) !== nextFrame.width) {
      fail('layout_engine_protocol_error', 'Frame patch did not survive document close and reopen.', {
        nodeId: selectedNodeId,
        reopenedNode,
      })
    }
    await fetch(`${origin}${replay.closeUrl}`, {
      method: 'DELETE',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: replay.sessionId, dirty: false }),
      signal,
    })

    return assertOpenPencilRuntimeEvidence({
      status: 'passed',
      runtime: 'openpencil-managed',
      packageVersion: runtime.packageVersion,
      openPencilVersion: runtime.openPencilVersion,
      openPencilRevision: runtime.openPencilRevision,
      width: renderPlan.canvas.width,
      height: renderPlan.canvas.height,
      batchDesign: true,
      bindingCount: binding.nodeMap.length,
      managedEditor: true,
      selectionMapped: true,
      framePatch: true,
      saved: true,
      reopened: true,
      documentSha256: savedSha,
      reopenedSha256: sha256(replay.docJson),
      lifecycle: {
        created: true,
        selected: true,
        updated: true,
        saved: true,
        closed: true,
        reopened: true,
      },
    })
  } catch (error) {
    if (error instanceof OpenPencilRuntimeError) throw error
    fail('layout_engine_runtime_failed', 'Unable to execute the pinned managed OpenPencil runtime smoke.', {
      cause: error?.message ?? String(error),
      stack: error?.stack ?? null,
    })
  } finally {
    detachRoute?.()
    await controller?.dispose?.().catch(() => undefined)
    await closeServer(server).catch(() => undefined)
  }
}

export async function runOpenPencilRuntimeSmoke({
  runtime = undefined,
  packageRoot = undefined,
  resolveRuntime = resolveDshOpenPencilPackage,
  makeTemporaryDirectory = prefix => mkdtemp(prefix),
  executeLifecycle = executeManagedOpenPencilLifecycle,
  removeDirectory = path => rm(path, { recursive: true, force: true }),
  signal = new AbortController().signal,
} = {}) {
  const selectedRuntime = runtime ?? await resolveRuntime({ packageRoot })
  const temporaryRoot = await makeTemporaryDirectory(join(tmpdir(), 'report-studio-openpencil-runtime-'))
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(temporaryRoot, 'dsh-home')
  try {
    const evidence = await executeLifecycle({ runtime: selectedRuntime, temporaryRoot, signal })
    return assertOpenPencilRuntimeEvidence({
      ...evidence,
      packageVersion: selectedRuntime.packageVersion,
      openPencilVersion: selectedRuntime.openPencilVersion,
      openPencilRevision: selectedRuntime.openPencilRevision,
    })
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    await removeDirectory(temporaryRoot).catch(() => undefined)
  }
}
