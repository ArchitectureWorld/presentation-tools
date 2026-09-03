import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
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
    if (!(await pathExists(controlPath))) control = await createNewControl()
    else control = JSON.parse(await readFile(controlPath, 'utf8'))
    if (control.schemaVersion !== CONTROL_SCHEMA_VERSION) {
      throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, '不支持的 ControlStore 版本。', { schemaVersion: control.schemaVersion }, 500)
    }
    state = await loadState(control)
  } catch (error) {
    await releaseLock().catch(() => undefined)
    throw error
  }

  async function readControlFresh() {
    const fresh = JSON.parse(await readFile(controlPath, 'utf8'))
    if (fresh.schemaVersion !== CONTROL_SCHEMA_VERSION) throw new StudioError(ERROR_CODES.REPOSITORY_INTEGRITY_ERROR, 'ControlStore 版本发生变化。', undefined, 500)
    return fresh
  }

  async function publish(nextControl) {
    await atomicWriteJson(controlPath, nextControl)
    control = nextControl
    state = await loadState(control)
    return clone(state)
  }

  async function transactContent(input, mutator) {
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

  async function getSnapshotAt(revisionNumber) {
    const summary = control.operational.revisions.find(item => item.number === revisionNumber)
    if (!summary?.revisionRef) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到指定 Revision。', { revisionNumber }, 404)
    const revision = await getObject(summary.revisionRef)
    const stored = await getObject(revision.snapshotRef)
    return clone(stored.value)
  }

  async function replace(next) {
    const contentChanged = canonicalJson(canonicalFromState(state)) !== canonicalJson(canonicalFromState(next))
    if (contentChanged) {
      const baseRevision = state.project.currentRevision
      return transactContent({ baseRevision, source: next.revisions?.at(-1)?.source ?? 'human', detail: next.revisions?.at(-1)?.detail ?? null }, () => next)
    }
    return transactOperational(() => next)
  }

  return {
    root,
    controlPath,
    statePath: controlPath,
    legacyStatePath,
    getState() { return clone(state) },
    getSnapshotAt,
    transactContent,
    transactOperational,
    async replace(next) { return replace(next) },
    async update(mutator) { return replace(await mutator(clone(state))) },
    async close() { await releaseLock() },
  }
}
