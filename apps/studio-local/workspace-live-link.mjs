import { createHash } from 'node:crypto'
import { watch as fsWatch } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { validateProjectDirectoryWithAjv } from '../../contracts/presentation-standard-project/src/index.mjs'
import { readStandardProject } from '../../packages/studio-standard-adapter/index.mjs'
import { StudioError } from '../../packages/studio-contracts/index.mjs'

const clone = value => structuredClone(value)

function workspaceError(code, message, details = undefined, statusCode = 400) {
  return new StudioError(code, message, details, statusCode)
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]))
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(sortValue(value))).digest('hex')
}

function workspaceStatus(status, workspaceRoot, detail = {}) {
  return {
    status,
    workspaceRoot,
    projectId: detail.projectId ?? null,
    standardVersion: detail.standardVersion ?? '0.1.0',
    fingerprint: detail.fingerprint ?? null,
    sourceRevision: detail.sourceRevision ?? null,
    sourceRevisions: clone(detail.sourceRevisions ?? []),
    readAt: detail.readAt ?? new Date().toISOString(),
    validation: clone(detail.validation ?? { valid: false, errors: [], warnings: [] }),
    snapshot: detail.snapshot ? clone(detail.snapshot) : null,
  }
}

export async function resolveWorkspaceRoot(value) {
  const input = String(value ?? '').trim()
  if (!input || !isAbsolute(input)) {
    throw workspaceError('workspace_unavailable', 'DSH Session Workspace 必须是本机绝对路径。', { workspaceRoot: input || null })
  }
  const requested = resolve(input)
  try {
    const requestedInfo = await lstat(requested)
    if (requestedInfo.isSymbolicLink()) throw workspaceError('workspace_unavailable', 'DSH Session Workspace 根目录不能是符号链接。', { workspaceRoot: requested })
    if (!requestedInfo.isDirectory()) throw workspaceError('workspace_unavailable', 'DSH Session Workspace 必须指向目录。', { workspaceRoot: requested })
    const canonical = await realpath(requested)
    const canonicalInfo = await lstat(canonical)
    if (!canonicalInfo.isDirectory()) throw workspaceError('workspace_unavailable', 'DSH Session Workspace 必须指向目录。', { workspaceRoot: requested })
    return canonical
  } catch (error) {
    if (error instanceof StudioError) throw error
    throw workspaceError('workspace_unavailable', '无法读取当前 DSH Session Workspace。', {
      workspaceRoot: requested,
      cause: error?.message ?? String(error),
    }, error?.code === 'ENOENT' ? 404 : 400)
  }
}

function collectSourceRevisions(value) {
  const records = new Map()
  const visit = candidate => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    if (!candidate || typeof candidate !== 'object') return
    if (Array.isArray(candidate.sourceRefs)) {
      for (const ref of candidate.sourceRefs) {
        if (!ref || typeof ref !== 'object') continue
        const key = JSON.stringify([ref.provider, ref.sourceProjectId, ref.sourceRevision])
        records.set(key, {
          provider: ref.provider,
          sourceProjectId: ref.sourceProjectId,
          sourceRevision: ref.sourceRevision,
        })
      }
    }
    for (const child of Object.values(candidate)) visit(child)
  }
  visit(value)
  const sourceRevisions = [...records.values()].sort((left, right) => String(left.provider).localeCompare(String(right.provider))
    || String(left.sourceProjectId).localeCompare(String(right.sourceProjectId))
    || String(left.sourceRevision).localeCompare(String(right.sourceRevision), undefined, { numeric: true }))
  const numeric = sourceRevisions.map(item => typeof item.sourceRevision === 'number'
    ? item.sourceRevision
    : /^\d+$/u.test(String(item.sourceRevision)) ? Number(item.sourceRevision) : null)
    .filter(Number.isSafeInteger)
  return { sourceRevisions, sourceRevision: numeric.length ? Math.max(...numeric) : null }
}

