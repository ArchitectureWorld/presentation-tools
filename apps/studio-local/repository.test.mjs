import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, open as openFile, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { createRepository } from './repository.mjs'
import { beginReviewDispatch, createInitialState, executeAction, submitReviewRound } from '../../packages/studio-core/index.mjs'
import { canonicalFromState } from '../../packages/studio-contracts/index.mjs'

const importedSnapshot = () => ({
  project: {
    id: 'project_01993e40-0000-7000-8000-000000000010',
    projectId: 'project_01993e40-0000-7000-8000-000000000010',
    projectRulesId: 'project_rules_01993e40-0000-7000-8000-000000000010',
    outlineDocumentId: 'outline_01993e40-0000-7000-8000-000000000010',
    title: '导入项目',
    createdAt: '2026-09-03T08:00:00.000Z',
  },
  outline: [],
  pages: [],
})

function upstreamSnapshot() {
  let state = createInitialState()
  state = executeAction(state, { type: 'outline.add', parentId: null, title: '第一批次' }).state
  const firstNodeId = state.outline[0].id
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: firstNodeId }).state
  state = executeAction(state, { type: 'outline.add', parentId: null, title: '第二批次' }).state
  const secondNodeId = state.outline[1].id
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: secondNodeId }).state
  const snapshot = canonicalFromState(state)
  snapshot.project.title = 'Pre Workspace 项目'
  return snapshot
}

function canonicalJson(value) {
  const sortValue = entry => Array.isArray(entry)
    ? entry.map(sortValue)
    : (!entry || typeof entry !== 'object')
      ? entry
      : Object.fromEntries(Object.keys(entry).sort().map(key => [key, sortValue(entry[key])]))
  return JSON.stringify(sortValue(value))
}

async function replaceContentAddressedObject(directory, value) {
  const payload = canonicalJson(value)
  const sha256 = createHash('sha256').update(payload).digest('hex')
  await writeFile(join(directory, 'objects', 'sha256', `${sha256}.json`), payload, 'utf8')
  return { sha256 }
}

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

test('upstream publishing adopts revision zero then preserves operational state and repairs activePageId', async () => {
  await withRepository(async ({ repository }) => {
    assert.equal(typeof repository.publishUpstreamSnapshot, 'function')
    const first = upstreamSnapshot()
    let state = await repository.publishUpstreamSnapshot({
      snapshot: first,
      fingerprint: '1'.repeat(64),
      workspaceRoot: 'C:\\workspace-a',
      sourceRevision: 42,
      sourceRevisions: [{ provider: 'pre-design', sourceProjectId: 'project_001', sourceRevision: 42 }],
    })
    assert.equal(state.project.currentRevision, 0)
    assert.equal(state.revisions[0].source, 'workspace_upstream')
    assert.equal(state.revisions[0].detail.fingerprint, '1'.repeat(64))
    assert.equal(state.ui.activePageId, first.pages[0].id)

    state = await repository.transactOperational(current => executeAction(current, {
      type: 'annotation.add',
      scopeKey: 'outline:root',
      instruction: '运行态必须保留',
    }).state)
    state = await repository.transactOperational(current => ({
      ...current,
      ui: { ...current.ui, stage: 'draft', activePageId: first.pages[1].id },
    }))

    const second = structuredClone(first)
    second.pages[0].contentBlocks[0].content = 'Pre Revision 43 内容'
    state = await repository.publishUpstreamSnapshot({
      snapshot: second,
      fingerprint: '2'.repeat(64),
      workspaceRoot: 'C:\\workspace-a',
      sourceRevision: 43,
      sourceRevisions: [{ provider: 'pre-design', sourceProjectId: 'project_001', sourceRevision: 43 }],
    })
    assert.equal(state.project.currentRevision, 1)
    assert.equal(state.revisions.at(-1).source, 'workspace_upstream')
    assert.equal(state.annotations.length, 1)
    assert.equal(state.ui.activePageId, first.pages[1].id)

    const third = structuredClone(second)
    third.pages = third.pages.filter(page => page.id !== first.pages[1].id)
    state = await repository.publishUpstreamSnapshot({
      snapshot: third,
      fingerprint: '3'.repeat(64),
      workspaceRoot: 'C:\\workspace-a',
      sourceRevision: 44,
      sourceRevisions: [{ provider: 'pre-design', sourceProjectId: 'project_001', sourceRevision: 44 }],
    })
    assert.equal(state.project.currentRevision, 2)
    assert.equal(state.annotations.length, 1)
    assert.equal(state.ui.activePageId, third.pages[0].id)

    state = await repository.publishUpstreamSnapshot({
      snapshot: third,
      fingerprint: '3'.repeat(64),
      workspaceRoot: 'C:\\workspace-a',
      sourceRevision: 44,
      sourceRevisions: [{ provider: 'pre-design', sourceProjectId: 'project_001', sourceRevision: 44 }],
    })
    assert.equal(state.project.currentRevision, 2)
  })
})

