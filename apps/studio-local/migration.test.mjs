import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepository } from './repository.mjs'

function legacyState() {
  return {
    schemaVersion: 'report-studio.v0.1.0',
    project: { id: 'project_abc123def456', title: '旧项目', currentRevision: 7, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' },
    outline: [{ id: 'outline_111111111111', title: '旧章节', children: [{ id: 'outline_222222222222', title: '旧子章节', children: [], createdAt: '2026-09-01T00:00:00.000Z' }], createdAt: '2026-09-01T00:00:00.000Z' }],
    pages: [{ id: 'page_333333333333', outlineNodeId: 'outline_222222222222', heading: '旧页面', body: '旧正文', bullets: ['旧要点'], script: '旧讲解稿', assets: [{ id: 'asset_444444444444', name: '示意图.png', type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' }],
    annotations: [{ id: 'annotation_555555555555', scopeKey: 'draft:page_333333333333', reviewRoundId: 'round_666666666666', target: { type: 'page', id: 'page_333333333333', label: '旧页面' }, instruction: '保留意见', lifecycle: 'submitted', resolution: 'open', version: 1, createdAgainstRevision: 7 }],
    reviewRounds: [{ id: 'round_666666666666', scopeKey: 'draft:page_333333333333', status: 'open' }],
    reviewSubmissions: [{ id: 'submission_777777777777', reviewRoundId: 'round_666666666666', number: 1, baseRevision: 7, annotations: [{ id: 'annotation_555555555555', version: 1, target: { type: 'page', id: 'page_333333333333', label: '旧页面' }, instruction: '保留意见', contentHash: 'a'.repeat(64) }], status: 'created' }],
    proposals: [{ id: 'proposal_888888888888', submissionId: 'submission_777777777777', reviewRoundId: 'round_666666666666', baseRevision: 7, message: '旧建议', commands: [{ type: 'draft.update', pageId: 'page_333333333333', patch: { body: '建议正文' } }], status: 'pending' }],
    revisions: [{ id: 'revision_999999999999', number: 7, parentRevision: 6, source: 'human', detail: { legacy: true }, stateHash: 'b'.repeat(64) }],
    ui: { stage: 'draft', activePageId: 'page_333333333333' },
    unknownLegacyField: { mustRemainRecoverable: true },
  }
}

test('legacy data stays read-only until a confirmed backup-first migration succeeds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-migration-'))
  const legacyPath = join(dir, 'state.json')
  const originalBytes = `${JSON.stringify(legacyState(), null, 2)}\n`
  await writeFile(legacyPath, originalBytes, 'utf8')
  const repository = await createRepository(dir)
  try {
    assert.equal(repository.migrationStatus().status, 'migration_required')
    await assert.rejects(repository.transactOperational(state => state), error => error.code === 'migration_required')
    const result = await repository.applyMigration()
    assert.equal(result.status, 'ready')
    assert.equal(repository.getState().project.currentRevision, 7)
    assert.match(repository.getState().project.id, /^project_[0-9a-f-]{36}$/)
    assert.match(repository.getState().pages[0].id, /^page_[0-9a-f-]{36}$/)
    assert.equal(repository.getState().pages[0].outlineNodeId, repository.getState().outline[0].children[0].id)
    assert.equal(repository.getState().annotations[0].target.id, repository.getState().pages[0].id)
    assert.equal(repository.getState().ui.activePageId, repository.getState().pages[0].id)
    assert.equal(await readFile(result.backupPath, 'utf8'), originalBytes)
    assert.deepEqual(JSON.parse(await readFile(legacyPath, 'utf8')), legacyState())
    const map = JSON.parse(await readFile(join(dir, 'migration-map.json'), 'utf8'))
    assert.equal(map.ids['page_333333333333'], repository.getState().pages[0].id)
    await stat(join(dir, 'control.json'))
  } finally {
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('migration failure does not publish control and can be retried with the same id map', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-migration-failure-'))
  await writeFile(join(dir, 'state.json'), `${JSON.stringify(legacyState(), null, 2)}\n`, 'utf8')
  let fail = true
  let repository = await createRepository(dir, {
    faultInjector(point) {
      if (point === 'before_migration_publish' && fail) {
        fail = false
        throw new Error('injected-migration-failure')
      }
    },
  })
  try {
    await assert.rejects(repository.applyMigration(), /injected-migration-failure/)
    assert.equal(repository.migrationStatus().status, 'migration_required')
    await assert.rejects(stat(join(dir, 'control.json')), error => error.code === 'ENOENT')
    const firstMap = await readFile(join(dir, 'migration-map.json'), 'utf8')
    await repository.applyMigration()
    assert.equal(await readFile(join(dir, 'migration-map.json'), 'utf8'), firstMap)
  } finally {
    await repository.close()
    repository = null
  }
  const reopened = await createRepository(dir)
  try { assert.equal(reopened.migrationStatus().status, 'ready') }
  finally { await reopened.close(); await rm(dir, { recursive: true, force: true }) }
})
