
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  ASSET_CATEGORY_DIRECTORIES, REQUIRED_DIRECTORIES, REQUIRED_FILES, SCHEMA_IDS,
  SOURCE_CATEGORY_DIRECTORIES, STANDARD_VERSION,
} from './constants.mjs'
import { ERROR_CODES } from './errors.mjs'
import { isStableId } from './ids.mjs'
import { mimeMatchesExtension, sniffKnownMime } from './mime.mjs'
import { assertFileNameIsNfc, assertPathIsNfc, portabilityKey, resolveWithinProject } from './paths.mjs'

const REQUIRED_DOCUMENTS = Object.freeze({
  'project.json': 'ProjectManifest', 'rules.json': 'ProjectRulesDocument', 'outline.json': 'OutlineDocument',
  'pages/manifest.json': 'PageManifest', 'source-materials/manifest.json': 'SourceMaterialManifest',
  'assets/manifest.json': 'AssetManifest',
})

function issue(code, filePath, instancePath, message, details = undefined, severity = 'error') {
  return { code, severity, filePath, instancePath, message, ...(details === undefined ? {} : { details }) }
}

async function entry(projectRoot, relativePath, expectedType, errors) {
  const absolute = path.join(projectRoot, ...relativePath.split('/'))
  try {
    const info = await lstat(absolute)
    if (info.isSymbolicLink()) {
      errors.push(issue(ERROR_CODES.PATH_SYMLINK_FORBIDDEN, relativePath, '', 'Symbolic links are forbidden'))
      return false
    }
    if ((expectedType === 'file' && !info.isFile()) || (expectedType === 'directory' && !info.isDirectory())) {
      errors.push(issue(ERROR_CODES.DIRECTORY_UNEXPECTED_TYPE, relativePath, '', `Expected ${expectedType}`))
      return false
    }
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      errors.push(issue(ERROR_CODES.DIRECTORY_MISSING_REQUIRED_PATH, relativePath, '', `Required ${expectedType} is missing`))
      return false
    }
    throw error
  }
}

async function readJson(projectRoot, relativePath, errors) {
  try { return JSON.parse(await readFile(path.join(projectRoot, ...relativePath.split('/')), 'utf8')) }
  catch (error) {
    errors.push(issue(ERROR_CODES.SCHEMA_INVALID, relativePath, '', `Cannot parse JSON: ${error.message}`))
    return null
  }
}

function registerId(registry, kind, value, filePath, instancePath, errors) {
  if (!isStableId(kind, value)) {
    errors.push(issue(ERROR_CODES.SCHEMA_INVALID, filePath, instancePath, `Invalid ${kind} stable ID`)); return false
  }
  if (registry.has(value)) {
    errors.push(issue(ERROR_CODES.DUPLICATE_ID, filePath, instancePath, `Stable ID duplicates ${registry.get(value)}`)); return false
  }
  registry.set(value, `${filePath}${instancePath}`); return true
}

function checkSourceRefs(refs, filePath, instancePath, errors) {
  if (!Array.isArray(refs)) return
  const seen = new Set()
  for (const [index, ref] of refs.entries()) {
    const key = JSON.stringify([ref.provider, ref.sourceProjectId, ref.sourceRevision, ref.objectIds, ref.evidenceIds, ref.sourceSnapshotSha256 ?? null])
    if (seen.has(key)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, filePath, `${instancePath}/${index}`, 'Equivalent sourceRefs must not be repeated'))
    seen.add(key)
  }
}

