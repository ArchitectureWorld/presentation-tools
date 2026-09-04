import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  compileOpenPencilCreateTransaction,
  compileOpenPencilFramePatchTransaction,
  createOpenPencilEngineBinding,
  mapOpenPencilSelection,
} from '../../packages/studio-layout-openpencil/index.mjs'
import {
  createCapabilityServer,
  validateDocumentLifecycle,
  validateRealExecutionResult,
} from '../../packages/studio-layout-openpencil-runtime/index.mjs'
import { createRuntimeFixture } from './fixture.mjs'

export class RuntimeHarnessError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'RuntimeHarnessError'
    this.code = code
    this.details = details
  }
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function isWithinOrSame(parent, candidate) {
  const path = relative(parent, candidate)
  return path === '' || (!path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && path !== '..' && !isAbsolute(path))
}

export function assertRuntimeHarnessIsolation(runtimeRoot, documentsDir) {
  if (!runtimeRoot || !documentsDir) {
    throw new RuntimeHarnessError('runtime_non_isolated_home', 'Runtime root and documents directory are required')
  }
  const root = resolve(runtimeRoot)
  const documents = resolve(documentsDir)
  const systemTemp = resolve(process.env.OPENPENCIL_SYSTEM_TEMP_ROOT ?? tmpdir())
  const productionDshHome = resolve(process.env.OPENPENCIL_PRODUCTION_DSH_HOME ?? join(homedir(), '.dsh'))
  const overlapsProduction = isWithinOrSame(root, productionDshHome) || isWithinOrSame(productionDshHome, root)
  if (!isWithinOrSame(systemTemp, root) || !isWithinOrSame(root, documents) || overlapsProduction) {
    throw new RuntimeHarnessError('runtime_non_isolated_home', 'OpenPencil runtime paths must stay inside one temporary root')
  }
  return { runtimeRoot: root, documentsDir: documents }
}

