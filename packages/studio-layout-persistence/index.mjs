import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { assertLayoutPageDocument } from '../studio-layout-contracts/index.mjs'

export const LAYOUT_STORE_SCHEMA_VERSION = 'report-studio.layout-store.v0.2.0-beta.1'
export const LAYOUT_REF_SCHEMA_VERSION = 'report-studio.layout-ref.v0.2.0-beta.1'

const SHA256 = /^[0-9a-f]{64}$/u

export class LayoutPersistenceError extends Error {
  constructor(code, message, details = undefined, status = 400) {
    super(message)
    this.name = 'LayoutPersistenceError'
    this.code = code
    this.details = details
    this.status = status
  }
}

const clone = value => structuredClone(value)
const now = () => new Date().toISOString()

function fail(code, message, details = undefined, status = 400) {
  throw new LayoutPersistenceError(code, message, details, status)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}

export function canonicalLayoutJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function layoutSha256(value) {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalLayoutJson(value)
  return createHash('sha256').update(bytes).digest('hex')
}

function safeIdentity(value, field) {
  const text = String(value ?? '')
  if (!/^[a-z0-9][a-z0-9_.-]{2,199}$/u.test(text) || text.includes('..') || text.includes('/') || text.includes('\\')) {
    fail('layout_invalid_identity', `${field} is not a safe persisted identity.`, { field, value })
  }
  return text
}

function semanticLayout(layout) {
  const next = clone(layout)
  delete next.layoutRevision
  delete next.updatedAt
  delete next.persistedAt
  return next
}

function assertLayoutRef(ref) {
  if (!ref
    || ref.schemaVersion !== LAYOUT_REF_SCHEMA_VERSION
    || !safeIdentity(ref.layoutPageId, 'layoutPageId')
    || !safeIdentity(ref.projectId, 'projectId')
    || !safeIdentity(ref.pageId, 'pageId')
    || !SHA256.test(String(ref.sha256 ?? ''))
    || !Number.isSafeInteger(ref.layoutRevision)
    || ref.layoutRevision < 0
    || !Number.isSafeInteger(ref.sourceProjectRevision)
    || ref.sourceProjectRevision < 0
    || !/^sha256:[0-9a-f]{64}$/u.test(String(ref.sourceStateHash ?? ''))) {
    fail('layout_invalid_ref', 'Persisted LayoutRef is invalid.', { ref })
  }
  return ref
}

async function exists(path) {
  try { return (await stat(path)).isFile() }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
  const backup = `${path}.bak-${process.pid}-${randomUUID()}`
  let movedExisting = false
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    try {
      await rename(temporary, path)
    } catch (error) {
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(error?.code) || !(await exists(path))) throw error
      await rename(path, backup)
      movedExisting = true
      try {
        await rename(temporary, path)
      } catch (publishError) {
        await rename(backup, path).catch(() => undefined)
        movedExisting = false
        throw publishError
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (movedExisting) await rm(backup, { force: true }).catch(() => undefined)
  }
}

async function readJson(path, missing = null) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return missing
    if (error instanceof SyntaxError) fail('layout_store_corrupt', `Layout JSON is corrupt: ${path}`, { path }, 500)
    throw error
  }
}

export class LayoutPageStore {
  constructor(root) {
    this.root = resolve(root)
    this.pagesRoot = join(this.root, 'pages')
    this.objectsRoot = join(this.root, 'objects', 'sha256')
    this.manifestPath = join(this.root, 'manifest.json')
    this.lockPath = join(this.root, '.writer.lock')
    this.queue = Promise.resolve()
  }

  objectPath(sha256) {
    if (!SHA256.test(String(sha256 ?? ''))) fail('layout_invalid_hash', 'Layout object hash must be lowercase SHA-256.', { sha256 })
    return join(this.objectsRoot, sha256.slice(0, 2), `${sha256}.json`)
  }

  pageRefPath(pageId) {
    return join(this.pagesRoot, `${safeIdentity(pageId, 'pageId')}.json`)
  }

  async initialize() {
    await mkdir(this.pagesRoot, { recursive: true })
    await mkdir(this.objectsRoot, { recursive: true })
    if (!(await exists(this.manifestPath))) {
      await atomicWrite(this.manifestPath, canonicalLayoutJson({
        schemaVersion: LAYOUT_STORE_SCHEMA_VERSION,
        owner: 'presentation',
        pages: [],
        updatedAt: now(),
      }))
    }
    return this
  }