test('reopens a legacy canonical snapshot by deriving required project identities from its stable project id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-legacy-canonical-'))
  let repository = await createRepository(dir)
  try {
    const initialProjectId = repository.getState().project.projectId
    await repository.close()
    repository = null
    const control = JSON.parse(await readFile(join(dir, 'control.json'), 'utf8'))
    const revisionPath = join(dir, 'objects', 'sha256', `${control.projectHead.currentRevisionRef.sha256}.json`)
    const revision = JSON.parse(await readFile(revisionPath, 'utf8'))
    const snapshotPath = join(dir, 'objects', 'sha256', `${revision.snapshotRef.sha256}.json`)
    const storedSnapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
    delete storedSnapshot.value.project.projectId
    delete storedSnapshot.value.project.projectRulesId
    delete storedSnapshot.value.project.outlineDocumentId
    revision.snapshotRef = await replaceContentAddressedObject(dir, storedSnapshot)
    control.projectHead.currentRevisionRef = await replaceContentAddressedObject(dir, revision)
    await writeFile(join(dir, 'control.json'), `${JSON.stringify(control, null, 2)}\n`, 'utf8')

    repository = await createRepository(dir)
    const state = repository.getState()
    assert.equal(state.project.projectId, initialProjectId)
    assert.match(state.project.projectRulesId, /^project_rules_[0-9a-f-]{36}$/)
    assert.match(state.project.outlineDocumentId, /^outline_[0-9a-f-]{36}$/)
  } finally {
    await repository?.close?.()
    await rm(dir, { recursive: true, force: true })
  }
})

