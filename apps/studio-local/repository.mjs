import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { createInitialState } from '../../packages/studio-core/index.mjs'
import {
  CONTROL_SCHEMA_VERSION,
  ERROR_CODES,
  StudioError,
  assertCanonicalSnapshot,
  canonicalFromState,
  createStudioId,
  projectStateFromParts,
} from '../../packages/studio-contracts/index.mjs'
import { inspectLegacyState, prepareLegacyMigration } from './migration.mjs'

const clone = value => structuredClone(value)

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]))
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function pathExists(path) {
  try { await stat(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

async function acquireLock(lockPath) {
  const token = { pid: process.pid, hostname: hostname(), nonce: randomUUID(), createdAt: new Date().toISOString() }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(`${JSON.stringify(token)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      return token
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let owner = null
      try { owner = JSON.parse(await readFile(lockPath, 'utf8')) } catch {}
      if (attempt === 0 && owner?.hostname === hostname() && !processIsAlive(owner.pid)) {
        await unlink(lockPath).catch(() => undefined)
        continue
      }
      throw new StudioError(ERROR_CODES.REPOSITORY_LOCKED, '项目存储正在被另一个进程使用。', { owner }, 423)
    }
  }
  throw new StudioError(ERROR_CODES.REPOSITORY_LOCKED, '无法取得项目存储锁。', undefined, 423)
}

function operationalFromState(state, revisions = state.revisions ?? []) {
  return {
    project: { updatedAt: state.project.updatedAt ?? state.project.createdAt },
    annotations: clone(state.annotations ?? []),
    reviewRounds: clone(state.reviewRounds ?? []),
    reviewSubmissions: clone(state.reviewSubmissions ?? []),
    proposals: clone(state.proposals ?? []),
    revisions: clone(revisions),
  }
}

function revisionSummary(record, revisionRef) {
  return {
    id: record.revisionId,
    number: record.revisionNumber,
    parentRevision: record.parentRevision,
    source: record.source,
    detail: clone(record.detail),
    stateHash: record.snapshotRef.sha256,
    createdAt: record.createdAt,
    revisionRef: clone(revisionRef),
  }
}

function isUnusedWorkspace(state, currentControl) {
  const initialProject = createInitialState().project
  const collections = [
    state.outline,
    state.pages,
    state.annotations,
    state.reviewRounds,
    state.reviewSubmissions,
    state.proposals,
    state.reviewRuns,
    currentControl.operational?.reviewRuns,
  ]
  return currentControl.projectHead.currentRevision === 0
    && collections.every(collection => (collection ?? []).length === 0)
    && state.project.title === initialProject.title
    && state.project.status === initialProject.status
}

export async function createRepository(dataDir, { faultInjector = () => undefined } = {}) {
  const root = resolve(dataDir)
  await mkdir(root, { recursive: true })
  const controlPath = join(root, 'control.json')
  const legacyStatePath = join(root, 'state.json')
  const objectsDirectory = join(root, 'objects', 'sha256')
  const lockPath = join(root, 'repository.lock')
  await mkdir(objectsDirectory, { recursive: true })
  const lockToken = await acquireLock(lockPath)
  let closed = false
  let state
  let control
  let migrationInfo = null
  let queue = Promise.resolve()

  async function releaseLock() {
    if (closed) return
    closed = true
    try {
      const owner = JSON.parse(await readFile(lockPath, 'utf8'))
      if (owner.nonce === lockToken.nonce) await unlink(lockPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  async function putObject(value) {
    const payload = canonicalJson(value)
    const digest = sha256(payload)
    const path = join(objectsDirectory, `${digest}.json`)
    if (await pathExists(path)) {
      const existing = await readFile(path, 'utf8')
      if (existing !== payload) throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, '内容寻址对象与文件名哈希不一致。', { sha256: digest }, 500)
      return { sha256: digest }
    }
    const temporary = join(objectsDirectory, `.${digest}-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(payload, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try { await rename(temporary, path) }
    catch (error) {
      if (!(await pathExists(path))) throw error
      await unlink(temporary).catch(() => undefined)
    }
    return { sha256: digest }
  }

  async function getObject(reference) {
    if (!reference?.sha256) throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, '对象引用缺少 SHA-256。', { reference }, 500)
    const payload = await readFile(join(objectsDirectory, `${reference.sha256}.json`), 'utf8')
    if (sha256(payload) !== reference.sha256) throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, '对象文件哈希校验失败。', { sha256: reference.sha256 }, 500)
    return JSON.parse(payload)
  }

  async function putBlob(source, { mimeType, originalFileName, sizeBytes = null, sha256: expectedSha256 = null } = {}) {
    if (!source || typeof source[Symbol.asyncIterator] !== 'function') throw new StudioError(ERROR_CODES.INVALID_COMMAND, 'Blob 输入必须是可流式读取的字节流。', undefined, 400)
    if (typeof mimeType !== 'string' || !mimeType || typeof originalFileName !== 'string' || !originalFileName) throw new StudioError(ERROR_CODES.INVALID_COMMAND, 'Blob 缺少 MIME 类型或原始文件名。', undefined, 400)
    const temporary = join(objectsDirectory, `.${randomUUID()}.blob.tmp`)
    const handle = await open(temporary, 'wx')
    const hash = createHash('sha256')
    let written = 0
    let complete = false
    try {
      for await (const chunk of source) {
        const bytes = Buffer.from(chunk)
        written += bytes.length
        hash.update(bytes)
        await handle.write(bytes)
      }
      await handle.sync()
      complete = true
    } finally {
      await handle.close()
      if (!complete) await unlink(temporary).catch(() => undefined)
    }
    const digest = hash.digest('hex')
    if ((sizeBytes !== null && sizeBytes !== written) || (expectedSha256 && expectedSha256 !== digest)) {
      await unlink(temporary).catch(() => undefined)
      throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, 'Blob 字节数或 SHA-256 校验失败。', { sizeBytes: written, sha256: digest }, 400)
    }
    const blobPath = join(objectsDirectory, `${digest}.blob`)
    try { await rename(temporary, blobPath) }
    catch (error) {
      if (!(await pathExists(blobPath))) throw error
      await unlink(temporary).catch(() => undefined)
    }
    const descriptor = { sha256: digest, sizeBytes: written, mimeType, originalFileName, createdAt: new Date().toISOString() }
    const descriptorPath = join(objectsDirectory, `${digest}.blob.json`)
    if (!(await pathExists(descriptorPath))) await atomicWriteJson(descriptorPath, descriptor)
    else return JSON.parse(await readFile(descriptorPath, 'utf8'))
    return descriptor
  }

  async function openBlob(reference) {
    const sha = String(reference?.sha256 ?? '')
    if (!/^[a-f0-9]{64}$/i.test(sha)) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'Blob 引用缺少有效 SHA-256。', { reference }, 404)
    const descriptor = JSON.parse(await readFile(join(objectsDirectory, `${sha}.blob.json`), 'utf8'))
    const blobPath = join(objectsDirectory, `${sha}.blob`)
    const info = await stat(blobPath)
    if (descriptor.sha256 !== sha || descriptor.sizeBytes !== info.size) throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, 'Blob 描述符与字节文件不一致。', { sha256: sha }, 500)
    return createReadStream(blobPath)
  }

  async function migrateLegacyAssets() {
    assertReady()
    const replacements = new Map()
    for (const page of state.pages ?? []) for (const asset of page.assets ?? []) {
      const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/iu.exec(String(asset.dataUrl ?? ''))
      if (!match) continue
      const bytes = Buffer.from(match[2].replace(/\s/gu, ''), 'base64')
      const mimeType = match[1].toLowerCase()
      const objectRef = await putBlob(Readable.from([bytes]), { mimeType, originalFileName: asset.name ?? `${asset.id}.bin` })
      replacements.set(asset.id, { ...clone(asset), mimeType, objectRef, sizeBytes: objectRef.sizeBytes, sha256: objectRef.sha256 })
      delete replacements.get(asset.id).dataUrl
    }
    if (!replacements.size) return clone(state)
    return transactContent({ baseRevision: state.project.currentRevision, source: 'migration', detail: { actionType: 'asset.migrate_data_url' } }, candidate => {
      for (const page of candidate.pages ?? []) page.assets = (page.assets ?? []).map(asset => replacements.get(asset.id) ?? asset)
      return candidate
    })
  }

  async function loadState(currentControl) {
    const revision = await getObject(currentControl.projectHead.currentRevisionRef)
    if (revision.kind !== 'RevisionRecord' || revision.revisionNumber !== currentControl.projectHead.currentRevision) {
      throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, 'ProjectHead 与 RevisionRecord 不一致。', undefined, 500)
    }
    const stored = await getObject(revision.snapshotRef)
    if (stored.kind !== 'CanonicalSnapshot') throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, 'Revision 未引用 Canonical Snapshot。', undefined, 500)
    assertCanonicalSnapshot(stored.value)
    return projectStateFromParts({
      snapshot: stored.value,
      currentRevision: revision.revisionNumber,
      operational: currentControl.operational,
      ui: currentControl.ui,
    })
  }

  async function createNewControl() {
    const initial = createInitialState()
    const snapshot = canonicalFromState(initial)
    const snapshotRef = await putObject({ kind: 'CanonicalSnapshot', value: snapshot })
    const revision = {
      kind: 'RevisionRecord',
      revisionId: createStudioId('revision'),
      revisionNumber: 0,
      parentRevision: null,
      parentRevisionRef: null,
      snapshotRef,
      source: 'system',
      detail: { actionType: 'project.create' },
      idempotencyKey: null,
      createdAt: initial.project.createdAt,
    }
    const revisionRef = await putObject(revision)
    const next = {
      schemaVersion: CONTROL_SCHEMA_VERSION,
      projectHead: { projectId: initial.project.id, currentRevision: 0, currentRevisionRef: revisionRef },
      operational: operationalFromState(initial, [revisionSummary(revision, revisionRef)]),
      ui: clone(initial.ui),
      migration: { status: 'not_required', migratedFromSchemaVersion: null },
    }
    await atomicWriteJson(controlPath, next)
    return next
  }

  function enqueue(work) {
    const pending = queue.then(work, work)
    queue = pending.catch(() => undefined)
    return pending
  }

  try {
    if (!(await pathExists(controlPath))) {
      const legacy = await inspectLegacyState(root)
      if (legacy.exists) {
        migrationInfo = { status: 'migration_required', sourcePath: legacy.path, sourceSchemaVersion: legacy.state.schemaVersion }
        state = clone(legacy.state)
      } else control = await createNewControl()
    } else control = JSON.parse(await readFile(controlPath, 'utf8'))
    if (control) {
      if (control.schemaVersion !== CONTROL_SCHEMA_VERSION) {
        throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, '不支持的 ControlStore 版本。', { schemaVersion: control.schemaVersion }, 500)
      }
      state = await loadState(control)
    }
  } catch (error) {
    await releaseLock().catch(() => undefined)
    throw error
  }

  async function readControlFresh() {
    const fresh = JSON.parse(await readFile(controlPath, 'utf8'))
    if (fresh.schemaVersion !== CONTROL_SCHEMA_VERSION) throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, 'ControlStore 版本发生变化。', undefined, 500)
    return fresh
  }

  function assertReady() {
    if (migrationInfo?.status === 'migration_required') {
      throw new StudioError(ERROR_CODES.MIGRATION_REQUIRED, '旧项目需要先备份并升级。', clone(migrationInfo), 428)
    }
  }

  async function publish(nextControl) {
    await atomicWriteJson(controlPath, nextControl)
    control = nextControl
    state = await loadState(control)
    return clone(state)
  }

  async function transactContent(input, mutator) {
    assertReady()
    return enqueue(async () => {
      const fresh = await readControlFresh()
      const currentRevision = fresh.projectHead.currentRevision
      if (currentRevision !== input.baseRevision) {
        throw new StudioError(ERROR_CODES.STALE_REVISION, '项目已更新，请刷新后重试。', { expectedRevision: input.baseRevision, currentRevision }, 409)
      }
      const baseState = await loadState(fresh)
      const candidate = await mutator(clone(baseState))
      if (!candidate || typeof candidate !== 'object') throw new StudioError(ERROR_CODES.INVALID_COMMAND, '内容事务必须返回完整项目状态。')
      const snapshot = canonicalFromState(candidate)
      const snapshotRef = await putObject({ kind: 'CanonicalSnapshot', value: snapshot })
      const revisionNumber = currentRevision + 1
      const revision = {
        kind: 'RevisionRecord',
        revisionId: createStudioId('revision'),
        revisionNumber,
        parentRevision: currentRevision,
        parentRevisionRef: clone(fresh.projectHead.currentRevisionRef),
        snapshotRef,
        source: input.source ?? 'human',
        detail: clone(input.detail ?? null),
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: new Date().toISOString(),
      }
      const revisionRef = await putObject(revision)
      await faultInjector('before_head_publish', { revision, revisionRef, snapshotRef })
      const latest = await readControlFresh()
      if (latest.projectHead.currentRevision !== input.baseRevision) {
        throw new StudioError(ERROR_CODES.STALE_REVISION, '项目已更新，请刷新后重试。', { expectedRevision: input.baseRevision, currentRevision: latest.projectHead.currentRevision }, 409)
      }
      const summaries = [...(fresh.operational.revisions ?? []), revisionSummary(revision, revisionRef)]
      return publish({
        ...fresh,
        projectHead: { projectId: snapshot.project.id, currentRevision: revisionNumber, currentRevisionRef: revisionRef },
        operational: operationalFromState(candidate, summaries),
        ui: clone(candidate.ui ?? fresh.ui),
      })
    })
  }

  async function transactOperational(mutator) {
    assertReady()
    return enqueue(async () => {
      const fresh = await readControlFresh()
      const current = await loadState(fresh)
      const candidate = await mutator(clone(current))
      if (!candidate || typeof candidate !== 'object') throw new StudioError(ERROR_CODES.INVALID_COMMAND, '运行态事务必须返回完整项目状态。')
      if (canonicalJson(canonicalFromState(candidate)) !== canonicalJson(canonicalFromState(current))) {
        throw new StudioError(ERROR_CODES.INVALID_COMMAND, '运行态事务不得修改 Canonical 内容。')
      }
      return publish({
        ...fresh,
        operational: operationalFromState(candidate, fresh.operational.revisions),
        ui: clone(candidate.ui ?? fresh.ui),
      })
    })
  }

  async function initializeFromStandardProject({ snapshot: importedSnapshot, detail = null, ui = {} }) {
    assertReady()
    return enqueue(async () => {
      const fresh = await readControlFresh()
      const current = await loadState(fresh)
      if (!isUnusedWorkspace(current, fresh)) {
        throw new StudioError(
          ERROR_CODES.STANDARD_IMPORT_REQUIRES_NEW_WORKSPACE,
          '当前工作区已有项目内容或评审历史。为避免覆盖数据，请在新的 DSH Session 或新的空白项目工作区中导入标准项目。',
          undefined,
          409,
        )
      }

      const snapshot = clone(importedSnapshot)
      assertCanonicalSnapshot(snapshot)
      const createdAt = new Date().toISOString()
      const candidate = projectStateFromParts({
        snapshot,
        currentRevision: 0,
        operational: { project: { updatedAt: createdAt } },
        ui,
      })
      const snapshotRef = await putObject({ kind: 'CanonicalSnapshot', value: snapshot })
      const revision = {
        kind: 'RevisionRecord',
        revisionId: createStudioId('revision'),
        revisionNumber: 0,
        parentRevision: null,
        parentRevisionRef: null,
        snapshotRef,
        source: 'standard_import',
        detail: clone(detail),
        idempotencyKey: null,
        createdAt,
      }
      const revisionRef = await putObject(revision)
      const nextControl = {
        ...fresh,
        projectHead: { projectId: snapshot.project.id, currentRevision: 0, currentRevisionRef: revisionRef },
        operational: operationalFromState(candidate, [revisionSummary(revision, revisionRef)]),
        ui: clone(ui),
      }
      await loadState(nextControl)
      await faultInjector('before_standard_import_head_publish', { nextControl, revision, revisionRef, snapshotRef })
      return publish(nextControl)
    })
  }

  async function getSnapshotAt(revisionNumber) {
    assertReady()
    const summary = control.operational.revisions.find(item => item.number === revisionNumber)
    if (!summary?.revisionRef) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到指定 Revision。', { revisionNumber }, 404)
    const revision = await getObject(summary.revisionRef)
    const stored = await getObject(revision.snapshotRef)
    return clone(stored.value)
  }

  async function replace(next) {
    assertReady()
    const contentChanged = canonicalJson(canonicalFromState(state)) !== canonicalJson(canonicalFromState(next))
    if (contentChanged) {
      const baseRevision = state.project.currentRevision
      return transactContent({ baseRevision, source: next.revisions?.at(-1)?.source ?? 'human', detail: next.revisions?.at(-1)?.detail ?? null }, () => next)
    }
    return transactOperational(() => next)
  }

  async function applyMigration() {
    if (!migrationInfo) {
      return { status: 'ready', backupPath: control?.migration?.backupPath ?? null, state: clone(state) }
    }
    return enqueue(async () => {
      const prepared = await prepareLegacyMigration(root)
      const snapshot = canonicalFromState(prepared.state)
      const snapshotRef = await putObject({ kind: 'CanonicalSnapshot', value: snapshot })
      const legacyStateRef = await putObject({ kind: 'LegacyState', value: prepared.legacyState, source: prepared.sourceSchemaVersion })
      const revisionNumber = Math.max(0, Number(prepared.state.project.currentRevision) || 0)
      const revision = {
        kind: 'RevisionRecord',
        revisionId: createStudioId('revision'),
        revisionNumber,
        parentRevision: null,
        parentRevisionRef: null,
        snapshotRef,
        source: 'migration',
        detail: { actionType: 'project.migrate', migratedFromSchemaVersion: prepared.sourceSchemaVersion },
        idempotencyKey: `migration:${prepared.migrationMap.sourceSchemaVersion}`,
        createdAt: new Date().toISOString(),
      }
      const revisionRef = await putObject(revision)
      const nextControl = {
        schemaVersion: CONTROL_SCHEMA_VERSION,
        projectHead: { projectId: snapshot.project.id, currentRevision: revisionNumber, currentRevisionRef: revisionRef },
        operational: operationalFromState(prepared.state, [revisionSummary(revision, revisionRef)]),
        ui: clone(prepared.state.ui),
        migration: {
          status: 'completed',
          migratedFromSchemaVersion: prepared.migrationMap.sourceSchemaVersion,
          backupPath: prepared.backupPath,
          mapPath: prepared.mapPath,
          legacyStateRef,
          legacyRevisions: clone(prepared.legacyState.revisions ?? []),
          completedAt: new Date().toISOString(),
        },
      }
      await loadState(nextControl)
      await faultInjector('before_migration_publish', { nextControl })
      await atomicWriteJson(controlPath, nextControl)
      control = nextControl
      state = await loadState(control)
      migrationInfo = null
      return { status: 'ready', backupPath: prepared.backupPath, mapPath: prepared.mapPath, state: clone(state) }
    })
  }

  return {
    root,
    controlPath,
    statePath: controlPath,
    legacyStatePath,
    getState() { return clone(state) },
    migrationStatus() {
      if (migrationInfo) return clone(migrationInfo)
      return {
        status: 'ready',
        migratedFromSchemaVersion: control?.migration?.migratedFromSchemaVersion ?? null,
        backupPath: control?.migration?.backupPath ?? null,
      }
    },
    applyMigration,
    getSnapshotAt,
    putBlob,
    openBlob,
    migrateLegacyAssets,
    initializeFromStandardProject,
    transactContent,
    transactOperational,
    async replace(next) { return replace(next) },
    async update(mutator) { return replace(await mutator(clone(state))) },
    async close() { await releaseLock() },
  }
}
