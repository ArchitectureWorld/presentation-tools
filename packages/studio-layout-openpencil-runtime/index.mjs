import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const OPENPENCIL_RUNTIME_SMOKE_VERSION = '0.2.0-alpha.2'

export class OpenPencilRuntimeSmokeError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'OpenPencilRuntimeSmokeError'
    this.code = code
    this.details = details
  }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmptyString = value => typeof value === 'string' && value.trim().length > 0

function fail(code, message, details = undefined) {
  throw new OpenPencilRuntimeSmokeError(code, message, details)
}

function normalized(value) {
  return resolve(String(value)).replace(/[\\/]+$/u, '').toLowerCase()
}

function within(root, candidate) {
  const rootPath = normalized(root)
  const candidatePath = normalized(candidate)
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${sep}`.toLowerCase())
}

/** Validate that all test-owned paths and redirected environment values stay below one temp root. */
export function assertIsolatedRuntimeContext(context) {
  if (!object(context) || !nonEmptyString(context.root) || !isAbsolute(context.root)) {
    fail('runtime_non_isolated_home', 'An absolute ephemeral runtime root is required')
  }
  const root = resolve(context.root)
  if (nonEmptyString(context.productionDshHome) && normalized(context.productionDshHome) === normalized(root)) {
    fail('runtime_production_path_overlap', 'The production DSH Home must not be the ephemeral runtime root')
  }

  const paths = [
    'runtime', 'dshHome', 'config', 'data', 'cache', 'documents', 'logs', 'browserProfile', 'artifacts',
  ]
  for (const key of paths) {
    if (!nonEmptyString(context[key]) || !isAbsolute(context[key]) || !within(root, context[key])) {
      fail('runtime_non_isolated_home', `${key} must be an absolute path inside the ephemeral root`, { key })
    }
  }
  if (object(context.environment)) {
    for (const key of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'npm_config_cache']) {
      const value = context.environment[key]
      if (!nonEmptyString(value) || !isAbsolute(value) || !within(root, value)) {
        fail('runtime_non_isolated_home', `${key} must be redirected below the ephemeral root`, { key })
      }
    }
  } else {
    fail('runtime_non_isolated_home', 'The isolated child-process environment is required')
  }
  if (nonEmptyString(context.productionDshHome) && within(root, context.productionDshHome)) {
    fail('runtime_production_path_overlap', 'The production DSH Home cannot be inside the ephemeral root')
  }
  return context
}

/** Only services bound to the exact loopback address are allowed in the smoke. */
export function assertLoopbackUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch (error) {
    fail('runtime_non_loopback_address', 'Service URL must be an absolute HTTP(S) URL on 127.0.0.1', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1'
    || url.username !== ''
    || url.password !== '') {
    fail('runtime_non_loopback_address', 'Services must bind to 127.0.0.1 without credentials', { value })
  }
  return url
}

/** Require an exact semver string in a dependency section; ranges and tags are refused. */
export function assertPinnedDependency(packageJson, name, version) {
  if (!object(packageJson) || !nonEmptyString(name) || !nonEmptyString(version)) {
    fail('runtime_dependency_missing', 'A package manifest, dependency name and exact version are required')
  }
  const locations = ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies']
  const values = locations
    .map(location => object(packageJson[location]) ? packageJson[location][name] : undefined)
    .filter(value => value !== undefined)
  if (values.length === 0) fail('runtime_dependency_missing', `Missing dependency coordinate: ${name}`, { name })
  if (values.some(value => value !== version) || new Set(values).size !== 1) {
    fail('runtime_floating_dependency', `${name} must be pinned exactly to ${version}`, { name, values, version })
  }
  return version
}

/** Validate a capability URL issued by the smoke's own loopback server. */
export function assertCapabilityUrl(value, expectedOrigin) {
  let url
  try {
    url = new URL(value)
  } catch (error) {
    fail('runtime_capability_url_forbidden', 'Capability URL must be an absolute HTTP(S) URL', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1'
    || url.origin !== expectedOrigin
    || !/^\/cap\/[A-Za-z0-9_-]+$/u.test(url.pathname)
    || url.username !== ''
    || url.password !== '') {
    fail('runtime_capability_url_forbidden', 'Capability URL must be a tokenized path on the expected loopback origin', {
      origin: url.origin,
      pathname: url.pathname,
    })
  }
  return url
}

/** Validate the actual batch_design result shape before handing it to the Report Studio Adapter. */
export function validateRealExecutionResult(transaction, result, execution = {}) {
  if (!object(execution) || execution.real !== true || execution.runtime !== 'dsh-openpencil') {
    fail('runtime_forged_result', 'Execution results must be marked as a real dsh-openpencil call')
  }
  if (execution.capability !== 'batch_design') {
    fail('runtime_capability_mismatch', 'Only a real batch_design result can establish OpenPencil bindings', { execution })
  }
  if (!object(transaction) || !nonEmptyString(transaction.rootBinding) || !Array.isArray(transaction.expectedBindings)) {
    fail('runtime_invalid_transaction', 'The Adapter transaction is missing its binding contract')
  }
  if (!object(result) || !Array.isArray(result.results) || result.synthetic === true || result.mock === true) {
    fail('runtime_forged_result', 'Synthetic, mock or malformed execution results are not accepted')
  }

  const expected = new Set([transaction.rootBinding, ...transaction.expectedBindings.map(entry => entry.bindingKey)])
  const seenBindings = new Set()
  const seenNodes = new Set()
  const byBinding = new Map()
  for (const [index, entry] of result.results.entries()) {
    if (!object(entry) || !nonEmptyString(entry.binding) || !nonEmptyString(entry.nodeId)) {
      fail('runtime_invalid_execution_result', `Invalid real result entry at index ${index}`, { index })
    }
    if (seenBindings.has(entry.binding)) fail('runtime_duplicate_binding', `Duplicate real result binding: ${entry.binding}`, { binding: entry.binding })
    if (!expected.has(entry.binding)) fail('runtime_unknown_binding', `Unknown real result binding: ${entry.binding}`, { binding: entry.binding })
    if (seenNodes.has(entry.nodeId)) fail('runtime_duplicate_engine_node', `Duplicate real engine node: ${entry.nodeId}`, { nodeId: entry.nodeId })
    seenBindings.add(entry.binding)
    seenNodes.add(entry.nodeId)
    byBinding.set(entry.binding, entry.nodeId)
  }
  for (const binding of expected) {
    if (!byBinding.has(binding)) fail('runtime_missing_binding', `Real result omitted binding: ${binding}`, { binding })
  }
  return {
    rootNodeId: byBinding.get(transaction.rootBinding),
    nodeIds: transaction.expectedBindings.map(entry => byBinding.get(entry.bindingKey)),
  }
}

function nodeWithoutFrame(node) {
  const copy = structuredClone(node)
  for (const key of ['x', 'y', 'width', 'height', 'rotation']) delete copy[key]
  return copy
}

/** Check a real patch/reopen snapshot without allowing content or identity drift. */
export function validateDocumentLifecycle(before, after, patch) {
  if (!object(before) || !object(after) || !Array.isArray(before.nodes) || !Array.isArray(after.nodes)) {
    fail('runtime_document_invalid', 'Document snapshots must contain node arrays')
  }
  if (before.documentId !== undefined && after.documentId !== before.documentId) {
    fail('runtime_document_identity_changed', 'Document identity changed across the lifecycle')
  }
  const beforeById = new Map(before.nodes.map(node => [node?.id, node]))
  const afterById = new Map(after.nodes.map(node => [node?.id, node]))
  if (beforeById.size !== before.nodes.length || afterById.size !== after.nodes.length
    || beforeById.size !== afterById.size
    || [...beforeById.keys()].some(id => !afterById.has(id))) {
    fail('runtime_document_nodes_changed', 'Document node identities changed across the lifecycle')
  }
  if (!object(patch) || !Array.isArray(patch.changes) || patch.changes.length === 0) {
    fail('runtime_patch_invalid', 'A non-empty geometry patch is required')
  }
  const targetIds = new Set()
  for (const change of patch.changes) {
    if (!object(change) || !nonEmptyString(change.layoutElementId) || !object(change.frame)
      || Object.keys(change).sort().join(',') !== 'frame,layoutElementId') {
      fail('runtime_patch_non_geometry', 'Frame patches may contain only layoutElementId and frame')
    }
    if (targetIds.has(change.layoutElementId)) fail('runtime_patch_duplicate_target', `Duplicate patch target: ${change.layoutElementId}`)
    targetIds.add(change.layoutElementId)
  }
  const bindingMap = object(before.binding) && Array.isArray(before.binding.nodeMap)
    ? new Map(before.binding.nodeMap.map(entry => [entry.layoutElementId, entry.engineNodeId]))
    : new Map()
  if (object(before.binding) && object(after.binding)
    && JSON.stringify(before.binding.nodeMap) !== JSON.stringify(after.binding.nodeMap)) {
    fail('runtime_binding_drift', 'LayoutEngineBinding nodeMap changed across the lifecycle')
  }
  for (const change of patch.changes) {
    const engineNodeId = bindingMap.get(change.layoutElementId)
    if (!engineNodeId) fail('runtime_missing_binding', `Patch target has no binding: ${change.layoutElementId}`)
    const beforeNode = beforeById.get(engineNodeId)
    const afterNode = afterById.get(engineNodeId)
    if (!beforeNode || !afterNode) fail('runtime_document_nodes_changed', `Patch target node is missing: ${engineNodeId}`)
    if (JSON.stringify(nodeWithoutFrame(beforeNode)) !== JSON.stringify(nodeWithoutFrame(afterNode))) {
      if (beforeNode.content !== afterNode.content) fail('runtime_document_content_changed', `Patch changed text content: ${engineNodeId}`)
      if (JSON.stringify(beforeNode.style) !== JSON.stringify(afterNode.style)) fail('runtime_document_style_changed', `Patch changed style: ${engineNodeId}`)
      fail('runtime_document_non_geometry_changed', `Patch changed non-geometry fields: ${engineNodeId}`)
    }
    for (const key of ['x', 'y', 'width', 'height', 'rotation']) {
      if (afterNode[key] !== change.frame[key]) fail('runtime_frame_mismatch', `Patched frame does not match ${key}: ${engineNodeId}`)
    }
  }
  for (const [id, beforeNode] of beforeById) {
    if (!targetIds.has([...bindingMap.entries()].find(([, engineId]) => engineId === id)?.[0])) {
      if (JSON.stringify(beforeNode) !== JSON.stringify(afterById.get(id))) {
        fail('runtime_unexpected_node_change', `Untargeted node changed: ${id}`)
      }
    }
  }
  return true
}

function contentTypeFor(path) {
  const extension = extname(path).toLowerCase()
  return extension === '.png' ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
      : extension === '.webp' ? 'image/webp'
        : 'application/octet-stream'
}

/** Issue one short-lived, tokenized URL for a single fixture asset under the temp root. */
export async function createCapabilityServer({ root, assetPath, ttlMs = 30_000, host = '127.0.0.1' }) {
  if (!nonEmptyString(root) || !nonEmptyString(assetPath) || !isAbsolute(root) || !isAbsolute(assetPath)) {
    fail('runtime_capability_asset_outside_root', 'Capability root and asset path must be absolute')
  }
  if (host !== '127.0.0.1' || !within(root, assetPath)) {
    fail('runtime_capability_asset_outside_root', 'Capability service may only expose an asset below the temp root')
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) fail('runtime_capability_ttl_invalid', 'Capability TTL must be positive')
  const token = randomBytes(18).toString('base64url')
  const expiresAt = Date.now() + ttlMs
  const rootPath = resolve(root)
  const sourcePath = resolve(assetPath)
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      const expectedPath = `/cap/${token}`
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end()
        return
      }
      if (requestUrl.pathname !== expectedPath) {
        response.writeHead(404).end()
        return
      }
      if (Date.now() >= expiresAt) {
        response.writeHead(410).end()
        return
      }
      const filePath = resolve(sourcePath)
      const pathDelta = relative(rootPath, filePath)
      if (pathDelta.startsWith('..') || isAbsolute(pathDelta)) {
        response.writeHead(404).end()
        return
      }
      const bytes = await readFile(filePath)
      response.writeHead(200, {
        'content-type': contentTypeFor(filePath),
        'cache-control': 'no-store',
        'content-length': bytes.byteLength,
      })
      if (request.method === 'HEAD') response.end()
      else response.end(bytes)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, host, resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise(resolveClose => server.close(resolveClose))
    fail('runtime_capability_server_failed', 'Capability server did not expose a TCP port')
  }
  const origin = `http://${host}:${address.port}`
  return {
    origin,
    url: `${origin}/cap/${token}`,
    async close() {
      await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
    },
  }
}
