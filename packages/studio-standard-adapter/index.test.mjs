import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { validateProjectDirectoryWithAjv } from '../../contracts/presentation-standard-project/src/index.mjs'
import { readStandardProject, writeStandardProject } from './index.mjs'
import { createStableId } from '../../contracts/presentation-standard-project/src/index.mjs'
import { createInitialState, executeAction } from '../studio-core/index.mjs'
import { canonicalFromState } from '../studio-contracts/index.mjs'

const fixtureRoot = new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url)
const testBlobs = new Map()
const blobOptions = {
  async putBlob(stream, meta) { const bytes = Buffer.concat(await Array.fromAsync(stream)); const sha256 = createHash('sha256').update(bytes).digest('hex'); testBlobs.set(sha256, bytes); return { sha256, sizeBytes: bytes.length, mimeType: meta.mimeType, originalFileName: meta.originalFileName, createdAt: '2026-09-03T00:00:00.000Z' } },
  async openBlob(ref) { return Readable.from([testBlobs.get(ref.sha256)]) },
}

test('standard fixture imports into the Studio canonical model without changing stable ids', async () => {
  const seen = []
  const imported = await readStandardProject(fixtureRoot, { putBlob: async (stream, meta) => {
    const bytes = Buffer.concat(await Array.fromAsync(stream))
    seen.push({ ...meta, bytes })
    return { sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, mimeType: meta.mimeType, originalFileName: meta.originalFileName, createdAt: '2026-09-03T00:00:00.000Z' }
  } })
  assert.equal(imported.snapshot.project.id, 'project_01992a80-0000-7000-8000-000000000101')
  assert.equal(imported.snapshot.outline[0].id, 'outline_node_01992a80-0000-7000-8000-000000000110')
  assert.equal(imported.snapshot.pages[0].id, 'page_01992a80-0000-7000-8000-000000000111')
  for (const field of ['heading', 'body', 'bullets', 'script', 'assets']) assert.equal(Object.hasOwn(imported.snapshot.pages[0], field), false)
  assert.ok(seen.length > 0)
  assert.equal(JSON.stringify(imported.snapshot).includes('dataBase64'), false)
  assert.equal(JSON.stringify(imported.snapshot).includes('dataUrl'), false)
  assert.equal(imported.snapshot.project.extensionPayload.standardArchive.pageDocuments, undefined)
  assert.equal(imported.snapshot.pages[0].extensionPayload.standard.draft, undefined)
  assert.ok(imported.snapshot.project.extensionPayload.standardArchive.files.every(file => file.objectRef?.sha256 && !('dataBase64' in file)))
})

