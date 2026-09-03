import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepository } from './repository.mjs'
import { executeAction } from '../../packages/studio-core/index.mjs'

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
