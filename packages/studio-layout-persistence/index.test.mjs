import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  LayoutPageStore,
  LayoutPersistenceError,
  assertLayoutRootOwnedByPresentation,
  canonicalLayoutJson,
  layoutSha256,
} from './index.mjs'

function layout(overrides = {}) {
  return {
    schemaVersion: 'report-studio.layout.v0.2.0-alpha.1',
    layoutPageId: 'layout_page_018f0000-0000-7000-8000-000000000001',
    projectId: 'project_018f0000-0000-7000-8000-000000000002',
    pageId: 'page_018f0000-0000-7000-8000-000000000003',
    canvas: { width: 1600, height: 900, unit: 'studio_unit' },
    baseDraftRevision: 4,
    lastSyncedDraftRevision: 4,
    syncState: 'synced',
    elements: [{
      layoutElementId: 'layout_element_018f0000-0000-7000-8000-000000000004',
      type: 'shape',
      frame: { x: 0, y: 0, width: 1600, height: 900, rotation: 0 },
      style: { fill: '#ffffff' },
      zIndex: 0,
      syncPolicy: 'detached',
      localPayload: { shapeKind: 'rectangle' },
      lastSyncedSourceRevision: null,
      elementState: 'normal',
    }],
    ...overrides,
  }
}

async function withStore(work) {
  const root = await mkdtemp(join(tmpdir(), 'layout-store-test-'))
  try { return await work(new LayoutPageStore(join(root, 'layouts')), root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

const sourceHash = `sha256:${'a'.repeat(64)}`

test('canonical layout JSON and hashes are deterministic across object key order', () => {
  const left = { b: 2, a: { d: 4, c: 3 } }
  const right = { a: { c: 3, d: 4 }, b: 2 }
  assert.equal(canonicalLayoutJson(left), canonicalLayoutJson(right))
  assert.equal(layoutSha256(left), layoutSha256(right))
})

test('LayoutPageStore publishes immutable objects and a current page ref', async () => {
  await withStore(async store => {
    const written = await store.writePage(layout(), {
      expectedLayoutRevision: -1,
      sourceProjectRevision: 4,
      sourceStateHash: sourceHash,
    })
    assert.equal(written.layout.layoutRevision, 0)
    assert.equal(written.ref.sha256, layoutSha256(canonicalLayoutJson(written.layout)))
    const read = await store.readPage(written.layout.pageId)
    assert.deepEqual(read, { layout: written.layout, ref: written.ref })
    assert.deepEqual(await store.listRefs(), [written.ref])
  })
})

test('semantic no-op reuses the immutable layout revision and object', async () => {
  await withStore(async store => {
    const first = await store.writePage(layout(), { expectedLayoutRevision: -1, sourceProjectRevision: 4, sourceStateHash: sourceHash })
    const second = await store.writePage(first.layout, { expectedLayoutRevision: 0, sourceProjectRevision: 4, sourceStateHash: sourceHash })
    assert.equal(second.noOp, true)
    assert.equal(second.layout.layoutRevision, 0)
    assert.equal(second.ref.sha256, first.ref.sha256)
  })
})

test('layout CAS rejects stale writers and project identity replacement', async () => {
  await withStore(async store => {
    const first = await store.writePage(layout(), { expectedLayoutRevision: -1, sourceProjectRevision: 4, sourceStateHash: sourceHash })
    await assert.rejects(
      store.writePage({ ...first.layout, syncState: 'stale' }, { expectedLayoutRevision: -1, sourceProjectRevision: 5, sourceStateHash: sourceHash }),
      error => error instanceof LayoutPersistenceError && error.code === 'layout_revision_conflict' && error.status === 409,
    )
    await assert.rejects(
      store.writePage({ ...first.layout, projectId: 'project_other' }, { expectedLayoutRevision: 0, sourceProjectRevision: 5, sourceStateHash: sourceHash }),
      error => error instanceof LayoutPersistenceError && error.code === 'layout_identity_mismatch',
    )
  })
})

test('Presentation layout writes preserve unknown files in layouts/', async () => {
  await withStore(async (store, workspaceRoot) => {
    const unknown = join(workspaceRoot, 'layouts', 'external.keep')
    await mkdir(join(workspaceRoot, 'layouts'), { recursive: true })
    await writeFile(unknown, 'owned by a future Presentation component')
    await store.writePage(layout(), { expectedLayoutRevision: -1, sourceProjectRevision: 4, sourceStateHash: sourceHash })
    assert.equal(await readFile(unknown, 'utf8'), 'owned by a future Presentation component')
  })
})

test('production layout root must be the workspace layouts/ directory', () => {
  assert.equal(assertLayoutRootOwnedByPresentation('/workspace/layouts', '/workspace'), '/workspace/layouts')
  assert.throws(
    () => assertLayoutRootOwnedByPresentation('/workspace/pages', '/workspace'),
    error => error instanceof LayoutPersistenceError && error.code === 'layout_root_invalid',
  )
})
