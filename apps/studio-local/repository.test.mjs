import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { createRepository } from './repository.mjs'
import { executeAction } from '../../packages/studio-core/index.mjs'

const importedSnapshot = () => ({
  project: {
    id: 'project_01993e40-0000-7000-8000-000000000010',
    title: '导入项目',
    createdAt: '2026-09-03T08:00:00.000Z',
  },
  outline: [],
  pages: [],
})

async function withRepository(run, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-repository-'))
  let repository
  try {
    repository = await createRepository(dir, options)
    await run({ dir, repository })
  } finally {
    await repository?.close?.()
    await rm(dir, { recursive: true, force: true })
  }
}

test('content transaction persists an immutable snapshot that reloads through ProjectHead', async () => {
  await withRepository(async ({ dir, repository }) => {
    const baseRevision = repository.getState().project.currentRevision
    const committed = await repository.transactContent(
      { baseRevision, source: 'human', detail: { actionType: 'outline.add' } },
      state => executeAction(state, { type: 'outline.add', parentId: null, title: '持久化章节' }).state,
    )
    assert.equal(committed.project.currentRevision, 1)
    assert.equal((await repository.getSnapshotAt(1)).outline[0].title, '持久化章节')
    await repository.close()

    const reopened = await createRepository(dir)
    try {
      assert.equal(reopened.getState().outline[0].title, '持久化章节')
      assert.equal(reopened.getState().project.currentRevision, 1)
      const objects = await readdir(join(dir, 'objects', 'sha256'))
      assert.ok(objects.length >= 4, 'initial and committed Snapshot/Revision objects must exist')
    } finally {
      await reopened.close()
    }
  })
})

test('content-addressed blobs stream 20 MiB once and round-trip their descriptor and bytes', async () => {
  await withRepository(async ({ dir, repository }) => {
    const bytes = Buffer.alloc(20 * 1024 * 1024, 0x5a)
    const expectedHash = createHash('sha256').update(bytes).digest('hex')
    const first = await repository.putBlob(Readable.from([bytes]), { mimeType: 'image/png', originalFileName: 'large.png' })
    const second = await repository.putBlob(Readable.from([bytes]), { mimeType: 'image/png', originalFileName: 'large.png' })
    assert.deepEqual(second, first)
    assert.equal(first.sha256, expectedHash)
    assert.equal(first.sizeBytes, bytes.length)
    assert.deepEqual(Buffer.concat(await Array.fromAsync(await repository.openBlob(first))), bytes)
    const stored = await readdir(join(dir, 'objects', 'sha256'))
    assert.equal(stored.filter(name => name === `${expectedHash}.blob`).length, 1)
    assert.equal(stored.some(name => name.includes('base64')), false)
  })
})

test('legacy page Data URLs remain readable until explicit migration replaces them with ObjectRefs', async () => {
  await withRepository(async ({ repository }) => {
    const base = repository.getState().project.currentRevision
    await repository.transactContent({ baseRevision: base }, state => {
      state = executeAction(state, { type: 'outline.add', parentId: null, title: '旧页面' }).state
      state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
      state.pages[0].assets = [{ id: 'asset_01993e40-0000-7000-8000-000000000002', name: 'old.png', type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }]
      return state
    })
    assert.match(repository.getState().pages[0].assets[0].dataUrl, /^data:/)
    await repository.migrateLegacyAssets()
    const asset = repository.getState().pages[0].assets[0]
    assert.equal('dataUrl' in asset, false)
    assert.match(asset.objectRef.sha256, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(await repository.getSnapshotAt(repository.getState().project.currentRevision)).includes('dataUrl'), false)
  })
})