test('reopens a simplified historical canonical snapshot from its immutable legacy migration source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-historical-canonical-'))
  const createdAt = '2026-09-03T00:00:00.000Z'
  const legacy = {
    schemaVersion: 'report-studio.v0.1.1',
    project: { id: 'project_old', title: '历史项目', currentRevision: 9, createdAt, updatedAt: createdAt },
    outline: [{ id: 'outline_old', title: '历史章节', children: [] }],
    pages: [{ id: 'page_old', outlineNodeId: 'outline_old', heading: '历史页面', body: '历史正文', bullets: ['历史要点'], script: '历史讲解稿', assets: [] }],
    annotations: [], reviewRounds: [], reviewSubmissions: [], proposals: [], revisions: [], ui: { stage: 'draft', activePageId: 'page_old' },
  }
  await writeFile(join(dir, 'state.json'), `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
  let repository = await createRepository(dir)
  try {
    await repository.applyMigration()
    await repository.close()
    repository = null
    const controlPath = join(dir, 'control.json')
    const control = JSON.parse(await readFile(controlPath, 'utf8'))
    const revisionPath = join(dir, 'objects', 'sha256', `${control.projectHead.currentRevisionRef.sha256}.json`)
    const revision = JSON.parse(await readFile(revisionPath, 'utf8'))
    revision.snapshotRef = await replaceContentAddressedObject(dir, {
      kind: 'CanonicalSnapshot',
      value: { project: legacy.project, outline: legacy.outline, pages: legacy.pages },
    })
    control.projectHead.currentRevisionRef = await replaceContentAddressedObject(dir, revision)
    await writeFile(controlPath, `${JSON.stringify(control, null, 2)}\n`, 'utf8')
    const migrationMapPath = join(dir, 'migration-map.json')
    const historicalMap = JSON.parse(await readFile(migrationMapPath, 'utf8'))
    for (const key of Object.keys(historicalMap.ids)) {
      if (key.startsWith(`${legacy.pages[0].id}:`)) delete historicalMap.ids[key]
    }
    await writeFile(migrationMapPath, `${JSON.stringify(historicalMap, null, 2)}\n`, 'utf8')
    const controlBeforeOpen = await readFile(controlPath, 'utf8')
    const migrationMapBeforeOpen = await readFile(migrationMapPath, 'utf8')

    repository = await createRepository(dir)
    const state = repository.getState()
    const page = state.pages[0]
    assert.match(state.outline[0].outlineNodeId, /^outline_node_[0-9a-f-]{36}$/)
    assert.equal(page.outlineNodeId, state.outline[0].outlineNodeId)
    assert.match(page.draftDocumentId, /^draft_page_[0-9a-f-]{36}$/)
    assert.match(page.contentBlocks[0].contentBlockId, /^content_block_[0-9a-f-]{36}$/)
    assert.match(page.scriptBlocks[0].scriptBlockId, /^script_block_[0-9a-f-]{36}$/)
    assert.equal(await readFile(controlPath, 'utf8'), controlBeforeOpen)
    assert.equal(await readFile(migrationMapPath, 'utf8'), migrationMapBeforeOpen)
    const identities = {
      outlineNodeId: state.outline[0].outlineNodeId,
      draftDocumentId: page.draftDocumentId,
      contentBlockId: page.contentBlocks[0].contentBlockId,
      scriptBlockId: page.scriptBlocks[0].scriptBlockId,
    }
    await repository.close()
    repository = await createRepository(dir)
    const reopened = repository.getState()
    assert.deepEqual({
      outlineNodeId: reopened.outline[0].outlineNodeId,
      draftDocumentId: reopened.pages[0].draftDocumentId,
      contentBlockId: reopened.pages[0].contentBlocks[0].contentBlockId,
      scriptBlockId: reopened.pages[0].scriptBlocks[0].scriptBlockId,
    }, identities)
  } finally {
    await repository?.close?.()
    await rm(dir, { recursive: true, force: true })
  }
})

test('pending ReviewRun and immutable Submission persist across repository restart', async () => {
  await withRepository(async ({ dir, repository }) => {
    let submitted
    let begun
    await repository.transactOperational(state => {
      state = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', instruction: '重启后继续' }).state
      submitted = submitReviewRound(state, { scopeKey: 'outline:root' })
      begun = beginReviewDispatch(submitted.state, submitted.submission.id, { sessionId: 'restart-session', leaseMs: 60_000 })
      return begun.state
    })
    await repository.close()

    const reopened = await createRepository(dir)
    try {
      const state = reopened.getState()
      assert.equal(state.reviewSubmissions[0].id, submitted.submission.id)
      assert.equal(state.reviewSubmissions[0].idempotencyKey, submitted.submission.idempotencyKey)
      assert.equal(state.reviewSubmissions[0].status, 'pending_dispatch')
      assert.equal(state.reviewRuns[0].reviewRunId, begun.reviewRun.reviewRunId)
      assert.equal(state.reviewRuns[0].integrationState, 'pending_dispatch')
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

test('opaque extension JSON may use ordinary inline and bytes field names', async () => {
  await withRepository(async ({ repository }) => {
    const state = await repository.transactContent({ baseRevision: 0, source: 'human' }, current => {
      current.project.extensionPayload = {
        opaqueVendorData: {
          inline: { label: '普通结构化值' },
          bytes: { requested: 12, delivered: 8 },
          binary: false,
          rawdata: ['分类', '摘要'],
        },
      }
      return current
    })
    assert.deepEqual(state.project.extensionPayload.opaqueVendorData.bytes, { requested: 12, delivered: 8 })
  })
})

test('iterative guard rejects a deep large Buffer before any JSON serialization', async () => {
  await withRepository(async ({ repository }) => {
    const payload = Buffer.alloc(2 * 1024 * 1024, 0x5a)
    payload.toJSON = () => { throw new Error('must not serialize Buffer') }
    await assert.rejects(repository.transactContent({ baseRevision: 0, source: 'human' }, current => {
      const opaqueVendorData = {}
      let cursor = opaqueVendorData
      for (let level = 0; level < 4096; level += 1) {
        cursor.child = {}
        cursor = cursor.child
      }
      cursor.value = payload
      current.project.extensionPayload = { opaqueVendorData }
      return current
    }), error => error.code === 'invalid_command')
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

test('canonical no-op content transaction keeps Head, revisions and Proposal state unchanged', async () => {
  await withRepository(async ({ dir, repository }) => {
    const seeded = await repository.transactContent(
      { baseRevision: 0, source: 'human', detail: { actionType: 'outline.add' } },
      state => executeAction(state, { type: 'outline.add', parentId: null, title: '保持不变的章节' }).state,
    )
    const proposal = { id: 'proposal_test', status: 'pending', baseRevision: seeded.project.currentRevision }
    await repository.transactOperational(state => ({ ...state, proposals: [proposal] }))
    const beforeControl = await readFile(join(dir, 'control.json'), 'utf8')
    const before = repository.getState()

    const after = await repository.transactContent(
      { baseRevision: before.project.currentRevision, source: 'human', detail: { actionType: 'outline.rename' } },
      state => executeAction(state, { type: 'outline.rename', nodeId: state.outline[0].id, title: '保持不变的章节' }).state,
    )

    assert.equal(after.project.currentRevision, before.project.currentRevision)
    assert.equal(after.revisions.length, before.revisions.length)
    assert.equal(after.proposals[0].status, 'pending')
    assert.equal(await readFile(join(dir, 'control.json'), 'utf8'), beforeControl)
  })
})

test('invalid boundary move is a canonical no-op and does not create a Revision', async () => {
  await withRepository(async ({ repository }) => {
    let state = await repository.transactContent(
      { baseRevision: 0, source: 'human', detail: { actionType: 'outline.add' } },
      current => executeAction(current, { type: 'outline.add', parentId: null, title: '唯一章节' }).state,
    )
    const before = state.project.currentRevision
    state = await repository.transactContent(
      { baseRevision: before, source: 'human', detail: { actionType: 'outline.move' } },
      current => executeAction(current, { type: 'outline.move', nodeId: current.outline[0].id, direction: 'up' }).state,
    )
    assert.equal(state.project.currentRevision, before)
    assert.equal(state.revisions.at(-1).number, before)
  })
})

test('View stage and page changes stay operational without advancing the content Revision', async () => {
  await withRepository(async ({ repository }) => {
    let state = await repository.transactContent(
      { baseRevision: 0, source: 'human', detail: { actionType: 'outline.add' } },
      current => executeAction(current, { type: 'outline.add', parentId: null, title: '查看页' }).state,
    )
    state = await repository.transactContent(
      { baseRevision: state.project.currentRevision, source: 'human', detail: { actionType: 'draft.ensurePage' } },
      current => executeAction(current, { type: 'draft.ensurePage', outlineNodeId: current.outline[0].id }).state,
    )
    const before = state.project.currentRevision
    state = await repository.transactOperational(current => executeAction(current, { type: 'ui.setStage', stage: 'outline' }).state)
    state = await repository.transactOperational(current => executeAction(current, { type: 'ui.setPage', pageId: current.pages[0].id }).state)
    assert.equal(state.project.currentRevision, before)
    assert.equal(state.ui.stage, 'outline')
    assert.equal(state.ui.activePageId, state.pages[0].id)
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