  async #withWriterLock(work) {
    const execute = async () => {
      await this.initialize()
      let handle
      try {
        handle = await open(this.lockPath, 'wx', 0o600)
      } catch (error) {
        if (error?.code === 'EEXIST') fail('layout_store_busy', 'Another layout write is already in progress.', undefined, 409)
        throw error
      }
      try { return await work() }
      finally {
        await handle.close().catch(() => undefined)
        await unlink(this.lockPath).catch(() => undefined)
      }
    }
    const next = this.queue.then(execute, execute)
    this.queue = next.catch(() => undefined)
    return next
  }

  async readRef(pageId) {
    const ref = await readJson(this.pageRefPath(pageId), null)
    return ref === null ? null : clone(assertLayoutRef(ref))
  }

  async readByRef(ref) {
    assertLayoutRef(ref)
    const objectPath = this.objectPath(ref.sha256)
    const bytes = await readFile(objectPath, 'utf8').catch(error => {
      if (error?.code === 'ENOENT') fail('layout_object_missing', 'LayoutRef points to a missing immutable layout object.', { ref }, 500)
      throw error
    })
    const actualSha = layoutSha256(bytes)
    if (actualSha !== ref.sha256) fail('layout_object_hash_mismatch', 'Immutable layout object hash does not match its LayoutRef.', { expected: ref.sha256, actual: actualSha }, 500)
    let layout
    try { layout = JSON.parse(bytes) }
    catch { fail('layout_store_corrupt', 'Immutable layout object is not valid JSON.', { sha256: ref.sha256 }, 500) }
    assertLayoutPageDocument(layout)
    if (layout.layoutPageId !== ref.layoutPageId || layout.projectId !== ref.projectId || layout.pageId !== ref.pageId || layout.layoutRevision !== ref.layoutRevision) {
      fail('layout_object_identity_mismatch', 'Immutable layout object identity does not match its LayoutRef.', { ref }, 500)
    }
    return { layout: clone(layout), ref: clone(ref) }
  }

  async readPage(pageId) {
    const ref = await this.readRef(pageId)
    return ref === null ? null : this.readByRef(ref)
  }

  async listRefs() {
    const manifest = await readJson(this.manifestPath, null)
    if (!manifest || manifest.schemaVersion !== LAYOUT_STORE_SCHEMA_VERSION || !Array.isArray(manifest.pages)) {
      fail('layout_store_corrupt', 'Layout manifest is missing or invalid.', undefined, 500)
    }
    return clone(manifest.pages.map(assertLayoutRef))
  }

  async preparePage(layout, { expectedLayoutRevision = -1, sourceProjectRevision, sourceStateHash } = {}) {
    assertLayoutPageDocument(layout)
    if (!Number.isSafeInteger(expectedLayoutRevision) || expectedLayoutRevision < -1) fail('layout_invalid_revision', 'expectedLayoutRevision must be -1 or a non-negative integer.')
    if (!Number.isSafeInteger(sourceProjectRevision) || sourceProjectRevision < 0) fail('layout_invalid_revision', 'sourceProjectRevision must be a non-negative integer.')
    if (!/^sha256:[0-9a-f]{64}$/u.test(String(sourceStateHash ?? ''))) fail('layout_invalid_source_hash', 'sourceStateHash must be a prefixed SHA-256 value.')
    await this.initialize()
    const current = await this.readPage(layout.pageId)
    const actualRevision = current?.layout.layoutRevision ?? -1
    if (actualRevision !== expectedLayoutRevision) {
      fail('layout_revision_conflict', 'Layout revision changed before the write could be prepared.', {
        expectedLayoutRevision,
        actualLayoutRevision: actualRevision,
        pageId: layout.pageId,
      }, 409)
    }
    if (current && (current.layout.projectId !== layout.projectId || current.layout.layoutPageId !== layout.layoutPageId)) {
      fail('layout_identity_mismatch', 'Existing layout identity cannot be replaced by another project or layout page.', {
        currentProjectId: current.layout.projectId,
        candidateProjectId: layout.projectId,
        currentLayoutPageId: current.layout.layoutPageId,
        candidateLayoutPageId: layout.layoutPageId,
      }, 409)
    }

    const candidateSemantic = semanticLayout({ ...clone(layout), sourceStateHash })
    if (current && canonicalLayoutJson(semanticLayout(current.layout)) === canonicalLayoutJson(candidateSemantic)) {
      return { ...current, expectedLayoutRevision, noOp: true, created: false }
    }

    const next = {
      ...clone(layout),
      layoutRevision: actualRevision + 1,
      sourceStateHash,
      updatedAt: now(),
    }
    assertLayoutPageDocument(next)
    const bytes = canonicalLayoutJson(next)
    const sha256 = layoutSha256(bytes)
    const objectPath = this.objectPath(sha256)
    if (!(await exists(objectPath))) await atomicWrite(objectPath, bytes)
    else if (layoutSha256(await readFile(objectPath)) !== sha256) fail('layout_object_hash_mismatch', 'Existing immutable layout object is corrupt.', { sha256 }, 500)

    const ref = assertLayoutRef({
      schemaVersion: LAYOUT_REF_SCHEMA_VERSION,
      layoutPageId: next.layoutPageId,
      projectId: next.projectId,
      pageId: next.pageId,
      sha256,
      layoutRevision: next.layoutRevision,
      sourceProjectRevision,
      sourceStateHash,
      updatedAt: next.updatedAt,
    })
    return {
      layout: clone(next),
      ref: clone(ref),
      expectedLayoutRevision,
      noOp: false,
      created: current === null,
    }
  }

  async publishPrepared(prepared) {
    if (!prepared || !prepared.ref || !prepared.layout) fail('layout_invalid_prepared_write', 'Prepared layout write is invalid.')
    if (prepared.noOp) return clone(prepared)
    assertLayoutRef(prepared.ref)
    assertLayoutPageDocument(prepared.layout)
    return this.#withWriterLock(async () => {
      const current = await this.readPage(prepared.ref.pageId)
      const actualRevision = current?.layout.layoutRevision ?? -1
      if (actualRevision !== prepared.expectedLayoutRevision) {
        fail('layout_revision_conflict', 'Layout revision changed before the prepared write could be published.', {
          expectedLayoutRevision: prepared.expectedLayoutRevision,
          actualLayoutRevision: actualRevision,
          pageId: prepared.ref.pageId,
        }, 409)
      }
      await this.readByRef(prepared.ref)
      await atomicWrite(this.pageRefPath(prepared.ref.pageId), canonicalLayoutJson(prepared.ref))
      const manifest = await readJson(this.manifestPath, { schemaVersion: LAYOUT_STORE_SCHEMA_VERSION, owner: 'presentation', pages: [] })
      const pages = (manifest.pages ?? []).filter(entry => entry.pageId !== prepared.ref.pageId)
      pages.push(prepared.ref)
      pages.sort((left, right) => left.pageId.localeCompare(right.pageId))
      await atomicWrite(this.manifestPath, canonicalLayoutJson({
        schemaVersion: LAYOUT_STORE_SCHEMA_VERSION,
        owner: 'presentation',
        pages,
        updatedAt: now(),
      }))
      return clone(prepared)
    })
  }

  async repairRef(ref) {
    assertLayoutRef(ref)
    const current = await this.readRef(ref.pageId)
    if (current?.sha256 === ref.sha256) return this.readByRef(ref)
    const prepared = await this.readByRef(ref)
    return this.#withWriterLock(async () => {
      await atomicWrite(this.pageRefPath(ref.pageId), canonicalLayoutJson(ref))
      const manifest = await readJson(this.manifestPath, { schemaVersion: LAYOUT_STORE_SCHEMA_VERSION, owner: 'presentation', pages: [] })
      const pages = (manifest.pages ?? []).filter(entry => entry.pageId !== ref.pageId)
      pages.push(ref)
      pages.sort((left, right) => left.pageId.localeCompare(right.pageId))
      await atomicWrite(this.manifestPath, canonicalLayoutJson({ schemaVersion: LAYOUT_STORE_SCHEMA_VERSION, owner: 'presentation', pages, updatedAt: now() }))
      return prepared
    })
  }

  async writePage(layout, options = {}) {
    const prepared = await this.preparePage(layout, options)
    return this.publishPrepared(prepared)
  }
}

export function assertLayoutRootOwnedByPresentation(layoutRoot, workspaceRoot) {
  const resolvedLayout = resolve(layoutRoot)
  const resolvedWorkspace = resolve(workspaceRoot)
  if (resolvedLayout !== join(resolvedWorkspace, 'layouts') || !resolvedLayout.startsWith(`${resolvedWorkspace}${sep}`)) {
    fail('layout_root_invalid', 'The production Layout Store must be the Presentation-owned layouts/ directory.', {
      layoutRoot: resolvedLayout,
      workspaceRoot: resolvedWorkspace,
    })
  }
  return resolvedLayout
}
