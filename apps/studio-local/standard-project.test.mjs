import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRepository } from './repository.mjs'
import { createStandardProjectService } from './standard-project.mjs'
import { executeAction } from '../../packages/studio-core/index.mjs'

const fixtureRoot = resolve('contracts/presentation-standard-project/fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project')
const expectedMessage = '当前工作区已有项目内容或评审历史。为避免覆盖数据，请在新的 DSH Session 或新的空白项目工作区中导入标准项目。'

async function withService(run) {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-standard-service-'))
  const repository = await createRepository(dir)
  try {
    await run({ dir, repository, service: createStandardProjectService(repository) })
  } finally {
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
}

function assertRequiresNewWorkspace(error) {
  assert.equal(error.code, 'standard_import_requires_new_workspace')
  assert.equal(error.statusCode, 409)
  assert.equal(error.message, expectedMessage)
  return true
}

test('standard import rejects a Workspace after content has been committed', async () => {
  await withService(async ({ repository, service }) => {
    await repository.transactContent(
      { baseRevision: 0, source: 'human', detail: { actionType: 'outline.add' } },
      state => executeAction(state, { type: 'outline.add', parentId: null, title: '已有章节' }).state,
    )
    const before = repository.getState()

    await assert.rejects(service.importProject(fixtureRoot), assertRequiresNewWorkspace)
    assert.deepEqual(repository.getState(), before)
  })
})

test('standard import rejects operational history without erasing it or changing source bytes', async () => {
  await withService(async ({ repository, service }) => {
    await repository.transactOperational(state => ({
      ...state,
      annotations: [{ id: 'annotation_existing', instruction: '必须保留' }],
    }))
    const before = repository.getState()
    const sourcePath = join(fixtureRoot, 'project.json')
    const sourceBytes = await readFile(sourcePath)

    await assert.rejects(service.importProject(fixtureRoot), assertRequiresNewWorkspace)

    assert.deepEqual(repository.getState(), before)
    assert.deepEqual(await readFile(sourcePath), sourceBytes)
  })
})

test('standard import rejects migrated revision-zero metadata that no longer matches initialization defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-standard-metadata-'))
  await writeFile(join(dir, 'state.json'), `${JSON.stringify({
    schemaVersion: 'report-studio.v0.1.0',
    project: { id: 'project_legacy', title: '已改名项目', currentRevision: 0, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    outline: [], pages: [], annotations: [], reviewRounds: [], reviewSubmissions: [], proposals: [], reviewRuns: [], revisions: [],
    ui: { stage: 'outline', activePageId: null },
  }, null, 2)}\n`, 'utf8')
  const repository = await createRepository(dir)
  try {
    await repository.applyMigration()
    assert.equal(repository.getState().project.currentRevision, 0)
    await assert.rejects(createStandardProjectService(repository).importProject(fixtureRoot), assertRequiresNewWorkspace)
    assert.equal(repository.getState().project.title, '已改名项目')
  } finally {
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('standard import into an unused Workspace adopts the source project as revision zero', async () => {
  await withService(async ({ repository, service }) => {
    const initializedProjectId = repository.getState().project.id
    const result = await service.importProject(fixtureRoot)

    assert.equal(result.state.project.id, 'project_01992a80-0000-7000-8000-000000000001')
    assert.notEqual(result.state.project.id, initializedProjectId)
    assert.equal(result.state.project.currentRevision, 0)
    assert.equal(result.state.revisions.length, 1)
    assert.equal(result.state.revisions[0].parentRevision, null)
  })
})