export async function readWorkspaceSnapshot(workspaceRoot, { putBlob } = {}) {
  const root = await resolveWorkspaceRoot(workspaceRoot)
  try {
    const project = await lstat(join(root, 'project.json'))
    if (!project.isFile()) {
      return workspaceStatus('workspace_project_missing', root, {
        validation: { valid: false, errors: [{ code: 'workspace_project_missing', filePath: 'project.json', instancePath: '', message: 'Workspace 根目录没有 project.json。' }], warnings: [] },
      })
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return workspaceStatus('workspace_project_missing', root, {
      validation: { valid: false, errors: [{ code: 'workspace_project_missing', filePath: 'project.json', instancePath: '', message: 'Workspace 根目录没有 project.json。' }], warnings: [] },
    })
  }

  const validation = await validateProjectDirectoryWithAjv(root, { allowGitKeep: true })
  if (!validation.valid) return workspaceStatus('workspace_contract_invalid', root, { validation })

  try {
    const imported = await readStandardProject(root, { putBlob, archiveScope: 'managed' })
    const revisions = collectSourceRevisions(imported.snapshot.project.extensionPayload?.standardArchive?.documents ?? imported.snapshot)
    return workspaceStatus('connected', root, {
      projectId: imported.snapshot.project.id,
      standardVersion: imported.validation.standardVersion,
      fingerprint: fingerprint(imported.snapshot),
      ...revisions,
      validation: imported.validation,
      snapshot: imported.snapshot,
    })
  } catch (error) {
    if (error?.code === 'standard_contract_invalid') {
      return workspaceStatus('workspace_contract_invalid', root, {
        validation: { valid: false, errors: clone(error.details?.errors ?? []), warnings: [] },
      })
    }
    throw error
  }
}

const MANAGED_ROOT_ENTRIES = new Set(['project.json', 'rules.json', 'outline.json', 'pages', 'source-materials', 'assets'])

function normalizedRelativePath(root, value) {
  return relative(root, value).split(sep).join('/')
}

async function collectDirectories(root) {
  const directories = []
  const visit = async current => {
    try {
      const entries = await readdir(current, { withFileTypes: true })
      directories.push(current)
      for (const entry of entries) {
        if (entry.isDirectory()) await visit(join(current, entry.name))
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    }
  }
  await visit(root)
  return directories
}

function managedArchivePaths(snapshot) {
  return new Set((snapshot?.project?.extensionPayload?.standardArchive?.files ?? [])
    .map(file => String(file?.relativePath ?? '').replaceAll('\\', '/'))
    .filter(path => path.startsWith('source-materials/') || path.startsWith('assets/')))
}

export function createWorkspaceWatcher({
  workspaceRoot,
  putBlob,
  debounceMs = 750,
  watchFactory = fsWatch,
  onCandidate = () => {},
  onStatus = () => {},
} = {}) {
  let closed = false
  let started = false
  let debounceTimer = null
  let scanQueue = Promise.resolve()
  let activeWatches = []
  let allowedManagedFiles = new Set()
  let current = {
    status: 'watcher_disconnected',
    workspaceRoot: workspaceRoot ?? null,
    projectId: null,
    standardVersion: '0.1.0',
    fingerprint: null,
    lastValidFingerprint: null,
    sourceRevision: null,
    sourceRevisions: [],
    readAt: null,
    validation: { valid: false, errors: [], warnings: [] },
  }

  const publishStatus = async next => {
    current = clone(next)
    await onStatus(clone(current))
  }

  const closeWatches = () => {
    const watches = activeWatches
    activeWatches = []
    for (const watcher of watches) {
      try {
        watcher.close()
      } catch {
        // A watcher invalidated by an atomic directory replacement is already closed.
      }
    }
  }

  const isManagedEvent = (root, watchedDirectory, filename) => {
    if (filename === null || filename === undefined) return true
    const name = String(filename).replaceAll('\\', '/')
    const absolute = resolve(watchedDirectory, name)
    const path = normalizedRelativePath(root, absolute)
    if (!path || path.startsWith('../')) return false
    if (!path.includes('/')) return MANAGED_ROOT_ENTRIES.has(path)
    if (path === 'pages/manifest.json' || path === 'pages/drafts') return true
    if (path.startsWith('pages/drafts/')) return path.endsWith('.json') || !path.slice('pages/drafts/'.length).includes('.')
    if (path === 'source-materials/manifest.json' || path === 'assets/manifest.json') return true
    return allowedManagedFiles.has(path)
  }

  const scheduleRescan = () => {
    if (closed) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void rescan()
    }, debounceMs)
  }

  const rebuildWatches = async (root, snapshot) => {
    closeWatches()
    if (closed) return

    allowedManagedFiles = managedArchivePaths(snapshot)
    const directories = new Set([root, join(root, 'pages'), join(root, 'source-materials'), join(root, 'assets')])
    for (const directory of await collectDirectories(join(root, 'pages', 'drafts'))) directories.add(directory)
    for (const relativePath of allowedManagedFiles) directories.add(dirname(join(root, ...relativePath.split('/'))))

    for (const directory of directories) {
      try {
        const watcher = watchFactory(directory, { persistent: true }, (_eventType, filename) => {
          if (isManagedEvent(root, directory, filename)) scheduleRescan()
        })
        activeWatches.push(watcher)
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
      }
    }
  }

  const performRescan = async () => {
    if (closed) return clone(current)
    await publishStatus({ ...current, status: 'validating', readAt: new Date().toISOString() })
    try {
      const result = await readWorkspaceSnapshot(workspaceRoot, { putBlob })
      if (closed) return clone(current)
      await rebuildWatches(result.workspaceRoot, result.snapshot)
      if (closed) return clone(current)

      if (result.status === 'connected') {
        const changed = result.fingerprint !== current.lastValidFingerprint
        const next = { ...result, lastValidFingerprint: result.fingerprint }
        if (changed) await onCandidate(clone(result))
        if (!closed) await publishStatus(next)
        return clone(next)
      }

      const next = { ...result, lastValidFingerprint: current.lastValidFingerprint }
      await publishStatus(next)
      return clone(next)
    } catch (error) {
      if (closed) return clone(current)
      closeWatches()
      const next = {
        ...current,
        status: error?.code ?? 'watcher_error',
        readAt: new Date().toISOString(),
        validation: {
          valid: false,
          errors: [{
            code: error?.code ?? 'watcher_error',
            filePath: '',
            instancePath: '',
            message: error?.message ?? String(error),
          }],
          warnings: [],
        },
      }
      await publishStatus(next)
      return clone(next)
    }
  }

  function rescan() {
    if (closed) return Promise.resolve(clone(current))
    const pending = scanQueue.then(performRescan, performRescan)
    scanQueue = pending.catch(() => {})
    return pending
  }

  return {
    async start() {
      if (closed || started) return clone(current)
      started = true
      return rescan()
    },
    rescan,
    status() {
      return clone(current)
    },
    async close() {
      if (closed) return clone(current)
      closed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = null
      closeWatches()
      await scanQueue
      current = { ...current, status: 'watcher_disconnected' }
      await onStatus(clone(current))
      return clone(current)
    },
  }
}
