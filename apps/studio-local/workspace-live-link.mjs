import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
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
