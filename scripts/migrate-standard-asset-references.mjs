import { readFile, writeFile, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRenderablePageAsset, normalizeDraftAssetReferences } from '../packages/studio-standard-adapter/index.mjs'

const clone = value => structuredClone(value)
const refKey = ref => JSON.stringify([ref.provider, ref.sourceProjectId, ref.sourceRevision, [...(ref.objectIds ?? [])].sort(), [...(ref.evidenceIds ?? [])].sort()])

function sourceRefForAsset(asset, projectId, sourceRevision = 0) {
  return {
    provider: 'standard-project-adapter',
    sourceProjectId: String(projectId),
    sourceRevision,
    objectIds: [String(asset.assetId)],
    evidenceIds: [...new Set((asset.origin?.sourceMaterialIds ?? []).map(String))],
  }
}

async function managedPath(root, value) {
  const invalid = () => { throw Object.assign(new Error('Migration path must be a contained regular file.'), { code: 'migration_invalid_path' }) }
  if (typeof value !== 'string' || !value || /[:\x00-\x1f]/.test(value)) invalid()
  const parts = value.replaceAll('\\', '/').split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) invalid()
  let path = root
  for (const [index, part] of parts.entries()) {
    path = join(path, part)
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory())) invalid()
  }
  return path
}

export async function migrateStandardAssetReferences({ root }) {
  const projectRoot = resolve(root)
  const rootInfo = await lstat(projectRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Object.assign(new Error('Migration root must be a real directory.'), {code:'migration_invalid_path'})
  const project = JSON.parse(await readFile(await managedPath(projectRoot, 'project.json'), 'utf8'))
  const assetsDocument = JSON.parse(await readFile(await managedPath(projectRoot, 'assets/manifest.json'), 'utf8'))
  const pagesDocument = JSON.parse(await readFile(await managedPath(projectRoot, 'pages/manifest.json'), 'utf8'))
  const assets = assetsDocument.assets ?? []
  const assetMap = new Map(assets.map(asset => [asset.assetId, asset]))
  const nextAssets = assets.filter(asset => isRenderablePageAsset({ mimeType: asset.mimeType, name: asset.displayName ?? asset.relativePath }))
  const report = { migratedPages: 0, visualReferencesKept: 0, sourceReferencesMoved: 0, unresolvedReferences: [], removedPageAssets: 0, removedPresentationAssets: assets.length - nextAssets.length }

  const writes = []
  const visited = new Set()
  for (const page of pagesDocument.pages ?? []) {
    if (!page.draftPath) continue
    const draftPath = await managedPath(projectRoot, page.draftPath)
    if (visited.has(draftPath)) throw Object.assign(new Error('Duplicate draft path.'), {code:'migration_invalid_path'})
    visited.add(draftPath)
    const draft = JSON.parse(await readFile(draftPath, 'utf8'))
    const normalized = normalizeDraftAssetReferences({ draft, assets, projectId: project.projectId, sourceRevision: 0 })
    report.visualReferencesKept += normalized.report.visualReferencesKept
    report.sourceReferencesMoved += normalized.report.sourceReferencesMoved
    report.unresolvedReferences.push(...normalized.report.unresolvedReferences)
    const pageSourceRefs = new Map((page.sourceRefs ?? []).map(ref => [refKey(ref), ref]))
    const pageAssets = []
    for (const link of normalized.draft.pageAssets ?? []) {
      const asset = assetMap.get(link.assetId)
      if (asset && isRenderablePageAsset({ mimeType: asset.mimeType, name: asset.displayName ?? asset.relativePath })) {
        pageAssets.push(link)
        continue
      }
      if (asset) {
        pageSourceRefs.set(refKey(sourceRefForAsset(asset, project.projectId)), sourceRefForAsset(asset, project.projectId))
        report.sourceReferencesMoved += 1
      } else {
        report.unresolvedReferences.push({ pageId: page.pageId, assetId: link.assetId, reason: 'asset_not_registered' })
      }
      report.removedPageAssets += 1
    }
    const nextDraft = { ...normalized.draft, pageAssets }
    writes.push([draftPath, JSON.stringify(nextDraft)])
    page.sourceRefs = [...pageSourceRefs.values()]
    report.migratedPages += 1
  }
  // Preflight all documents before publishing any changes. This does not claim a multi-file transaction.
  for (const [path, content] of writes) await writeFile(path, content, 'utf8')
  assetsDocument.assets = nextAssets
  await writeFile(join(projectRoot, 'assets', 'manifest.json'), JSON.stringify(assetsDocument), 'utf8')
  await writeFile(join(projectRoot, 'pages', 'manifest.json'), JSON.stringify(pagesDocument), 'utf8')
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2]
  if (!root) throw new Error('Usage: node scripts/migrate-standard-asset-references.mjs <standard-project-root>')
  console.log(JSON.stringify(await migrateStandardAssetReferences({ root }), null, 2))
}
