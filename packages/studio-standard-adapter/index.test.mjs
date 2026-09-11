import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { validateProjectDirectoryWithAjv } from '../../contracts/presentation-standard-project/src/index.mjs'
import { collapseSingletonOutlineWrappers, isRenderablePageAsset, normalizeDraftAssetReferences, readStandardProject, sanitizeExternalText, writeStandardProject } from './index.mjs'
import { createStableId } from '../../contracts/presentation-standard-project/src/index.mjs'
import { createInitialState, executeAction } from '../studio-core/index.mjs'
import { canonicalFromState } from '../studio-contracts/index.mjs'
import { linkRegisteredAsset } from '../../apps/studio-local/design-content.mjs'

const fixtureRoot = new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url)
const testBlobs = new Map()
const blobOptions = {
  async putBlob(stream, meta) { const bytes = Buffer.concat(await Array.fromAsync(stream)); const sha256 = createHash('sha256').update(bytes).digest('hex'); testBlobs.set(sha256, bytes); return { sha256, sizeBytes: bytes.length, mimeType: meta.mimeType, originalFileName: meta.originalFileName, createdAt: '2026-09-03T00:00:00.000Z' } },
  async openBlob(ref) { return Readable.from([testBlobs.get(ref.sha256)]) },
}

test('external presentation text removes archive names and internal paths', () => {
  const cleaned = sanitizeExternalText('资料目录：少潭河水库2000地形图2号.rar；source-materials/other/地形资料.zip')
  assert.equal(/\.rar|\.zip|\.7z|source-materials|资料目录|待解压/iu.test(cleaned), false)
  assert.match(cleaned, /原始地形资料|相关来源资料/u)
})

test('only renderable visual media can be page assets', () => {
  assert.equal(isRenderablePageAsset({ mimeType: 'image/jpeg', name: '现场.jpg' }), true)
  assert.equal(isRenderablePageAsset({ mimeType: 'video/mp4', name: '踏勘.mp4' }), true)
  assert.equal(isRenderablePageAsset({ mimeType: 'application/pdf', name: '报告.pdf' }), false)
  assert.equal(isRenderablePageAsset({ mimeType: 'application/acad', name: '红线.dwg' }), false)
  assert.equal(isRenderablePageAsset({ mimeType: 'application/vnd.rar', name: '地形.rar' }), false)
})

test('source-only script asset references move to SourceRefs while bound visuals remain layout references', () => {
  const source = { assetId: 'asset-source', mimeType: 'application/pdf', displayName: '方案.pdf', origin: { sourceMaterialIds: ['source-material-pdf'] } }
  const visual = { assetId: 'asset-visual', mimeType: 'image/png', displayName: '图解.png', origin: { sourceMaterialIds: ['source-material-pdf'] } }
  const result = normalizeDraftAssetReferences({
    projectId: 'project-test',
    assets: [source, visual],
    draft: {
      pageAssets: [{ pageAssetId: 'page-asset-visual', assetId: 'asset-visual', role: 'supporting', order: 0 }],
      scriptBlocks: [{ scriptBlockId: 'script-1', order: 0, content: '讲解', referencedAssetIds: ['asset-source', 'asset-visual'], sourceRefs: [] }],
    },
  })
  assert.deepEqual(result.draft.scriptBlocks[0].referencedAssetIds, ['asset-visual'])
  assert.equal(result.draft.scriptBlocks[0].sourceRefs.length, 1)
  assert.deepEqual(result.draft.scriptBlocks[0].sourceRefs[0].objectIds, ['asset-source'])
  assert.equal(result.report.visualReferencesKept, 1)
  assert.equal(result.report.sourceReferencesMoved, 1)
})

