import test from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRepository } from './repository.mjs'
import { createStandardProjectService, publishDirectoryNoReplace } from './standard-project.mjs'
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

test('standard export publishes a Contract-valid project from a private staging directory', async () => {
  await withService(async ({ dir, service }) => {
    const result = await service.exportProject()
    assert.match(result.projectRoot, new RegExp(`^${dir.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}[\\\\/]exports[\\\\/]`))
    assert.equal(result.validation.valid, true)
    assert.deepEqual(await readdir(join(dir, 'exports', '.staging')), [])
  })
})

test('standard exports started together publish distinct final directories', async () => {
  await withService(async ({ service }) => {
    const [left, right] = await Promise.all([service.exportProject(), service.exportProject()])
    assert.notEqual(left.projectRoot, right.projectRoot)
    assert.equal(left.validation.valid, true)
    assert.equal(right.validation.valid, true)
  })
})

test('standard export cleans its staging directory when Blob restoration fails', async () => {
  await withService(async ({ dir, repository, service }) => {
    await service.importProject(resolve('contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief'))
    repository.openBlob = async () => { throw new Error('injected blob read failure') }

    await assert.rejects(service.exportProject(), error => error.code === 'standard_export_failed' && error.statusCode === 500)
    assert.deepEqual(await readdir(join(dir, 'exports', '.staging')), [])
    assert.deepEqual(await readdir(join(dir, 'exports')), ['.staging'])
  })
})

test('standard export never overwrites an existing final directory', async () => {
  await withService(async ({ dir, repository }) => {
    const targetName = 'forced-export-target'
    const exportsRoot = join(dir, 'exports')
    const target = join(exportsRoot, targetName)
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'sentinel.txt'), 'unchanged')
    const service = createStandardProjectService(repository, { exportDirectoryName: () => targetName })

    await assert.rejects(service.exportProject(), error => error.code === 'standard_export_failed' && error.details?.finalRoot === target)
    assert.equal(await readFile(join(target, 'sentinel.txt'), 'utf8'), 'unchanged')
    assert.deepEqual(await readdir(join(exportsRoot, '.staging')), [])
  })
})

test('standard export cleans staging and returns a Studio error when final rename fails', async () => {
  await withService(async ({ dir, repository }) => {
    const exportsRoot = join(dir, 'exports')
    const service = createStandardProjectService(repository, {
      exportDirectoryName: () => 'rename-failure',
      async publishDirectoryNoReplace() { throw new Error('injected rename failure') },
    })

    await assert.rejects(service.exportProject(), error => error.code === 'standard_export_failed' && error.details?.cause?.message === 'injected rename failure')
    assert.deepEqual(await readdir(join(exportsRoot, '.staging')), [])
    assert.deepEqual(await readdir(exportsRoot), ['.staging'])
  })
})

test('standard export removes staging when the frozen Contract validator rejects generated documents', async () => {
  await withService(async ({ dir, repository, service }) => {
    await service.importProject(resolve('contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief'))
    const baseRevision = repository.getState().project.currentRevision
    await repository.transactContent(
      { baseRevision, source: 'human', detail: { actionType: 'test.corrupt-standard-document' } },
      state => ({
        ...state,
        project: {
          ...state.project,
          extensionPayload: {
            ...state.project.extensionPayload,
            standardArchive: {
              ...state.project.extensionPayload.standardArchive,
              documents: {
                ...state.project.extensionPayload.standardArchive.documents,
                'rules.json': {},
              },
            },
          },
        },
      }),
    )

    await assert.rejects(service.exportProject(), error => error.code === 'standard_contract_invalid')
    assert.deepEqual(await readdir(join(dir, 'exports', '.staging')), [])
    assert.deepEqual(await readdir(join(dir, 'exports')), ['.staging'])
  })
})

test('standard exports retain UUID uniqueness when the clock is fixed to one millisecond', async () => {
  await withService(async ({ dir, repository }) => {
    const ids = ['uuid-a', 'uuid-b']
    const service = createStandardProjectService(repository, {
      clock: () => new Date('2026-09-03T08:00:00.000Z'),
      randomUUID: () => ids.shift(),
    })
    const [left, right] = await Promise.all([service.exportProject(), service.exportProject()])
    assert.match(left.projectRoot, new RegExp(`${dir.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}[\\\\/]exports[\\\\/]2026-09-03T08-00-00.000Z-uuid-a`))
    assert.match(right.projectRoot, new RegExp(`${dir.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}[\\\\/]exports[\\\\/]2026-09-03T08-00-00.000Z-uuid-b`))
  })
})

