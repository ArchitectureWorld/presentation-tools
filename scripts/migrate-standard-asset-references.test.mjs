import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateStandardAssetReferences } from './migrate-standard-asset-references.mjs'

test('asset reference migration is idempotent and keeps source-only files out of page assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-studio-asset-migration-'))
  await mkdir(join(root, 'assets'), { recursive: true })
  await mkdir(join(root, 'pages', 'drafts'), { recursive: true })
  await writeFile(join(root, 'project.json'), JSON.stringify({ projectId: 'project-test' }))
  await writeFile(join(root, 'assets', 'manifest.json'), JSON.stringify({ assets: [
    { assetId: 'visual', displayName: '地图.png', mimeType: 'image/png', relativePath: 'assets/images/map.png', origin: { sourceMaterialIds: [] } },
    { assetId: 'source', displayName: '报告.pdf', mimeType: 'application/pdf', relativePath: 'source-materials/report.pdf', origin: { sourceMaterialIds: ['source-material'] } },
  ] }))
  await writeFile(join(root, 'pages', 'manifest.json'), JSON.stringify({ pages: [{ pageId: 'page-test', draftPath: 'pages/drafts/page-test.json', sourceRefs: [] }] }))
  await writeFile(join(root, 'pages', 'drafts', 'page-test.json'), JSON.stringify({ pageId: 'page-test', pageAssets: [
    { pageAssetId: 'page-visual', assetId: 'visual', role: 'supporting', caption: '' },
    { pageAssetId: 'page-source', assetId: 'source', role: 'reference', caption: '' },
  ], scriptBlocks: [{ scriptBlockId: 'script-test', order: 0, content: '讲解', referencedAssetIds: ['source', 'visual'], sourceRefs: [] }] }))
  const first = await migrateStandardAssetReferences({ root })
  const second = await migrateStandardAssetReferences({ root })
  assert.equal(first.removedPageAssets, 1)
  assert.equal(first.removedPresentationAssets, 1)
  assert.equal(second.removedPageAssets, 0)
  assert.equal(second.removedPresentationAssets, 0)
  const draft = JSON.parse(await readFile(join(root, 'pages', 'drafts', 'page-test.json'), 'utf8'))
  assert.deepEqual(draft.pageAssets.map(asset => asset.assetId), ['visual'])
  assert.deepEqual(draft.scriptBlocks[0].referencedAssetIds, ['visual'])
})