test('source references stay on their own script block and missing assets fail closed', () => {
  const result = normalizeDraftAssetReferences({
    projectId: 'project-test',
    assets: [{ assetId: 'asset-source', mimeType: 'application/pdf', displayName: '方案.pdf', origin: { sourceMaterialIds: ['source-material-pdf'] } }],
    draft: {
      pageId: 'page-test', pageAssets: [],
      scriptBlocks: [
        { scriptBlockId: 'script-1', order: 0, content: '一', referencedAssetIds: ['asset-source'], sourceRefs: [] },
        { scriptBlockId: 'script-2', order: 1, content: '二', referencedAssetIds: ['missing'], sourceRefs: [] },
      ],
    },
  })
  assert.equal(result.draft.scriptBlocks[0].sourceRefs.length, 1)
  assert.equal(result.draft.scriptBlocks[1].sourceRefs.length, 0)
  assert.deepEqual(result.report.unresolvedReferences, [{ pageId: 'page-test', assetId: 'missing', reason: 'asset_not_registered' }])
  assert.equal(result.report.migratedPages, 1)
})

test('collapses a redundant singleton section so a single page belongs directly to its chapter', () => {
  const root = {
    id: 'chapter', outlineNodeId: 'chapter', parentOutlineNodeId: null, title: '项目认知与任务', order: 0,
    children: [{
      id: 'wrapper', outlineNodeId: 'wrapper', parentOutlineNodeId: 'chapter', title: '项目认知与任务综述', order: 0,
      children: [{ id: 'page', outlineNodeId: 'page', parentOutlineNodeId: 'wrapper', title: '项目认知与任务：综合研判', order: 0, children: [] }],
    }, {
      id: 'second', outlineNodeId: 'second', parentOutlineNodeId: 'chapter', title: '项目背景与决策任务', order: 1, children: [],
    }],
  }

  const collapsed = collapseSingletonOutlineWrappers([root], new Set(['page']))
  assert.equal(collapsed[0].title, '项目认知与任务')
  assert.equal(collapsed[0].children.length, 2)
  assert.equal(collapsed[0].children[0].id, 'page')
  assert.equal(collapsed[0].children[0].parentOutlineNodeId, 'chapter')
})

test('promotes a top-level chapter when it contains only one generated page', () => {
  const root = {
    id: 'chapter', outlineNodeId: 'chapter', parentOutlineNodeId: null, title: '决策事项与下一步', order: 0,
    children: [{
      id: 'page', outlineNodeId: 'page', parentOutlineNodeId: 'chapter', title: '决策事项与下一步：综合研判', order: 0, children: [],
    }],
  }

  const collapsed = collapseSingletonOutlineWrappers([root], new Set(['page']))
  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].id, 'page')
  assert.equal(collapsed[0].parentOutlineNodeId, null)
})

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

