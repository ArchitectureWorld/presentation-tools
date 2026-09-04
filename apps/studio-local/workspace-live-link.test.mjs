import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
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

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Workspace watcher state')
    await delay(10)
  }
}

function fakeWatchHarness() {
  const registrations = []
  const watchFactory = (path, options, listener) => {
    const callback = typeof options === 'function' ? options : listener
    const registration = { path, callback, closed: false }
    registrations.push(registration)
    return { close() { registration.closed = true } }
  }
  return {
    registrations,
    watchFactory,
    emit(eventType = 'change', filename = 'outline.json') {
      for (const registration of registrations.filter(item => !item.closed)) registration.callback(eventType, filename)
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

test('Workspace watcher debounces consecutive managed-file events into one validated candidate', async () => {
  assert.equal(typeof liveLink.createWorkspaceWatcher, 'function')
  const workspaceRoot = await makeWorkspace('presentation-live-debounce-')
  const harness = fakeWatchHarness()
  const candidates = []
  const statuses = []
  const watcher = liveLink.createWorkspaceWatcher({
    workspaceRoot,
    putBlob: memoryBlobStore().putBlob,
    debounceMs: 30,
    watchFactory: harness.watchFactory,
    onCandidate: candidate => candidates.push(candidate),
    onStatus: status => statuses.push(status),
  })
  try {
    await watcher.start()
    assert.equal(candidates.length, 1)
    const outlinePath = join(workspaceRoot, 'outline.json')
    const rulesPath = join(workspaceRoot, 'rules.json')
    const outline = JSON.parse(await readFile(outlinePath, 'utf8'))
    const rules = JSON.parse(await readFile(rulesPath, 'utf8'))
    outline.nodes[0].title = '防抖后的合法标题'
    rules.visualIntent = ['保持克制']
    await writeFile(outlinePath, `${JSON.stringify(outline, null, 2)}\n`, 'utf8')
    harness.emit('change', 'outline.json')
    await writeFile(rulesPath, `${JSON.stringify(rules, null, 2)}\n`, 'utf8')
    harness.emit('rename', 'rules.json')
    harness.emit('change', 'rules.json')
    await waitFor(() => candidates.length >= 2)
    await delay(100)
    assert.equal(candidates.length, 2)
    assert.notEqual(candidates[1].fingerprint, candidates[0].fingerprint)
    assert.equal(statuses.at(-1).status, 'connected')
  } finally {
    await watcher.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('Workspace watcher retains the last legal snapshot through invalid atomic writes and recovers', async () => {
  assert.equal(typeof liveLink.createWorkspaceWatcher, 'function')
  const workspaceRoot = await makeWorkspace('presentation-live-recovery-')
  const harness = fakeWatchHarness()
  const candidates = []
  const statuses = []
  const watcher = liveLink.createWorkspaceWatcher({
    workspaceRoot,
    putBlob: memoryBlobStore().putBlob,
    debounceMs: 25,
    watchFactory: harness.watchFactory,
    onCandidate: candidate => candidates.push(candidate),
    onStatus: status => statuses.push(status),
  })
  try {
    await watcher.start()
    const outlinePath = join(workspaceRoot, 'outline.json')
    const valid = await readFile(outlinePath, 'utf8')
    await writeFile(outlinePath, '{"partial":', 'utf8')
    harness.emit('rename', 'outline.json')
    await waitFor(() => statuses.at(-1)?.status === 'workspace_contract_invalid')
    assert.equal(candidates.length, 1)
    assert.equal(statuses.at(-1).status, 'workspace_contract_invalid')
    assert.equal(statuses.at(-1).lastValidFingerprint, candidates[0].fingerprint)

    const replacement = `${outlinePath}.replacement`
    const restored = JSON.parse(valid)
    restored.nodes[0].summary = '原子替换后恢复'
    await writeFile(replacement, `${JSON.stringify(restored, null, 2)}\n`, 'utf8')
    await rm(outlinePath, { force: true })
    await rename(replacement, outlinePath)
    harness.emit('rename', 'outline.json')
    await waitFor(() => candidates.length >= 2)
    assert.equal(candidates.length, 2)
    assert.equal(statuses.at(-1).status, 'connected')
    assert.ok(harness.registrations.some(item => item.path.endsWith('pages')))
    assert.ok(harness.registrations.some(item => item.path.endsWith(join('pages', 'drafts'))))
  } finally {
    await watcher.close()
    assert.ok(harness.registrations.every(item => item.closed))
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('Workspace watcher observes a real Windows atomic replacement and publishes the stable project', async () => {
  assert.equal(typeof liveLink.createWorkspaceWatcher, 'function')
  const workspaceRoot = await makeWorkspace('presentation-live-real-watch-')
  const candidates = []
  const watcher = liveLink.createWorkspaceWatcher({
    workspaceRoot,
    putBlob: memoryBlobStore().putBlob,
    debounceMs: 40,
    onCandidate: candidate => candidates.push(candidate),
  })
  try {
    await watcher.start()
    const outlinePath = join(workspaceRoot, 'outline.json')
    const outline = JSON.parse(await readFile(outlinePath, 'utf8'))
    outline.nodes[0].title = '真实 Windows 原子替换后的标题'
    const replacement = `${outlinePath}.replacement`
    await writeFile(replacement, `${JSON.stringify(outline, null, 2)}\n`, 'utf8')
    await rm(outlinePath, { force: true })
    await rename(replacement, outlinePath)
    await waitFor(() => candidates.length >= 2, 5000)
    assert.equal(candidates.length, 2)
    assert.equal(candidates[1].snapshot.project.extensionPayload.standardArchive.documents['outline.json'].nodes[0].title, '真实 Windows 原子替换后的标题')
    assert.equal(watcher.status().status, 'connected')
  } finally {
    await watcher.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('Workspace watcher detects draft creation, modification and deletion plus asset-manifest changes', async () => {
  assert.equal(typeof liveLink.createWorkspaceWatcher, 'function')
  const workspaceRoot = await makeWorkspace('presentation-live-managed-events-')
  const harness = fakeWatchHarness()
  const candidates = []
  const statuses = []
  const watcher = liveLink.createWorkspaceWatcher({
    workspaceRoot,
    putBlob: memoryBlobStore().putBlob,
    debounceMs: 20,
    watchFactory: harness.watchFactory,
    onCandidate: candidate => candidates.push(candidate),
    onStatus: status => statuses.push(status),
  })
  try {
    await watcher.start()
    const draftPath = join(workspaceRoot, 'pages', 'drafts', 'page_01992a80-0000-7000-8000-000000000111.json')
    const draft = JSON.parse(await readFile(draftPath, 'utf8'))
    draft.contentBlocks.find(block => block.role === 'key_message').content = 'Pre 更新后的正文'
    await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
    harness.emit('change', 'page.json')
    await waitFor(() => candidates.length >= 2)
    assert.equal(candidates.length, 2)

    const pageManifestPath = join(workspaceRoot, 'pages', 'manifest.json')
    const pageManifest = JSON.parse(await readFile(pageManifestPath, 'utf8'))
    const removedPage = pageManifest.pages[1]
    const removedDraftPath = join(workspaceRoot, ...removedPage.draftPath.split('/'))
    const removedDraft = await readFile(removedDraftPath, 'utf8')
    pageManifest.pages = pageManifest.pages.slice(0, 1)
    await writeFile(pageManifestPath, `${JSON.stringify(pageManifest, null, 2)}\n`, 'utf8')
    await rm(removedDraftPath)
    harness.emit('rename', removedPage.draftPath)
    await waitFor(() => candidates.length >= 3)
    assert.equal(candidates.length, 3)
    assert.equal(candidates[2].snapshot.pages.length, 1)

    pageManifest.pages.push(removedPage)
    await writeFile(removedDraftPath, removedDraft, 'utf8')
    await writeFile(pageManifestPath, `${JSON.stringify(pageManifest, null, 2)}\n`, 'utf8')
    harness.emit('rename', removedPage.draftPath)
    await waitFor(() => candidates.length >= 4)
    assert.equal(candidates.length, 4)
    assert.equal(candidates[3].snapshot.pages.length, 2)

    const assetPath = join(workspaceRoot, 'assets', 'manifest.json')
    const assets = JSON.parse(await readFile(assetPath, 'utf8'))
    assets.assets[0].displayName = 'Pre 更新后的图表名称'
    await writeFile(assetPath, `${JSON.stringify(assets, null, 2)}\n`, 'utf8')
    harness.emit('change', 'manifest.json')
    await waitFor(() => candidates.length >= 5)
    assert.equal(candidates.length, 5)

    await watcher.close()
    harness.emit('change', 'manifest.json')
    await delay(60)
    assert.equal(candidates.length, 5)
    assert.equal(statuses.at(-1).status, 'watcher_disconnected')
  } finally {
    await watcher.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