test('standard export atomically claims its final batch parent before any project folder is published', async () => {
  await withService(async ({ dir, repository }) => {
    const targetName = 'batch-claim-target'
    const exportsRoot = join(dir, 'exports')
    const target = join(exportsRoot, targetName)
    let claimed = false
    let competingClaimError = null
    const service = createStandardProjectService(repository, {
      exportDirectoryName: () => targetName,
      fileSystem: {
        async mkdir(path, options) {
          const result = await mkdir(path, options)
          if (path === target) {
            claimed = true
            await assert.rejects(mkdir(target), error => {
              competingClaimError = error
              return error.code === 'EEXIST'
            })
          }
          return result
        },
        lstat,
        open,
        rename,
        rm,
        rmdir,
      },
    })

    const result = await service.exportProject()
    assert.equal(claimed, true)
    assert.equal(competingClaimError?.code, 'EEXIST')
    assert.equal(result.validation.valid, true)
    assert.match(result.projectRoot, new RegExp(`${target.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}[\\\\/]`))
    assert.deepEqual(await readdir(join(exportsRoot, '.staging')), [])
  })
})

test('standard export batch claim lets concurrent publishers with one final name produce at most one result', async () => {
  await withService(async ({ dir, repository }) => {
    const exportsRoot = join(dir, 'exports')
    const service = createStandardProjectService(repository, { exportDirectoryName: () => 'shared-final-name' })
    const results = await Promise.allSettled([service.exportProject(), service.exportProject()])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'standard_export_failed').length, 1)
    assert.deepEqual(await readdir(join(exportsRoot, '.staging')), [])
    assert.deepEqual((await readdir(exportsRoot)).sort(), ['.staging', 'shared-final-name'])
  })
})

test('standard export stays successful when post-publication staging cleanup fails', async () => {
  await withService(async ({ dir, repository }) => {
    let cleanupAttempts = 0
    const service = createStandardProjectService(repository, {
      exportDirectoryName: () => 'cleanup-failure',
      fileSystem: {
        mkdir,
        lstat,
        open,
        rename,
        rmdir,
        async rm(path, options) {
          if (path.includes(`${join('exports', '.staging')}`)) {
            cleanupAttempts += 1
            if (cleanupAttempts === 1) throw new Error('injected staging cleanup failure')
          }
          return rm(path, options)
        },
      },
      cleanupRetryDelayMs: 0,
    })
    const result = await service.exportProject()
    assert.equal(cleanupAttempts, 1)
    assert.equal(result.validation.valid, true)
    assert.equal(result.cleanup?.status, 'pending')
    assert.ok(await readFile(join(result.projectRoot, 'project.json')))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(cleanupAttempts, 2)
    assert.deepEqual(await service.retryPendingStagingCleanup(), [])
  })
})

test('standard export refuses a final project directory that appears at the no-clobber publish call', async () => {
  await withService(async ({ dir, repository }) => {
    const targetName = 'publish-race'
    const finalBatch = join(dir, 'exports', targetName)
    let publishAttempted = false
    let destinationSeen = null
    const service = createStandardProjectService(repository, {
      exportDirectoryName: () => targetName,
      async publishDirectoryNoReplace(source, destination) {
        publishAttempted = true
        destinationSeen = destination
        await mkdir(destination)
        await writeFile(join(destination, 'sentinel.txt'), 'appeared-at-publish')
        return publishDirectoryNoReplace(source, destination)
      },
    })

    await assert.rejects(service.exportProject(), error => error.code === 'standard_export_failed')
    assert.equal(publishAttempted, true)
    assert.match(destinationSeen, new RegExp(`${finalBatch.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}[\\\\/]`))
    assert.equal(await readFile(join(destinationSeen, 'sentinel.txt'), 'utf8'), 'appeared-at-publish')
  })
})