function flattenNodes(document) {
  const nodes = []
  const visit = node => {
    const { children, ...snapshot } = node
    nodes.push(snapshot)
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  if (Array.isArray(document.children)) document.children.forEach(visit)
  return nodes
}

async function startControllerServer(controller) {
  const server = createServer((request, response) => {
    void controller.handle(request, response)
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('OpenPencil controller server did not expose a port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
    },
  }
}

async function jsonRequest(url, { method = 'GET', origin, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(origin ? { origin } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(`OpenPencil controller request failed (${response.status}): ${value.error ?? 'unknown error'}`)
  return value
}

export function resolveInstalledRuntime(runtimeRoot, profileName = 'compat-smoke') {
  const root = resolve(runtimeRoot)
  const candidates = [
    join(root, 'node_modules'),
    join(root, 'dsh-home', 'profiles', profileName, 'node_modules'),
  ]
  const nodeModules = candidates.find(candidate => existsSync(join(candidate, '@zseven-w', 'dsh-openpencil', 'package.json')))
  if (!nodeModules) {
    throw new RuntimeHarnessError('openpencil_runtime_not_installed', 'The isolated OpenPencil compatibility plugin is not installed')
  }

  const pluginRoot = join(nodeModules, '@zseven-w', 'dsh-openpencil')
  const platformPackageName = process.platform === 'win32' && process.arch === 'x64'
    ? '@zseven-w/dsh-openpencil-win32-x64'
    : `@zseven-w/dsh-openpencil-${process.platform}-${process.arch}`
  const platformRoot = join(nodeModules, ...platformPackageName.split('/'))
  const editorHostModule = join(pluginRoot, 'lib', 'editor-host.js')
  if (!existsSync(editorHostModule) || !existsSync(join(platformRoot, 'package.json'))) {
    throw new RuntimeHarnessError('openpencil_platform_not_installed', 'The real OpenPencil host module or native platform package is missing', {
      platformPackageName,
    })
  }

  const plugin = readManifest(join(pluginRoot, 'package.json'))
  const platform = readManifest(join(platformRoot, 'package.json'))
  return {
    nodeModules,
    pluginRoot,
    pluginVersion: plugin.version,
    platformPackageName,
    platformRoot,
    platformVersion: platform.version,
    editorHostModule,
  }
}

export async function runRealCreateSmoke({ runtimeRoot, documentsDir, profileName = 'compat-smoke', signal = AbortSignal.timeout(60_000) }) {
  const isolated = assertRuntimeHarnessIsolation(runtimeRoot, documentsDir)
  const installed = resolveInstalledRuntime(isolated.runtimeRoot, profileName)
  const fixture = await createRuntimeFixture(isolated.documentsDir)
  const capability = await createCapabilityServer({
    root: isolated.documentsDir,
    assetPath: fixture.assetPath,
    ttlMs: 60_000,
  })
  const module = await import(pathToFileURL(installed.editorHostModule).href)
  const controller = new module.EditorHostController(randomBytes(32))

  try {
    if (!controller.available) {
      throw new RuntimeHarnessError('openpencil_platform_unavailable', 'The installed OpenPencil native runtime could not be loaded')
    }
    const transaction = compileOpenPencilCreateTransaction(fixture.renderPlan, {
      assetUrlResolver: () => capability.url,
    })
    const execution = await controller.createDocumentBatch({
      script: transaction.operations,
      canvasWidth: fixture.renderPlan.canvas.width,
      signal,
    })
    const document = JSON.parse(execution.documentJson)
    await mkdir(isolated.documentsDir, { recursive: true })
    await writeFile(fixture.documentPath, `${JSON.stringify(document)}\n`, { encoding: 'utf8', flag: 'wx' })
    return {
      installed,
      fixture,
      transaction,
      execution,
      document,
    }
  } finally {
    try {
      await controller.dispose()
    } finally {
      await capability.close()
    }
  }
}

export async function runRealLifecycleSmoke({ runtimeRoot, documentsDir, profileName = 'compat-smoke', signal = AbortSignal.timeout(90_000) }) {
  const created = await runRealCreateSmoke({ runtimeRoot, documentsDir, profileName, signal })
  const realResult = created.execution.result.build
  validateRealExecutionResult(created.transaction, realResult, {
    real: true,
    runtime: 'dsh-openpencil',
    capability: 'batch_design',
  })
  const binding = createOpenPencilEngineBinding(created.transaction, realResult, {
    layoutPageId: created.fixture.renderPlan.layoutPageId,
    engineDocumentRef: {
      provider: 'openpencil',
      documentId: created.fixture.documentPath,
      contentHash: null,
    },
    generatedFromRevision: 0,
    sourceStateHash: `sha256:${sha256(Buffer.from(JSON.stringify(created.fixture.renderPlan)))}`,
  })

  const module = await import(pathToFileURL(created.installed.editorHostModule).href)
  const daemonModule = await import(pathToFileURL(join(created.installed.pluginRoot, 'lib', 'managed-editor-daemon.js')).href)
  const controller = new module.EditorHostController(randomBytes(32))
  const detachRoute = controller.attachRoute()
  const host = await startControllerServer(controller)
  const ownerSessionId = 'report-studio-runtime-smoke'
  let firstLaunch
  let successorLaunch

  try {
    const sourceBytes = await readFile(created.fixture.documentPath)
    const grant = controller.grantFor(created.fixture.documentPath, sha256(sourceBytes))
    if (!grant) throw new RuntimeHarnessError('openpencil_editor_grant_failed', 'The managed editor did not issue a launch capability')
    firstLaunch = await jsonRequest(`${host.origin}${grant.launchUrl}`, {
      method: 'POST',
      origin: host.origin,
      body: { sessionId: ownerSessionId },
    })

    const beforeDocument = JSON.parse(firstLaunch.docJson)
    const target = created.fixture.renderPlan.elements.find(element => element.layoutElementId === 'layout_element_runtime_shape')
    const frame = { x: 96, y: 540, width: 560, height: 12, rotation: 1 }
    const patch = compileOpenPencilFramePatchTransaction(binding, [{ layoutElementId: target.layoutElementId, frame }])
    await controller.callActiveMcp('batch_design', { script: patch.operations, postProcess: false }, {
      sourcePath: created.fixture.documentPath,
      ownerSessionId,
      signal,
    })
    const selection = await controller.getActiveSelection({
      sourcePath: created.fixture.documentPath,
      ownerSessionId,
      signal,
    })
    const emptySelection = mapOpenPencilSelection(binding, selection.selectedIds)
    const daemonDocument = await daemonModule.readManagedEditorDaemon({
      baseUrl: new URL(firstLaunch.iframeUrl).origin,
      token: firstLaunch.token,
    }, signal)
    const afterDocument = JSON.parse(daemonDocument.documentJson)
    validateDocumentLifecycle(
      { nodes: flattenNodes(beforeDocument), binding },
      { nodes: flattenNodes(afterDocument), binding },
      patch,
    )

    const save = await jsonRequest(`${host.origin}${firstLaunch.saveUrl}`, {
      method: 'POST',
      origin: host.origin,
      body: {
        sessionId: firstLaunch.sessionId,
        docJson: daemonDocument.documentJson,
        generation: 0,
        revision: daemonDocument.version,
      },
    })
    await jsonRequest(`${host.origin}${firstLaunch.closeUrl}`, { method: 'DELETE', origin: host.origin })
    firstLaunch = undefined

    if (!save.editor?.launchUrl) throw new RuntimeHarnessError('openpencil_editor_successor_missing', 'Save did not return a reopen capability')
    successorLaunch = await jsonRequest(`${host.origin}${save.editor.launchUrl}`, {
      method: 'POST',
      origin: host.origin,
      body: { sessionId: ownerSessionId },
    })
    const reopenedDocument = JSON.parse(successorLaunch.docJson)
    const reopenedNodes = flattenNodes(reopenedDocument)
    const patchedNodeId = binding.nodeMap.find(entry => entry.layoutElementId === target.layoutElementId).engineNodeId
    const patchedNode = reopenedNodes.find(node => node.id === patchedNodeId)
    const beforeIds = flattenNodes(beforeDocument).map(node => node.id)
    const reopenedIds = reopenedNodes.map(node => node.id)

    return {
      ...created,
      binding,
      patch,
      emptySelection,
      patchPersisted: Boolean(patchedNode)
        && ['x', 'y', 'width', 'height', 'rotation'].every(key => patchedNode[key] === frame[key]),
      reopenNodeIdentityStable: JSON.stringify(beforeIds) === JSON.stringify(reopenedIds),
      savedSha256: save.sha256,
      daemonVersion: daemonDocument.version,
    }
  } finally {
    if (firstLaunch?.closeUrl) await jsonRequest(`${host.origin}${firstLaunch.closeUrl}`, { method: 'DELETE', origin: host.origin }).catch(() => {})
    if (successorLaunch?.closeUrl) await jsonRequest(`${host.origin}${successorLaunch.closeUrl}`, { method: 'DELETE', origin: host.origin }).catch(() => {})
    detachRoute()
    try {
      await controller.dispose()
    } finally {
      await host.close()
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const runtimeRoot = process.env.OPENPENCIL_RUNTIME_ROOT
  const documentsDir = process.env.OPENPENCIL_DOCUMENTS_DIR
  if (!runtimeRoot || !documentsDir) {
    console.error('OPENPENCIL_RUNTIME_ROOT and OPENPENCIL_DOCUMENTS_DIR are required')
    process.exit(2)
  }
  try {
    const result = await runRealCreateSmoke({ runtimeRoot, documentsDir })
    console.log(JSON.stringify({
      pluginVersion: result.installed.pluginVersion,
      platformPackage: result.installed.platformPackageName,
      platformVersion: result.installed.platformVersion,
      operationCount: result.transaction.operations.split('\n').length,
      build: result.execution.result.build,
      finalize: result.execution.result.finalize,
      documentPath: result.fixture.documentPath,
      document: result.document,
    }))
  } catch (error) {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    process.exit(1)
  }
}