test('standard round trip preserves unsupported blocks and managed source bytes', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-export-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    imported.snapshot.pages[0].contentBlocks.find(block => block.type === 'text' && block.role === 'body').content = '这是在 Report Studio 中修改后的正文。'
    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob })
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2))
    const draft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${imported.snapshot.pages[0].id}.json`), 'utf8'))
    assert.equal(draft.contentBlocks.find(block => block.type === 'text' && block.role === 'body').content, '这是在 Report Studio 中修改后的正文。')
    assert.ok(draft.contentBlocks.some(block => block.type === 'metric_group'), 'unsupported metric block must survive')
    const tableDraft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${imported.snapshot.pages[1].id}.json`), 'utf8'))
    assert.ok(tableDraft.contentBlocks.some(block => block.type === 'table'), 'unsupported table block must survive')
    const originalCsv = await readFile(new URL('source-materials/data/场地指标.csv', fixtureRoot))
    const exportedCsv = await readFile(join(exported.projectRoot, 'source-materials', 'data', '场地指标.csv'))
    assert.deepEqual(exportedCsv, originalCsv)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('new Studio ObjectRef assets are materialized and declared by both manifests without inline bytes', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-asset-export-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"></svg>')
    const assetId = 'asset_01993e40-0000-7000-8000-000000000001'
    const sha256 = createHash('sha256').update(svg).digest('hex')
    testBlobs.set(sha256, svg)
    imported.snapshot.pages[0].pageAssets.push({
      pageAssetId: createStableId('pageAsset'), assetId, role: 'supporting', caption: '',
      order: imported.snapshot.pages[0].pageAssets.length, sourceRefs: [], name: '新增示意图.svg', mimeType: 'image/svg+xml',
      objectRef: { sha256, sizeBytes: svg.length, mimeType: 'image/svg+xml', originalFileName: '新增示意图.svg' },
    })

    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob })
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2))

    const manifest = JSON.parse(await readFile(join(exported.projectRoot, 'assets', 'manifest.json'), 'utf8'))
    const record = manifest.assets.find(asset => asset.assetId === assetId)
    assert.ok(record)
    assert.equal(record.mimeType, 'image/svg+xml')
    assert.equal(record.metadata.widthPx, 10)
    assert.equal(record.metadata.heightPx, 20)
    assert.deepEqual(await readFile(join(exported.projectRoot, ...record.relativePath.split('/'))), svg)

    const draft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${imported.snapshot.pages[0].id}.json`), 'utf8'))
    assert.ok(draft.pageAssets.some(link => link.assetId === assetId))
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('export omits archived draft files for pages removed in Studio', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-deleted-page-export-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const removedPageId = imported.snapshot.pages[1].id
    imported.snapshot.pages = imported.snapshot.pages.slice(0, 1)

    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob })
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2))
    await assert.rejects(
      readFile(join(exported.projectRoot, 'pages', 'drafts', `${removedPageId}.json`)),
      error => error.code === 'ENOENT',
    )
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('standard export rejects a snapshot that lacks persisted canonical identities', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-fresh-export-'))
  try {
    const snapshot = {
      project: {
        id: 'project_01993e40-0000-7000-8000-000000000010',
        title: '全新策划汇报',
        createdAt: '2026-09-03T08:00:00.000Z',
      },
      outline: [{
        id: 'outline_node_01993e40-0000-7000-8000-000000000011',
        title: '项目总览',
        children: [],
      }],
      pages: [{
        id: 'page_01993e40-0000-7000-8000-000000000012',
        outlineNodeId: 'outline_node_01993e40-0000-7000-8000-000000000011',
        heading: '项目总览',
        body: '这是全新 Studio 项目的首个草案页面。',
        bullets: ['边界明确'],
        script: '说明项目边界。',
        assets: [],
      }],
    }

    await assert.rejects(
      writeStandardProject({ snapshot, exportRoot: target }),
      error => error.code === 'invalid_reference',
    )
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('standard import retains formal draft identities for multiple scripts, duplicate page assets and list items', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'report-studio-canonical-import-'))
  const source = join(parent, 'source-project')
  try {
    await cp(new URL('.', fixtureRoot), source, { recursive: true })
    const manifestPath = join(source, 'pages', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const draftPath = join(source, ...manifest.pages[0].draftPath.split('/'))
    const draft = JSON.parse(await readFile(draftPath, 'utf8'))
    const list = draft.contentBlocks.find(block => block.type === 'list')
    list.items.push({ listItemId: createStableId('listItem'), content: '保留独立列表项身份', order: list.items.length, sourceRefs: [] })
    const sourceScript = draft.scriptBlocks[0]
    draft.scriptBlocks.push({ ...structuredClone(sourceScript), scriptBlockId: createStableId('scriptBlock'), order: 1, content: '第二段讲解稿' })
    const assetId = 'asset_01992a80-0000-7000-8000-000000000221'
    draft.pageAssets.push({ pageAssetId: createStableId('pageAsset'), assetId, role: 'supporting', caption: '同一素材的第一处使用', order: 0, sourceRefs: [] })
    draft.pageAssets.push({ pageAssetId: createStableId('pageAsset'), assetId, role: 'background', caption: '同一素材的第二处使用', order: 1, sourceRefs: [] })
    await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')

    const imported = await readStandardProject(source, blobOptions)
    const page = imported.snapshot.pages[0]
    assert.equal(page.draftDocumentId, draft.draftDocumentId)
    assert.deepEqual(page.scriptBlocks.map(block => block.scriptBlockId), draft.scriptBlocks.map(block => block.scriptBlockId))
    assert.equal(page.pageAssets.length, 2)
    assert.notEqual(page.pageAssets[0].pageAssetId, page.pageAssets[1].pageAssetId)
    assert.deepEqual(page.contentBlocks.find(block => block.type === 'list').items.map(item => item.listItemId), list.items.map(item => item.listItemId))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('fresh canonical project keeps document and content ids across repeated exports and later edits', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-canonical-fresh-'))
  try {
    let state = createInitialState()
    state = executeAction(state, { type: 'outline.add', title: '结构' }).state
    state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
    state = executeAction(state, { type: 'draft.update', pageId: state.pages[0].id, patch: { heading: '稳定标题', body: '稳定正文', bullets: ['稳定要点'], script: '稳定讲解稿' } }).state
    const snapshot = canonicalFromState(state)
    const first = await writeStandardProject({ snapshot, exportRoot: join(target, 'first') })
    const firstDraft = JSON.parse(await readFile(join(first.projectRoot, 'pages', 'drafts', `${snapshot.pages[0].id}.json`), 'utf8'))
    state = executeAction(state, { type: 'draft.update', pageId: state.pages[0].id, patch: { body: '已编辑正文' } }).state
    const editedSnapshot = canonicalFromState(state)
    const second = await writeStandardProject({ snapshot: editedSnapshot, exportRoot: join(target, 'second') })
    const secondDraft = JSON.parse(await readFile(join(second.projectRoot, 'pages', 'drafts', `${snapshot.pages[0].id}.json`), 'utf8'))
    assert.equal(secondDraft.draftDocumentId, firstDraft.draftDocumentId)
    assert.deepEqual(secondDraft.contentBlocks.map(block => block.contentBlockId), firstDraft.contentBlocks.map(block => block.contentBlockId))
    assert.deepEqual(secondDraft.scriptBlocks.map(block => block.scriptBlockId), firstDraft.scriptBlocks.map(block => block.scriptBlockId))
    assert.equal(secondDraft.contentBlocks.find(block => block.type === 'text' && block.role === 'body').content, '已编辑正文')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('an unedited fresh canonical project exports every persisted formal id deterministically', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-canonical-unchanged-'))
  try {
    let state = createInitialState()
    state = executeAction(state, { type: 'outline.add', title: '稳定结构' }).state
    state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
    state = executeAction(state, { type: 'draft.update', pageId: state.pages[0].id, patch: { heading: '标题', body: '正文', bullets: ['要点'], script: '讲解稿' } }).state
    const snapshot = canonicalFromState(state)
    const first = await writeStandardProject({ snapshot, exportRoot: join(target, 'first') })
    const second = await writeStandardProject({ snapshot, exportRoot: join(target, 'second') })
    const read = async result => Object.fromEntries(await Promise.all([
      'project.json', 'rules.json', 'outline.json', 'pages/manifest.json', `pages/drafts/${snapshot.pages[0].id}.json`,
    ].map(async path => [path, await readFile(join(result.projectRoot, ...path.split('/')), 'utf8')])))
    const [firstFiles, secondFiles] = await Promise.all([read(first), read(second)])
    assert.deepEqual(secondFiles, firstFiles)
    const project = JSON.parse(firstFiles['project.json'])
    const rules = JSON.parse(firstFiles['rules.json'])
    const outline = JSON.parse(firstFiles['outline.json'])
    const manifest = JSON.parse(firstFiles['pages/manifest.json'])
    const draft = JSON.parse(firstFiles[`pages/drafts/${snapshot.pages[0].id}.json`])
    assert.equal(project.projectId, snapshot.project.projectId)
    assert.equal(rules.projectRulesId, snapshot.project.projectRulesId)
    assert.equal(outline.outlineDocumentId, snapshot.project.outlineDocumentId)
    assert.equal(outline.nodes[0].outlineNodeId, snapshot.outline[0].outlineNodeId)
    assert.equal(manifest.pages[0].pageId, snapshot.pages[0].pageId)
    assert.equal(draft.draftDocumentId, snapshot.pages[0].draftDocumentId)
    assert.equal(draft.contentBlocks[0].contentBlockId, snapshot.pages[0].titleBlockId)
    assert.equal(draft.contentBlocks.find(block => block.type === 'list').items[0].listItemId, snapshot.pages[0].contentBlocks.find(block => block.type === 'list').items[0].listItemId)
    assert.equal(draft.scriptBlocks[0].scriptBlockId, snapshot.pages[0].scriptBlocks[0].scriptBlockId)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('imported multi-script and duplicate-page-asset identities survive repeated exports', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'report-studio-canonical-round-trip-'))
  try {
    const source = join(parent, 'source-project')
    await cp(new URL('.', fixtureRoot), source, { recursive: true })
    const manifest = JSON.parse(await readFile(join(source, 'pages', 'manifest.json'), 'utf8'))
    const draftPath = join(source, ...manifest.pages[0].draftPath.split('/'))
    const draft = JSON.parse(await readFile(draftPath, 'utf8'))
    const script = draft.scriptBlocks[0]
    draft.scriptBlocks.push({ ...structuredClone(script), scriptBlockId: createStableId('scriptBlock'), order: 1, content: '独立第二段讲解稿' })
    const assetId = 'asset_01992a80-0000-7000-8000-000000000221'
    draft.pageAssets.push({ pageAssetId: createStableId('pageAsset'), assetId, role: 'supporting', caption: '位置一', order: 0, sourceRefs: [] })
    draft.pageAssets.push({ pageAssetId: createStableId('pageAsset'), assetId, role: 'background', caption: '位置二', order: 1, sourceRefs: [] })
    await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
    const imported = await readStandardProject(source, blobOptions)
    const first = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: join(parent, 'first'), openBlob: blobOptions.openBlob })
    const second = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: join(parent, 'second'), openBlob: blobOptions.openBlob })
    const readDraft = async result => JSON.parse(await readFile(join(result.projectRoot, 'pages', 'drafts', `${imported.snapshot.pages[0].id}.json`), 'utf8'))
    const [firstDraft, secondDraft] = await Promise.all([readDraft(first), readDraft(second)])
    assert.deepEqual(firstDraft.scriptBlocks.map(item => item.scriptBlockId), draft.scriptBlocks.map(item => item.scriptBlockId))
    assert.deepEqual(secondDraft.scriptBlocks.map(item => item.scriptBlockId), draft.scriptBlocks.map(item => item.scriptBlockId))
    assert.deepEqual(secondDraft.scriptBlocks.map(item => item.content), draft.scriptBlocks.map(item => item.content))
    assert.deepEqual(secondDraft.pageAssets.map(item => item.pageAssetId), draft.pageAssets.map(item => item.pageAssetId))
    assert.deepEqual(secondDraft.pageAssets.map(item => item.caption), ['位置一', '位置二'])
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('standard export recomputes source-material manifest hashes and byte counts from streamed Blobs', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-streamed-source-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const sourceManifest = imported.snapshot.project.extensionPayload.standardArchive.documents['source-materials/manifest.json']
    sourceManifest.materials[0].sizeBytes = 1
    sourceManifest.materials[0].sha256 = '0'.repeat(64)

    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob })
    const actual = await readFile(join(exported.projectRoot, 'source-materials', 'data', '场地指标.csv'))
    const material = JSON.parse(await readFile(join(exported.projectRoot, 'source-materials', 'manifest.json'), 'utf8')).materials[0]
    assert.equal(material.sizeBytes, actual.length)
    assert.equal(material.sha256, createHash('sha256').update(actual).digest('hex'))
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('standard export rejects a Blob whose streamed bytes no longer equal its ObjectRef', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-corrupt-stream-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const archiveFile = imported.snapshot.project.extensionPayload.standardArchive.files.find(file => file.relativePath === 'source-materials/data/场地指标.csv')
    testBlobs.set(archiveFile.objectRef.sha256, Buffer.from('corrupted streamed source bytes'))

    await assert.rejects(
      writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob }),
      error => error.code === 'standard_export_failed' && error.details?.relativePath === archiveFile.relativePath,
    )
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('standard export rejects bytes whose actual MIME is incompatible with the managed path', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-mime-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const png = Buffer.alloc(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    png.writeUInt32BE(1, 16)
    png.writeUInt32BE(1, 20)
    const sha256 = createHash('sha256').update(png).digest('hex')
    const file = imported.snapshot.project.extensionPayload.standardArchive.files.find(item => item.relativePath === 'source-materials/data/场地指标.csv')
    file.objectRef = { ...file.objectRef, sha256, sizeBytes: png.length, mimeType: 'image/jpeg' }
    testBlobs.set(sha256, png)

    await assert.rejects(
      writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob }),
      error => error.code === 'standard_contract_invalid' && error.details?.errors?.some(issue => issue.code === 'PRES_FILE_EXTENSION_MISMATCH'),
    )
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('standard export classifies streamed CSV bytes without trusting an ObjectRef MIME', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-csv-mime-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const file = imported.snapshot.project.extensionPayload.standardArchive.files.find(item => item.relativePath === 'source-materials/data/场地指标.csv')
    file.objectRef = { ...file.objectRef, mimeType: 'application/json' }
    imported.snapshot.project.extensionPayload.standardArchive.documents['source-materials/manifest.json'].materials[0].mimeType = 'application/json'

    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob })
    const material = JSON.parse(await readFile(join(exported.projectRoot, 'source-materials', 'manifest.json'), 'utf8')).materials[0]
    assert.equal(material.mimeType, 'text/csv')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('standard export classifies unknown streamed bytes as application/octet-stream', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-unknown-mime-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const bytes = Buffer.from([0x00, 0xff, 0x4a, 0x10])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const relativePath = 'source-materials/other/unknown.bin'
    const file = imported.snapshot.project.extensionPayload.standardArchive.files.find(item => item.relativePath === 'source-materials/data/场地指标.csv')
    file.relativePath = relativePath
    file.objectRef = { ...file.objectRef, sha256, sizeBytes: bytes.length, mimeType: 'text/plain', originalFileName: 'unknown.bin' }
    const material = imported.snapshot.project.extensionPayload.standardArchive.documents['source-materials/manifest.json'].materials[0]
    Object.assign(material, { category: 'other', originalFileName: 'unknown.bin', relativePath, mimeType: 'text/plain', sha256, sizeBytes: bytes.length })
    testBlobs.set(sha256, bytes)

    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob })
    const written = JSON.parse(await readFile(join(exported.projectRoot, 'source-materials', 'manifest.json'), 'utf8')).materials[0]
    assert.equal(written.mimeType, 'application/octet-stream')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('standard export treats binary bytes after a 256 KiB text prefix as application/octet-stream', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-late-binary-mime-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const bytes = Buffer.concat([Buffer.from('a'.repeat(256 * 1024), 'utf8'), Buffer.from([0x00])])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const relativePath = 'source-materials/other/late-binary.bin'
    const file = imported.snapshot.project.extensionPayload.standardArchive.files.find(item => item.relativePath === 'source-materials/data/场地指标.csv')
    file.relativePath = relativePath
    file.objectRef = { ...file.objectRef, sha256, sizeBytes: bytes.length, mimeType: 'text/plain', originalFileName: 'late-binary.bin' }
    const material = imported.snapshot.project.extensionPayload.standardArchive.documents['source-materials/manifest.json'].materials[0]
    Object.assign(material, { category: 'other', originalFileName: 'late-binary.bin', relativePath, mimeType: 'text/plain', sha256, sizeBytes: bytes.length })
    testBlobs.set(sha256, bytes)

    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob })
    const written = JSON.parse(await readFile(join(exported.projectRoot, 'source-materials', 'manifest.json'), 'utf8')).materials[0]
    assert.equal(written.mimeType, 'application/octet-stream')
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