test('registered PDF, video and data page links retain bytes, manifest metadata and script/evidence references on export', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-reference-export-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const records = [
      {
        assetId: createStableId('asset'), displayName: '已登记任务书.pdf', mediaType: 'document', category: 'other', semanticRole: '任务书原件',
        relativePath: 'assets/other/brief.pdf', mimeType: 'application/pdf', metadata: { pageCount: 2 },
        bytes: Buffer.from('%PDF-1.7\nsynthetic registered document\n%%EOF\n'),
      },
      {
        assetId: createStableId('asset'), displayName: '已登记踏勘视频.mp4', mediaType: 'video', category: 'video', semanticRole: '踏勘视频原件',
        relativePath: 'assets/videos/walkthrough.mp4', mimeType: 'video/mp4', metadata: { durationMs: 4200 },
        bytes: Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]),
      },
      {
        assetId: createStableId('asset'), displayName: '已登记指标.csv', mediaType: 'data', category: 'other', semanticRole: '指标数据原件',
        relativePath: 'assets/other/metrics.csv', mimeType: 'text/csv', metadata: { rowCount: 2, columnCount: 2 },
        bytes: Buffer.from('name,value\narea,12800\n', 'utf8'),
      },
    ]
    const manifest = imported.snapshot.project.extensionPayload.standardArchive.documents['assets/manifest.json']
    const files = imported.snapshot.project.extensionPayload.standardArchive.files
    const sourceRefs = structuredClone(manifest.assets[0].sourceRefs)
    for (const row of records) {
      const sha256 = createHash('sha256').update(row.bytes).digest('hex')
      const objectRef = { sha256, sizeBytes: row.bytes.length, mimeType: row.mimeType, originalFileName: row.displayName }
      testBlobs.set(sha256, row.bytes)
      manifest.assets.push({
        assetId: row.assetId, displayName: row.displayName, mediaType: row.mediaType, category: row.category, semanticRole: row.semanticRole,
        relativePath: row.relativePath, mimeType: row.mimeType, sizeBytes: row.bytes.length, sha256, metadata: structuredClone(row.metadata),
        adoptionStatus: 'adopted', origin: { type: 'human_added', sourceMaterialIds: [], parentAssetIds: [], method: 'synthetic registered fixture', sourceTool: { name: 'test', version: '1.0.0' } },
        sourceRefs, createdAt: '2026-09-06T00:00:00Z', adoptedAt: '2026-09-06T00:00:00Z', retiredAt: null,
      })
      files.push({ relativePath: row.relativePath, objectRef })
    }
    imported.snapshot.pages[0].scriptBlocks[0].referencedAssetIds = records.map(row => row.assetId)
    let snapshot = imported.snapshot
    for (const row of records) snapshot = linkRegisteredAsset(snapshot, { pageId: snapshot.pages[0].id, assetId: row.assetId })
    const links = snapshot.pages[0].pageAssets.filter(link => records.some(row => row.assetId === link.assetId))
    assert.equal(links.every(link => link.role === 'reference' && link.extensionPayload.designContent.decodedImageBackgroundEligible === false), true)

    const exported = await writeStandardProject({ snapshot, exportRoot: target, openBlob: blobOptions.openBlob }).catch(error => { throw new Error(JSON.stringify(error.details)) })
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2))
    const writtenManifest = JSON.parse(await readFile(join(exported.projectRoot, 'assets', 'manifest.json'), 'utf8'))
    const writtenDraft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${snapshot.pages[0].id}.json`), 'utf8'))
    assert.deepEqual(writtenDraft.scriptBlocks[0].referencedAssetIds, records.map(row => row.assetId))
    for (const row of records) {
      const written = writtenManifest.assets.find(asset => asset.assetId === row.assetId)
      assert.equal(written.relativePath, row.relativePath)
      assert.equal(written.mimeType, row.mimeType)
      assert.equal(written.mediaType, row.mediaType)
      assert.deepEqual(written.metadata, row.metadata)
      assert.equal(written.sha256, createHash('sha256').update(row.bytes).digest('hex'))
      assert.equal(written.sizeBytes, row.bytes.length)
      assert.deepEqual(written.sourceRefs, sourceRefs)
      assert.deepEqual(await readFile(join(exported.projectRoot, ...row.relativePath.split('/'))), row.bytes)
    }
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('registered non-image page link rejects streamed bytes whose actual MIME conflicts with its manifest', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-reference-mime-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const bytes = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const assetId = createStableId('asset')
    const relativePath = 'assets/other/not-a-pdf.pdf'
    const record = {
      assetId, displayName: '声明为PDF的错误素材', mediaType: 'document', category: 'other', semanticRole: '错误测试', relativePath,
      mimeType: 'application/pdf', sizeBytes: bytes.length, sha256, metadata: { pageCount: 1 }, adoptionStatus: 'adopted',
      origin: { type: 'human_added', sourceMaterialIds: [], parentAssetIds: [], method: 'synthetic mismatch fixture', sourceTool: { name: 'test', version: '1.0.0' } },
      sourceRefs: [], createdAt: '2026-09-06T00:00:00Z', adoptedAt: '2026-09-06T00:00:00Z', retiredAt: null,
    }
    imported.snapshot.project.extensionPayload.standardArchive.documents['assets/manifest.json'].assets.push(record)
    imported.snapshot.project.extensionPayload.standardArchive.files.push({ relativePath, objectRef: { sha256, sizeBytes: bytes.length, mimeType: 'application/pdf', originalFileName: record.displayName } })
    testBlobs.set(sha256, bytes)
    const snapshot = linkRegisteredAsset(imported.snapshot, { pageId: imported.snapshot.pages[0].id, assetId })
    await assert.rejects(
      writeStandardProject({ snapshot, exportRoot: target, openBlob: blobOptions.openBlob }),
      error => error.code === 'standard_export_failed' && error.details?.assetId === assetId && error.details?.declaredMimeType === 'application/pdf' && error.details?.actualMimeType === 'video/mp4',
    )
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
