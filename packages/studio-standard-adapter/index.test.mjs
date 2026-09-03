import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { validateProjectDirectoryWithAjv } from '../../contracts/presentation-standard-project/src/index.mjs'
import { readStandardProject, writeStandardProject } from './index.mjs'

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
  assert.equal(imported.snapshot.pages[0].heading, '更新基础已经具备')
  assert.deepEqual(imported.snapshot.pages[0].bullets, ['优先改善高频公共活动空间', '保留可复用的现状资源', '分阶段验证投入与效果'])
  assert.match(imported.snapshot.pages[0].script, /本页先说明项目具备更新基础/)
  assert.ok(seen.length > 0)
  assert.equal(JSON.stringify(imported.snapshot).includes('dataBase64'), false)
  assert.equal(JSON.stringify(imported.snapshot).includes('dataUrl'), false)
  assert.ok(imported.snapshot.project.extensionPayload.standardArchive.files.every(file => file.objectRef?.sha256 && !('dataBase64' in file)))
})

test('standard round trip preserves unsupported blocks and managed source bytes', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-export-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    imported.snapshot.pages[0].body = '这是在 Report Studio 中修改后的正文。'
    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target, openBlob: blobOptions.openBlob })
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2))
    const draft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${imported.snapshot.pages[0].id}.json`), 'utf8'))
    assert.equal(draft.contentBlocks.find(block => block.type === 'text' && block.role === 'body').content, '这是在 Report Studio 中修改后的正文。')
    assert.ok(draft.contentBlocks.some(block => block.type === 'metric_group'), 'unsupported metric block must survive')
    const originalCsv = await readFile(new URL('source-materials/data/场地指标.csv', fixtureRoot))
    const exportedCsv = await readFile(join(exported.projectRoot, 'source-materials', 'data', '场地指标.csv'))
    assert.deepEqual(exportedCsv, originalCsv)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test('new Studio data-url assets are materialized and declared by both manifests', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-asset-export-'))
  try {
    const imported = await readStandardProject(fixtureRoot, blobOptions)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"></svg>')
    const assetId = 'asset_01993e40-0000-7000-8000-000000000001'
    imported.snapshot.pages[0].assets.push({
      id: assetId,
      name: '新增示意图.svg',
      type: 'image/svg+xml',
      dataUrl: `data:image/svg+xml;base64,${svg.toString('base64')}`,
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

test('a fresh Studio project exports as a Contract-valid standard directory', async () => {
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

    const exported = await writeStandardProject({ snapshot, exportRoot: target })
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2))
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