async function scanTree(projectRoot, allowGitKeep, errors) {
  const portability = new Map()
  async function walk(absolute, relative = '') {
    for (const dirent of await readdir(absolute, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${dirent.name}` : dirent.name
      const full = path.join(absolute, dirent.name)
      const info = await lstat(full)
      if (info.isSymbolicLink()) {
        errors.push(issue(ERROR_CODES.PATH_SYMLINK_FORBIDDEN, rel, '', 'Symbolic links are forbidden anywhere inside a standard project'))
        continue
      }
      if (!(allowGitKeep && dirent.name === '.gitkeep' && info.isFile() && info.size === 0)) {
        let key
        try { key = portabilityKey(rel) }
        catch (error) { errors.push(issue(error.code ?? ERROR_CODES.PATH_INVALID, rel, '', error.message)); key = null }
        if (key) {
          const previous = portability.get(key)
          if (previous && previous !== rel) errors.push(issue(ERROR_CODES.PATH_PORTABILITY_COLLISION, rel, '', `Path collides with ${previous} after Unicode NFC and case folding`))
          else portability.set(key, rel)
        }
      }
      if (info.isDirectory()) await walk(full, rel)
    }
  }
  await walk(projectRoot)
}

async function collectFiles(projectRoot, relativeDirectory, allowGitKeep, errors) {
  const found = []
  const base = path.join(projectRoot, ...relativeDirectory.split('/'))
  async function walk(absolute, relative) {
    for (const dirent of await readdir(absolute, { withFileTypes: true })) {
      const rel = `${relative}/${dirent.name}`
      const full = path.join(absolute, dirent.name)
      const info = await lstat(full)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) await walk(full, rel)
      else if (info.isFile()) {
        if (allowGitKeep && dirent.name === '.gitkeep' && info.size === 0) continue
        found.push(rel)
      } else errors.push(issue(ERROR_CODES.DIRECTORY_UNEXPECTED_TYPE, rel, '', 'Only regular files and directories are allowed'))
    }
  }
  await walk(base, relativeDirectory)
  return found
}

async function validateManagedFile(projectRoot, record, expectedDirectory, filePath, instancePath, errors) {
  let relativePath
  try { relativePath = assertPathIsNfc(record.relativePath) }
  catch (error) { errors.push(issue(error.code ?? ERROR_CODES.PATH_INVALID, filePath, `${instancePath}/relativePath`, error.message)); return false }
  if (!relativePath.startsWith(`${expectedDirectory}/`)) errors.push(issue(ERROR_CODES.REFERENCE_WRONG_SCOPE, filePath, `${instancePath}/relativePath`, `Path must be inside ${expectedDirectory}/`))
  const absolute = resolveWithinProject(projectRoot, relativePath)
  try {
    const info = await lstat(absolute)
    if (info.isSymbolicLink()) { errors.push(issue(ERROR_CODES.PATH_SYMLINK_FORBIDDEN, relativePath, '', 'Manifest target is a symbolic link')); return false }
    if (!info.isFile()) { errors.push(issue(ERROR_CODES.DIRECTORY_UNEXPECTED_TYPE, relativePath, '', 'Manifest target must be a regular file')); return false }
    const rootReal = await realpath(projectRoot)
    const fileReal = await realpath(absolute)
    if (!fileReal.startsWith(`${rootReal}${path.sep}`)) { errors.push(issue(ERROR_CODES.PATH_ESCAPE, relativePath, '', 'Resolved file escapes the project root')); return false }
    const bytes = await readFile(absolute)
    if (info.size !== record.sizeBytes) errors.push(issue(ERROR_CODES.FILE_SIZE_MISMATCH, filePath, `${instancePath}/sizeBytes`, `Manifest sizeBytes ${record.sizeBytes} does not match ${info.size}`))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== record.sha256) errors.push(issue(ERROR_CODES.FILE_HASH_MISMATCH, filePath, `${instancePath}/sha256`, `Manifest SHA-256 ${record.sha256} does not match ${sha256}`))
    if (!mimeMatchesExtension(relativePath, record.mimeType)) errors.push(issue(ERROR_CODES.FILE_EXTENSION_MISMATCH, filePath, `${instancePath}/mimeType`, `Extension does not match ${record.mimeType}`))
    const sniffed = sniffKnownMime(bytes)
    if (sniffed && sniffed !== record.mimeType) errors.push(issue(ERROR_CODES.FILE_MIME_MISMATCH, filePath, `${instancePath}/mimeType`, `Detected ${sniffed}, declared ${record.mimeType}`))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') { errors.push(issue(ERROR_CODES.MANIFEST_FILE_MISSING, relativePath, '', 'Manifest references a missing file')); return false }
    throw error
  }
}

function findOutlineCycles(nodes, errors) {
  const byId = new Map(nodes.map(node => [node.outlineNodeId, node]))
  for (const node of nodes) {
    const seen = new Set([node.outlineNodeId]); let current = node
    while (current?.parentOutlineNodeId) {
      if (seen.has(current.parentOutlineNodeId)) { errors.push(issue(ERROR_CODES.REFERENCE_WRONG_SCOPE, 'outline.json', '/nodes', `Outline parent cycle includes ${current.parentOutlineNodeId}`)); break }
      seen.add(current.parentOutlineNodeId); current = byId.get(current.parentOutlineNodeId)
    }
  }
}

export async function validateProjectDirectory(projectRoot, options = {}) {
  const { allowGitKeep = false, documentValidator = null } = options
  const root = path.resolve(projectRoot); const errors = []; const warnings = []
  try {
    const info = await lstat(root)
    if (info.isSymbolicLink()) errors.push(issue(ERROR_CODES.PATH_SYMLINK_FORBIDDEN, '.', '', 'Project root must not be a symbolic link'))
    if (!info.isDirectory()) errors.push(issue(ERROR_CODES.DIRECTORY_UNEXPECTED_TYPE, '.', '', 'Project root must be a directory'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { valid: false, standardVersion: STANDARD_VERSION, projectId: null, errors: [issue(ERROR_CODES.DIRECTORY_MISSING_REQUIRED_PATH, '.', '', 'Project root does not exist')], warnings, checkedDocuments: 0, checkedManagedFiles: 0, schemaValidation: documentValidator ? 'requested' : 'semantic-only' }
    throw error
  }
  for (const directory of REQUIRED_DIRECTORIES) await entry(root, directory, 'directory', errors)
  const available = new Set()
  for (const file of REQUIRED_FILES) if (await entry(root, file, 'file', errors)) available.add(file)
  await scanTree(root, allowGitKeep, errors)

  const documents = new Map()
  for (const [file, type] of Object.entries(REQUIRED_DOCUMENTS)) {
    if (!available.has(file)) continue
    const document = await readJson(root, file, errors); if (!document) continue
    documents.set(file, document)
    if (document.documentType !== type || document.$schema !== SCHEMA_IDS[type]) errors.push(issue(ERROR_CODES.SCHEMA_INVALID, file, '', `Document envelope must declare ${type} and its exact schema URI`))
    if (document.standardVersion !== STANDARD_VERSION) errors.push(issue(ERROR_CODES.VERSION_UNSUPPORTED, file, '/standardVersion', `Expected ${STANDARD_VERSION}`))
    if (documentValidator) {
      const result = await documentValidator(type, document)
      for (const schemaError of result.errors ?? []) errors.push(issue(ERROR_CODES.SCHEMA_INVALID, file, schemaError.instancePath ?? '', schemaError.message ?? 'JSON Schema validation failed', schemaError))
    }
  }

  const project = documents.get('project.json'); const rules = documents.get('rules.json'); const outline = documents.get('outline.json')
  const pagesDoc = documents.get('pages/manifest.json'); const sourceDoc = documents.get('source-materials/manifest.json'); const assetDoc = documents.get('assets/manifest.json')
  const projectId = project?.projectId ?? null
  if (project && path.basename(root) !== `${project.projectId}-${project.projectSlug}`) warnings.push(issue(ERROR_CODES.PROJECT_DIRECTORY_NAME_MISMATCH, '.', '', 'Directory name differs from the recommended <projectId>-<projectSlug>; project.json remains authoritative', undefined, 'warning'))
  if (project && rules && project.projectRulesId !== rules.projectRulesId) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, 'project.json', '/projectRulesId', 'projectRulesId does not match rules.json'))
  for (const [file, document] of documents) if (projectId && document.projectId !== projectId) errors.push(issue(ERROR_CODES.PROJECT_ID_MISMATCH, file, '/projectId', 'All canonical documents must use project.json projectId'))

  const ids = new Map()
  if (project) registerId(ids, 'project', project.projectId, 'project.json', '/projectId', errors)
  if (rules) registerId(ids, 'projectRules', rules.projectRulesId, 'rules.json', '/projectRulesId', errors)
  if (outline) registerId(ids, 'outlineDocument', outline.outlineDocumentId, 'outline.json', '/outlineDocumentId', errors)

  const nodes = Array.isArray(outline?.nodes) ? outline.nodes : []; const outlineIds = new Set()
  for (const [index, node] of nodes.entries()) {
    if (registerId(ids, 'outlineNode', node.outlineNodeId, 'outline.json', `/nodes/${index}/outlineNodeId`, errors)) outlineIds.add(node.outlineNodeId)
    checkSourceRefs(node.sourceRefs, 'outline.json', `/nodes/${index}/sourceRefs`, errors)
  }
  for (const [index, node] of nodes.entries()) if (node.parentOutlineNodeId && !outlineIds.has(node.parentOutlineNodeId)) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, 'outline.json', `/nodes/${index}/parentOutlineNodeId`, 'Parent outline node does not exist'))
  findOutlineCycles(nodes, errors)

  const materials = Array.isArray(sourceDoc?.materials) ? sourceDoc.materials : []; const sourceIds = new Set(); const sourcePaths = new Set(); const sourceHashes = new Map()
  for (const [index, material] of materials.entries()) {
    const ptr = `/materials/${index}`
    if (registerId(ids, 'sourceMaterial', material.sourceMaterialId, 'source-materials/manifest.json', `${ptr}/sourceMaterialId`, errors)) sourceIds.add(material.sourceMaterialId)
    for (const [nameIndex, fileName] of [material.originalFileName, ...(material.alternateOriginalFileNames ?? [])].entries()) {
      try { assertFileNameIsNfc(fileName) } catch (error) { errors.push(issue(error.code ?? ERROR_CODES.PATH_INVALID, 'source-materials/manifest.json', `${ptr}/${nameIndex ? `alternateOriginalFileNames/${nameIndex - 1}` : 'originalFileName'}`, error.message)) }
    }
    const expected = SOURCE_CATEGORY_DIRECTORIES[material.category]
    if (expected) await validateManagedFile(root, material, expected, 'source-materials/manifest.json', ptr, errors)
    if (sourcePaths.has(material.relativePath)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, 'source-materials/manifest.json', `${ptr}/relativePath`, 'Source path is already declared'))
    sourcePaths.add(material.relativePath)
    const key = `${material.sha256}:${material.sizeBytes}`
    if (sourceHashes.has(key)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, 'source-materials/manifest.json', `${ptr}/sha256`, `Source content duplicates ${sourceHashes.get(key)}; reuse its sourceMaterialId`))
    sourceHashes.set(key, material.sourceMaterialId)
  }

  const assets = Array.isArray(assetDoc?.assets) ? assetDoc.assets : []; const assetIds = new Set(); const assetPaths = new Set(); const assetHashes = new Map()
  for (const [index, asset] of assets.entries()) {
    const ptr = `/assets/${index}`
    if (registerId(ids, 'asset', asset.assetId, 'assets/manifest.json', `${ptr}/assetId`, errors)) assetIds.add(asset.assetId)
    checkSourceRefs(asset.sourceRefs, 'assets/manifest.json', `${ptr}/sourceRefs`, errors)
    const expected = ASSET_CATEGORY_DIRECTORIES[asset.category]
    if (expected) await validateManagedFile(root, asset, expected, 'assets/manifest.json', ptr, errors)
    if (assetPaths.has(asset.relativePath)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, 'assets/manifest.json', `${ptr}/relativePath`, 'Formal asset path is already declared'))
    assetPaths.add(asset.relativePath)
    const key = `${asset.sha256}:${asset.sizeBytes}`
    if (assetHashes.has(key)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, 'assets/manifest.json', `${ptr}/sha256`, `Formal asset content duplicates ${assetHashes.get(key)}; reuse its assetId`))
    assetHashes.set(key, asset.assetId)
  }
  for (const [index, asset] of assets.entries()) {
    for (const sourceId of asset.origin?.sourceMaterialIds ?? []) if (!sourceIds.has(sourceId)) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, 'assets/manifest.json', `/assets/${index}/origin/sourceMaterialIds`, `Unknown sourceMaterialId ${sourceId}`))
    for (const parentId of asset.origin?.parentAssetIds ?? []) if (!assetIds.has(parentId)) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, 'assets/manifest.json', `/assets/${index}/origin/parentAssetIds`, `Unknown parent asset ${parentId}`))
  }

  const pages = Array.isArray(pagesDoc?.pages) ? pagesDoc.pages : []; const pageOrders = new Set(); const draftPaths = new Set(); const drafts = []
  for (const [index, page] of pages.entries()) {
    const ptr = `/pages/${index}`
    registerId(ids, 'page', page.pageId, 'pages/manifest.json', `${ptr}/pageId`, errors)
    checkSourceRefs(page.sourceRefs, 'pages/manifest.json', `${ptr}/sourceRefs`, errors)
    if (page.outlineNodeId && !outlineIds.has(page.outlineNodeId)) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, 'pages/manifest.json', `${ptr}/outlineNodeId`, 'Page references an unknown outline node'))
    if (pageOrders.has(page.order)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, 'pages/manifest.json', `${ptr}/order`, 'Page order must be unique'))
    pageOrders.add(page.order)
    if (page.draftPath === null) {
      if (page.titleBlockId !== null) errors.push(issue(ERROR_CODES.REFERENCE_WRONG_SCOPE, 'pages/manifest.json', ptr, 'Page without draftPath must have titleBlockId null'))
      continue
    }
    try { assertPathIsNfc(page.draftPath) } catch (error) { errors.push(issue(error.code ?? ERROR_CODES.PATH_INVALID, 'pages/manifest.json', `${ptr}/draftPath`, error.message)); continue }
    if (page.draftPath !== `pages/drafts/${page.pageId}.json`) errors.push(issue(ERROR_CODES.REFERENCE_WRONG_SCOPE, 'pages/manifest.json', `${ptr}/draftPath`, 'Draft path must be pages/drafts/<pageId>.json'))
    if (draftPaths.has(page.draftPath)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, 'pages/manifest.json', `${ptr}/draftPath`, 'Draft path is assigned twice'))
    draftPaths.add(page.draftPath)
    const draft = await readJson(root, page.draftPath, errors); if (!draft) continue
    if (documentValidator) {
      const result = await documentValidator('DraftPageDocument', draft)
      for (const schemaError of result.errors ?? []) errors.push(issue(ERROR_CODES.SCHEMA_INVALID, page.draftPath, schemaError.instancePath ?? '', schemaError.message ?? 'JSON Schema validation failed', schemaError))
    }
    drafts.push({ draft, page, pageIndex: index, filePath: page.draftPath })
  }

  for (const { draft, page, pageIndex, filePath } of drafts) {
    if (draft.projectId !== projectId) errors.push(issue(ERROR_CODES.PROJECT_ID_MISMATCH, filePath, '/projectId', 'Draft projectId differs from project.json'))
    if (draft.pageId !== page.pageId) errors.push(issue(ERROR_CODES.REFERENCE_WRONG_SCOPE, filePath, '/pageId', 'Draft pageId differs from PageManifest'))
    registerId(ids, 'draftDocument', draft.draftDocumentId, filePath, '/draftDocumentId', errors)
    const contentIds = new Set(); const titles = []; const orders = new Set()
    for (const [blockIndex, block] of (draft.contentBlocks ?? []).entries()) {
      const ptr = `/contentBlocks/${blockIndex}`
      if (registerId(ids, 'contentBlock', block.contentBlockId, filePath, `${ptr}/contentBlockId`, errors)) contentIds.add(block.contentBlockId)
      if (orders.has(block.order)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, filePath, `${ptr}/order`, 'Content block order must be unique on a page'))
      orders.add(block.order); checkSourceRefs(block.sourceRefs, filePath, `${ptr}/sourceRefs`, errors)
      if (block.type === 'heading' && block.role === 'page_title') titles.push(block.contentBlockId)
      for (const [itemIndex, item] of (block.items ?? []).entries()) { registerId(ids, 'listItem', item.listItemId, filePath, `${ptr}/items/${itemIndex}/listItemId`, errors); checkSourceRefs(item.sourceRefs, filePath, `${ptr}/items/${itemIndex}/sourceRefs`, errors) }
      for (const [metricIndex, metric] of (block.metrics ?? []).entries()) { registerId(ids, 'metric', metric.metricId, filePath, `${ptr}/metrics/${metricIndex}/metricId`, errors); checkSourceRefs(metric.sourceRefs, filePath, `${ptr}/metrics/${metricIndex}/sourceRefs`, errors) }
      const columns = new Set()
      for (const [columnIndex, column] of (block.columns ?? []).entries()) { if (registerId(ids, 'tableColumn', column.tableColumnId, filePath, `${ptr}/columns/${columnIndex}/tableColumnId`, errors)) columns.add(column.tableColumnId) }
      for (const [rowIndex, row] of (block.rows ?? []).entries()) {
        registerId(ids, 'tableRow', row.tableRowId, filePath, `${ptr}/rows/${rowIndex}/tableRowId`, errors); checkSourceRefs(row.sourceRefs, filePath, `${ptr}/rows/${rowIndex}/sourceRefs`, errors)
        const rowColumns = new Set()
        for (const [cellIndex, cell] of (row.cells ?? []).entries()) {
          registerId(ids, 'tableCell', cell.tableCellId, filePath, `${ptr}/rows/${rowIndex}/cells/${cellIndex}/tableCellId`, errors); checkSourceRefs(cell.sourceRefs, filePath, `${ptr}/rows/${rowIndex}/cells/${cellIndex}/sourceRefs`, errors)
          if (!columns.has(cell.tableColumnId)) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, filePath, `${ptr}/rows/${rowIndex}/cells/${cellIndex}/tableColumnId`, 'Table cell references an unknown column'))
          if (rowColumns.has(cell.tableColumnId)) errors.push(issue(ERROR_CODES.DUPLICATE_CONTENT, filePath, `${ptr}/rows/${rowIndex}/cells/${cellIndex}/tableColumnId`, 'Row contains two cells for one column'))
          rowColumns.add(cell.tableColumnId)
        }
        if (columns.size && rowColumns.size !== columns.size) errors.push(issue(ERROR_CODES.REFERENCE_WRONG_SCOPE, filePath, `${ptr}/rows/${rowIndex}/cells`, 'Each table row must contain one cell for every column'))
      }
    }
    if (titles.length !== 1 || page.titleBlockId !== titles[0]) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, 'pages/manifest.json', `/pages/${pageIndex}/titleBlockId`, 'Generated draft must have exactly one page_title and PageManifest must reference it'))
    for (const [scriptIndex, script] of (draft.scriptBlocks ?? []).entries()) {
      const ptr = `/scriptBlocks/${scriptIndex}`
      registerId(ids, 'scriptBlock', script.scriptBlockId, filePath, `${ptr}/scriptBlockId`, errors); checkSourceRefs(script.sourceRefs, filePath, `${ptr}/sourceRefs`, errors)
      for (const id of script.referencedContentBlockIds ?? []) if (!contentIds.has(id)) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, filePath, `${ptr}/referencedContentBlockIds`, `Unknown page contentBlockId ${id}`))
      for (const id of script.referencedAssetIds ?? []) if (!assetIds.has(id)) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, filePath, `${ptr}/referencedAssetIds`, `Unknown assetId ${id}`))
    }
    for (const [assetIndex, pageAsset] of (draft.pageAssets ?? []).entries()) {
      const ptr = `/pageAssets/${assetIndex}`
      registerId(ids, 'pageAsset', pageAsset.pageAssetId, filePath, `${ptr}/pageAssetId`, errors); checkSourceRefs(pageAsset.sourceRefs, filePath, `${ptr}/sourceRefs`, errors)
      if (!assetIds.has(pageAsset.assetId)) errors.push(issue(ERROR_CODES.REFERENCE_NOT_FOUND, filePath, `${ptr}/assetId`, 'PageAsset references an unknown formal asset'))
    }
  }

  let managed = []
  for (const directory of ['pages/drafts', 'source-materials', 'assets']) managed.push(...await collectFiles(root, directory, allowGitKeep, errors))
  managed = managed.filter(file => !['source-materials/manifest.json', 'assets/manifest.json'].includes(file))
  const declared = new Set([...draftPaths, ...sourcePaths, ...assetPaths])
  for (const file of managed) if (!declared.has(file)) errors.push(issue(ERROR_CODES.FILE_UNDECLARED, file, '', 'Managed file is not declared by a canonical manifest'))
  for (const file of declared) if (!managed.includes(file) && !errors.some(error => error.code === ERROR_CODES.MANIFEST_FILE_MISSING && error.filePath === file)) errors.push(issue(ERROR_CODES.MANIFEST_FILE_MISSING, file, '', 'Declared managed file is not present'))

  return {
    valid: errors.length === 0, standardVersion: STANDARD_VERSION, projectId,
    errors, warnings, checkedDocuments: documents.size + drafts.length,
    checkedManagedFiles: sourcePaths.size + assetPaths.size,
    schemaValidation: documentValidator ? 'executed' : 'semantic-only',
  }
}
