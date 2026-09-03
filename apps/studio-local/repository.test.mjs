import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, open as openFile, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
    await options.beforeCreate?.(dir)
    repository = await createRepository(dir, options.repositoryOptions ?? options)
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

test('content-addressed blobs stream multi-chunk 20 MiB once across revisions without growing snapshots', async () => {
  await withRepository(async ({ dir, repository }) => {
    const bytes = Buffer.alloc(20 * 1024 * 1024, 0x5a)
    const expectedHash = createHash('sha256').update(bytes).digest('hex')
    const chunks = () => Readable.from(Array.from({ length: 80 }, (_, index) => bytes.subarray(index * 262144, (index + 1) * 262144)))
    const first = await repository.putBlob(chunks(), { mimeType: 'image/png', originalFileName: 'large.png' })
    const second = await repository.putBlob(chunks(), { mimeType: 'image/png', originalFileName: 'large.png' })
    assert.deepEqual(second, first)
    assert.equal(first.sha256, expectedHash)
    assert.equal(first.sizeBytes, bytes.length)
    assert.deepEqual(Buffer.concat(await Array.fromAsync(await repository.openBlob(first))), bytes)
    const stored = await readdir(join(dir, 'objects', 'sha256'))
    assert.equal(stored.filter(name => name === `${expectedHash}.blob`).length, 1)
    assert.equal(stored.some(name => name.includes('base64')), false)
    let state = await repository.transactContent({ baseRevision: 0, source: 'human' }, state => {
      state = executeAction(state, { type: 'outline.add', parentId: null, title: '大图页' }).state
      state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
      state.pages[0].assets = [{ id: 'asset_01993e40-0000-7000-8000-000000000099', name: 'large.png', mimeType: 'image/png', objectRef: first, sizeBytes: first.sizeBytes, sha256: first.sha256 }]
      return state
    })
    state = await repository.transactContent({ baseRevision: state.project.currentRevision, source: 'human' }, value => executeAction(value, { type: 'project.rename', title: '第二个 Revision' }).state)
    const snapshots = await Promise.all([repository.getSnapshotAt(1), repository.getSnapshotAt(2)])
    assert.ok(snapshots.every(snapshot => Buffer.byteLength(JSON.stringify(snapshot)) < 100 * 1024))
    assert.ok(snapshots.every(snapshot => !JSON.stringify(snapshot).match(/dataUrl|dataBase64|[A-Za-z0-9+/]{4096}/)))
    const control = await readFile(join(dir, 'control.json'), 'utf8')
    assert.equal(control.includes('dataUrl'), false)
    assert.equal(control.includes('dataBase64'), false)
    assert.equal(control.includes(bytes.toString('base64')), false)
    assert.equal(control.includes(expectedHash), false)
  })
})

test('verifyBlob rejects a same-size on-disk corruption before it can be opened', async () => {
  await withRepository(async ({ dir, repository }) => {
    const descriptor = await repository.putBlob(Readable.from([Buffer.from('verified bytes')]), { mimeType: 'image/png', originalFileName: 'verified.png' })
    await writeFile(join(dir, 'objects', 'sha256', `${descriptor.sha256}.blob`), Buffer.from('corrupted bytes'))
    await assert.rejects(repository.verifyBlob(descriptor), error => error.code === 'repository_integrity_error')
    await assert.rejects(repository.openBlob(descriptor), error => error.code === 'repository_integrity_error')
  })
})

test('content-addressed Blob handles partial file writes without publishing a truncated file', async () => {
  const partialFileOpen = async (path, flags) => {
    const handle = await openFile(path, flags)
    if (!String(path).endsWith('.blob.tmp')) return handle
    return Object.assign(Object.create(handle), {
      async write(buffer, offset, length, position) {
        return handle.write(buffer, offset, Math.min(3, length), position)
      },
    })
  }
  await withRepository(async ({ repository }) => {
    const bytes = Buffer.from('a partial write must still retain every byte')
    const descriptor = await repository.putBlob(Readable.from([bytes]), { mimeType: 'image/png', originalFileName: 'partial.png' })
    assert.deepEqual(Buffer.concat(await Array.fromAsync(await repository.openBlob(descriptor))), bytes)
  }, { fileOpen: partialFileOpen })
})

test('ordinary content transactions reject recursive inline binary fields even when they claim legacy permission', async () => {
  await withRepository(async ({ repository }) => {
    await assert.rejects(repository.transactContent({ baseRevision: 0, source: 'human' }, state => {
      state = executeAction(state, { type: 'outline.add', parentId: null, title: '拒绝内联二进制' }).state
      state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
      state.pages[0].assets = [{ id: 'asset_01993e40-0000-7000-8000-000000000098', dataUrl: 'data:image/png;base64,AAAA' }]
      return state
    }), error => error.code === 'invalid_command')
    await assert.rejects(repository.transactContent({ baseRevision: 0, source: 'human', allowLegacyDataUrl: true }, state => {
      state = executeAction(state, { type: 'outline.add', parentId: null, title: '嵌套绕过' }).state
      state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
      state.pages[0].assets = [{ id: 'asset_01993e40-0000-7000-8000-000000000097', objectRef: { sha256: 'a'.repeat(64), dataBase64: 'AAAA' }, extensionPayload: { upload: { dataUrl: 'data:image/png;base64,AAAA' }, binary: { type: 'Buffer', data: [1, 2, 3] } } }]
      return state
    }), error => error.code === 'invalid_command')
    assert.equal(repository.getState().project.currentRevision, 0)
  })
})

test('legacy page Data URLs remain readable until explicit migration replaces them with ObjectRefs', async () => {
  await withRepository(async ({ repository }) => {
    assert.match(repository.getState().pages[0].assets[0].dataUrl, /^data:/)
    await repository.applyMigration()
    await repository.migrateLegacyAssets()
    const asset = repository.getState().pages[0].assets[0]
    assert.equal('dataUrl' in asset, false)
    assert.match(asset.objectRef.sha256, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(await repository.getSnapshotAt(repository.getState().project.currentRevision)).includes('dataUrl'), false)
  }, { beforeCreate: async dir => {
    const createdAt = '2026-09-03T00:00:00.000Z'
    await writeFile(join(dir, 'state.json'), `${JSON.stringify({
      schemaVersion: 'report-studio.v0.1.0',
      project: { id: 'project_old', title: '旧项目', currentRevision: 0, createdAt, updatedAt: createdAt },
      outline: [{ id: 'outline_old', title: '旧页面', children: [] }],
      pages: [{ id: 'page_old', outlineNodeId: 'outline_old', heading: '旧页面', body: '', bullets: [], script: '', assets: [{ id: 'asset_old', name: 'old.png', type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }] }],
      annotations: [], reviewRounds: [], reviewSubmissions: [], proposals: [], revisions: [], ui: { stage: 'draft', activePageId: 'page_old' },
    })}\n`)
  } })
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