test('two content transactions from the same base revision have exactly one winner', async () => {
  await withRepository(async ({ repository }) => {
    const baseRevision = repository.getState().project.currentRevision
    const results = await Promise.allSettled([
      repository.transactContent(
        { baseRevision, source: 'human' },
        state => executeAction(state, { type: 'project.rename', title: '并发写入 A' }).state,
      ),
      repository.transactContent(
        { baseRevision, source: 'human' },
        state => executeAction(state, { type: 'project.rename', title: '并发写入 B' }).state,
      ),
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = results.find(result => result.status === 'rejected')
    assert.equal(rejected.reason.code, 'stale_revision')
    assert.equal(repository.getState().project.currentRevision, baseRevision + 1)
  })
})

test('operational transaction does not advance content revision', async () => {
  await withRepository(async ({ repository }) => {
    const before = repository.getState().project.currentRevision
    const state = await repository.transactOperational(current => ({
      ...current,
      annotations: [{ id: 'annotation_test' }],
    }))
    assert.equal(state.project.currentRevision, before)
    assert.equal(state.annotations[0].id, 'annotation_test')
  })
})

test('failure before Head publication leaves the prior Revision visible', async () => {
  let injected = false
  await withRepository(async ({ repository }) => {
    const before = repository.getState()
    await assert.rejects(
      repository.transactContent(
        { baseRevision: before.project.currentRevision, source: 'human' },
        state => executeAction(state, { type: 'project.rename', title: '不可见候选' }).state,
      ),
      /injected-before-head-publish/,
    )
    assert.equal(repository.getState().project.title, before.project.title)
    assert.equal(repository.getState().project.currentRevision, before.project.currentRevision)
  }, {
    faultInjector(point) {
      if (point === 'before_head_publish' && !injected) {
        injected = true
        throw new Error('injected-before-head-publish')
      }
    },
  })
})

test('a second repository writer is rejected until the first closes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-lock-'))
  const first = await createRepository(dir)
  try {
    await assert.rejects(createRepository(dir), error => error.code === 'repository_locked')
    await first.close()
    const second = await createRepository(dir)
    await second.close()
  } finally {
    await first.close().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  }
})

test('standard project initialization replaces the unused root without linking project histories', async () => {
  await withRepository(async ({ dir, repository }) => {
    const initializedProjectId = repository.getState().project.id
    const state = await repository.initializeFromStandardProject({
      snapshot: importedSnapshot(),
      detail: { actionType: 'standard.import', sourceProjectRoot: 'C:\\source-project' },
      ui: { stage: 'outline', activePageId: null },
    })

    assert.notEqual(state.project.id, initializedProjectId)
    assert.equal(state.project.id, importedSnapshot().project.id)
    assert.equal(state.project.currentRevision, 0)
    assert.equal(state.revisions.length, 1)
    assert.equal(state.revisions[0].number, 0)
    assert.equal(state.revisions[0].parentRevision, null)

    const control = JSON.parse(await readFile(repository.controlPath, 'utf8'))
    assert.equal(control.projectHead.projectId, importedSnapshot().project.id)
    assert.equal(control.projectHead.currentRevision, 0)
    const revision = JSON.parse(await readFile(join(dir, 'objects', 'sha256', `${control.projectHead.currentRevisionRef.sha256}.json`), 'utf8'))
    assert.equal(revision.parentRevision, null)
    assert.equal(revision.parentRevisionRef, null)
  })
})

test('failed standard project initialization leaves the prior Head and visible state unchanged', async () => {
  let fail = true
  await withRepository(async ({ repository }) => {
    const beforeState = repository.getState()
    const beforeControl = await readFile(repository.controlPath, 'utf8')

    await assert.rejects(
      repository.initializeFromStandardProject({
        snapshot: importedSnapshot(),
        detail: { actionType: 'standard.import' },
        ui: { stage: 'outline', activePageId: null },
      }),
      /injected-standard-import-failure/,
    )

    assert.deepEqual(repository.getState(), beforeState)
    assert.equal(await readFile(repository.controlPath, 'utf8'), beforeControl)
  }, {
    faultInjector(point) {
      if (point === 'before_standard_import_head_publish' && fail) {
        fail = false
        throw new Error('injected-standard-import-failure')
      }
    },
  })
})
