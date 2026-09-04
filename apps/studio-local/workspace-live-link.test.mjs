import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'

const liveLink = await import('./workspace-live-link.mjs').catch(() => ({}))
const fixtureRoot = resolve(new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/u, '$1'))

async function makeWorkspace(prefix = 'presentation-live-link-') {
  const workspaceRoot = await mkdtemp(join(tmpdir(), prefix))
  await cp(fixtureRoot, workspaceRoot, { recursive: true })
  return workspaceRoot
}

function memoryBlobStore() {
  const files = []
  return {
    files,
    async putBlob(source, input) {
      let sizeBytes = 0
      for await (const chunk of source) sizeBytes += Buffer.byteLength(chunk)
      files.push(input.originalFileName)
      return {
        sha256: input.sha256 ?? 'a'.repeat(64),
        sizeBytes: input.sizeBytes ?? sizeBytes,
        mimeType: input.mimeType,
        originalFileName: input.originalFileName,
      }
    },
  }
}

test('resolveWorkspaceRoot accepts a real absolute directory and rejects a symlink root', async () => {
  assert.equal(typeof liveLink.resolveWorkspaceRoot, 'function')
  const root = await mkdtemp(join(tmpdir(), 'presentation-live-root-'))
  const link = `${root}-junction`
  try {
    assert.equal(await liveLink.resolveWorkspaceRoot(root), await lstat(root).then(() => resolve(root)))
    await symlink(root, link, 'junction')
    await assert.rejects(liveLink.resolveWorkspaceRoot(link), error => error.code === 'workspace_unavailable')
    await assert.rejects(liveLink.resolveWorkspaceRoot('relative/project'), error => error.code === 'workspace_unavailable')
  } finally {
    await rm(link, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('readWorkspaceSnapshot reports missing and Contract-invalid projects without a candidate', async () => {
  assert.equal(typeof liveLink.readWorkspaceSnapshot, 'function')
  const missing = await mkdtemp(join(tmpdir(), 'presentation-live-missing-'))
  const invalid = await makeWorkspace('presentation-live-invalid-')
  try {
    const absent = await liveLink.readWorkspaceSnapshot(missing, memoryBlobStore())
    assert.equal(absent.status, 'workspace_project_missing')
    assert.equal(absent.snapshot, null)

    const outlinePath = join(invalid, 'outline.json')
    await writeFile(outlinePath, '{"incomplete":true}\n', 'utf8')
    const broken = await liveLink.readWorkspaceSnapshot(invalid, memoryBlobStore())
    assert.equal(broken.status, 'workspace_contract_invalid')
    assert.equal(broken.snapshot, null)
    assert.ok(broken.validation.errors.length > 0)
  } finally {
    await rm(missing, { recursive: true, force: true })
    await rm(invalid, { recursive: true, force: true })
  }
})

test('readWorkspaceSnapshot loads the full Contract project and exposes a stable Pre source revision', async () => {
  assert.equal(typeof liveLink.readWorkspaceSnapshot, 'function')
  const workspaceRoot = await makeWorkspace()
  const store = memoryBlobStore()
  try {
    const first = await liveLink.readWorkspaceSnapshot(workspaceRoot, store)
    const second = await liveLink.readWorkspaceSnapshot(workspaceRoot, store)
    assert.equal(first.status, 'connected')
    assert.equal(first.validation.valid, true)
    assert.equal(first.projectId, 'project_01992a80-0000-7000-8000-000000000101')
    assert.equal(first.standardVersion, '0.1.0')
    assert.equal(first.sourceRevision, 42)
    assert.deepEqual(first.sourceRevisions, [{ provider: 'pre-design', sourceProjectId: 'project_001', sourceRevision: 42 }])
    assert.match(first.fingerprint, /^[a-f0-9]{64}$/u)
    assert.equal(second.fingerprint, first.fingerprint)
    assert.equal(first.snapshot.pages.length, 2)
    assert.equal(first.snapshot.pages[0].scriptBlocks.length, 1)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('Workspace Live Link archives only Contract-managed source and asset files', async () => {
  assert.equal(typeof liveLink.readWorkspaceSnapshot, 'function')
  const workspaceRoot = await makeWorkspace()
  const store = memoryBlobStore()
  try {
    await mkdir(join(workspaceRoot, 'layouts'), { recursive: true })
    await writeFile(join(workspaceRoot, 'layouts', 'user-layout.json'), '{"keep":true}\n', 'utf8')
    await writeFile(join(workspaceRoot, 'meeting-notes.txt'), 'do not ingest\n', 'utf8')

    const result = await liveLink.readWorkspaceSnapshot(workspaceRoot, store)
    const archived = result.snapshot.project.extensionPayload.standardArchive.files.map(file => file.relativePath).sort()
    assert.deepEqual(archived, [
      'assets/charts/场地面积摘要.svg',
      'source-materials/data/场地指标.csv',
    ])
    assert.equal(store.files.includes('user-layout.json'), false)
    assert.equal(store.files.includes('meeting-notes.txt'), false)
    assert.equal(await readFile(join(workspaceRoot, 'layouts', 'user-layout.json'), 'utf8'), '{"keep":true}\n')
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('memory blob test helper accepts async byte streams', async () => {
  const store = memoryBlobStore()
  const descriptor = await store.putBlob(Readable.from([Buffer.from('abc')]), { originalFileName: 'a.txt', mimeType: 'text/plain' })
  assert.equal(descriptor.sizeBytes, 3)
})
