import { createHash } from 'node:crypto'
import { basename, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import {
  REQUIRED_DIRECTORIES,
  SCHEMA_IDS,
  STANDARD_VERSION,
  createMinimalProjectDocuments,
  createStableId,
  validateProjectDirectoryWithAjv,
} from '../../contracts/presentation-standard-project/src/index.mjs'
import { ERROR_CODES, StudioError, assertCanonicalSnapshot } from '../studio-contracts/index.mjs'

const clone = value => structuredClone(value)
const JSON_DOCUMENTS = ['project.json', 'rules.json', 'outline.json', 'pages/manifest.json', 'source-materials/manifest.json', 'assets/manifest.json']

function rootPath(value) {
  return value instanceof URL ? fileURLToPath(value) : resolve(value)
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(join(root, ...relativePath.split('/')), 'utf8'))
}

async function archiveFiles(root, putBlob) {
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        const relativePath = relative(root, path).split(sep).join('/')
        if (JSON_DOCUMENTS.includes(relativePath) || relativePath.startsWith('pages/drafts/')) continue
        if (typeof putBlob !== 'function') throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '标准项目导入需要 Repository Blob 存储。', undefined, 500)
        const info = await stat(path)
        const mimeType = relativePath.endsWith('.svg') ? 'image/svg+xml' : relativePath.endsWith('.csv') ? 'text/csv' : 'application/octet-stream'
        const objectRef = await putBlob(createReadStream(path), { mimeType, originalFileName: basename(path), sizeBytes: info.size })
        files.push({ relativePath, objectRef, sizeBytes: objectRef.sizeBytes, mimeType: objectRef.mimeType, sha256: objectRef.sha256 })
      }
    }
  }
  await walk(root)
  return files
}

function buildOutline(nodes) {
  const byParent = new Map()
  for (const node of nodes) {
    const key = node.parentOutlineNodeId ?? null
    const rows = byParent.get(key) ?? []
    rows.push(node)
    byParent.set(key, rows)
  }
  function children(parentId) {
    return (byParent.get(parentId) ?? []).sort((a, b) => a.order - b.order).map(node => ({
      id: node.outlineNodeId,
      outlineNodeId: node.outlineNodeId,
      parentOutlineNodeId: node.parentOutlineNodeId,
      title: node.title,
      order: node.order,
      sourceRefs: clone(node.sourceRefs ?? []),
      opaqueExtension: null,
      children: children(node.outlineNodeId),
      extensionPayload: { standard: clone(node) },
    }))
  }
  return children(null)
}

function findAssetData(archive, asset) {
  const stored = archive.find(file => file.relativePath === asset.relativePath)
  return stored?.objectRef ?? null
}

export async function readStandardProject(projectRoot, { putBlob } = {}) {
  const root = rootPath(projectRoot)
  const validation = await validateProjectDirectoryWithAjv(root, { allowGitKeep: true })
  if (!validation.valid) {
    throw new StudioError(ERROR_CODES.STANDARD_CONTRACT_INVALID, '标准项目目录未通过 Contract 校验。', { errors: validation.errors }, 400)
  }
  const documents = Object.fromEntries(await Promise.all(JSON_DOCUMENTS.map(async path => [path, await readJson(root, path)])))
  const pageDocuments = {}
  for (const page of documents['pages/manifest.json'].pages) {
    if (page.draftPath) pageDocuments[page.draftPath] = await readJson(root, page.draftPath)
  }
  const archive = await archiveFiles(root, putBlob)
  const assets = new Map(documents['assets/manifest.json'].assets.map(asset => [asset.assetId, asset]))
  const snapshot = {
    project: {
      id: documents['project.json'].projectId,
      projectId: documents['project.json'].projectId,
      projectRulesId: documents['project.json'].projectRulesId,
      outlineDocumentId: documents['outline.json'].outlineDocumentId,
      title: documents['project.json'].name,
      createdAt: documents['project.json'].createdAt,
      extensionPayload: {
        standardArchive: { documents: clone(documents), pageDocuments: clone(pageDocuments), files: archive },
      },
    },
    outline: buildOutline(documents['outline.json'].nodes),
    pages: documents['pages/manifest.json'].pages.map(page => {
      const draft = page.draftPath ? pageDocuments[page.draftPath] : null
      const heading = draft?.contentBlocks.find(block => block.type === 'heading' && block.role === 'page_title') ?? null
      const body = draft?.contentBlocks.find(block => block.type === 'text' && block.role === 'body')
        ?? draft?.contentBlocks.find(block => block.type === 'text' && block.role === 'key_message') ?? null
      const list = draft?.contentBlocks.find(block => block.type === 'list') ?? null
      const script = draft?.scriptBlocks?.[0] ?? null
      const pageAssets = (draft?.pageAssets ?? []).map(link => ({
        ...clone(link),
        asset: assets.get(link.assetId) ?? null,
      })).filter(item => item.asset).map(({ asset, ...link }) => ({
        id: asset.assetId,
        assetId: asset.assetId,
        pageAssetId: link.pageAssetId,
        role: link.role,
        caption: link.caption,
        order: link.order,
        sourceRefs: clone(link.sourceRefs ?? []),
        name: asset.displayName,
        type: asset.mimeType,
        mimeType: asset.mimeType,
        objectRef: findAssetData(archive, asset),
        widthPx: asset.metadata?.widthPx,
        heightPx: asset.metadata?.heightPx,
        extensionPayload: { standard: clone(asset) },
      }))
      return {
        id: page.pageId,
        pageId: page.pageId,
        outlineNodeId: page.outlineNodeId,
        draftDocumentId: draft?.draftDocumentId ?? null,
        titleBlockId: page.titleBlockId,
        order: page.order,
        contentBlocks: clone(draft?.contentBlocks ?? []),
        scriptBlocks: clone(draft?.scriptBlocks ?? []),
        pageAssets: clone(draft?.pageAssets ?? []),
        heading: heading?.content ?? '',
        body: body?.content ?? '',
        bullets: (list?.items ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(item => item.content),
        script: (draft?.scriptBlocks ?? []).sort((a, b) => a.order - b.order).map(item => item.content).join('\n\n'),
        assets: pageAssets,
        extensionPayload: {
          standard: {
            manifest: clone(page),
            draft: clone(draft),
            fieldRefs: {
              headingBlockId: heading?.contentBlockId ?? null,
              bodyBlockId: body?.contentBlockId ?? null,
              listBlockId: list?.contentBlockId ?? null,
              scriptBlockId: script?.scriptBlockId ?? null,
            },
          },
        },
      }
    }),
  }
  assertCanonicalSnapshot(snapshot)
  return { snapshot, validation }
}

function slugify(value) {
  const slug = String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'report-studio-project'
}

function flattenOutline(nodes, preserved, parentId = null, rows = []) {
  nodes.forEach((node, index) => {
    const original = preserved.get(node.id) ?? node.extensionPayload?.standard ?? {}
    rows.push({
      ...clone(original),
      outlineNodeId: node.id,
      parentOutlineNodeId: parentId,
      kind: original.kind ?? (parentId ? 'section' : 'chapter'),
      title: node.title,
      summary: original.summary ?? '',
      order: index,
      sourceRefs: clone(original.sourceRefs ?? []),
    })
    flattenOutline(node.children ?? [], preserved, node.id, rows)
  })
  return rows
}

function updateDraft(page, projectId) {
  const standard = page.extensionPayload?.standard ?? {}
  const refs = standard.fieldRefs ?? {}
  const draft = standard.draft ? clone(standard.draft) : {
    $schema: SCHEMA_IDS.DraftPageDocument,
    documentType: 'DraftPageDocument',
    standardVersion: STANDARD_VERSION,
    draftDocumentId: page.draftDocumentId ?? createStableId('draftDocument'),
    projectId,
    pageId: page.id,
    contentBlocks: [],
    scriptBlocks: [],
    pageAssets: [],
  }
  draft.projectId = projectId
  draft.pageId = page.id
  draft.draftDocumentId = page.draftDocumentId ?? draft.draftDocumentId
  if (Array.isArray(page.contentBlocks)) draft.contentBlocks = clone(page.contentBlocks)
  if (Array.isArray(page.scriptBlocks)) draft.scriptBlocks = clone(page.scriptBlocks)
  if (Array.isArray(page.pageAssets)) draft.pageAssets = page.pageAssets.map(link => ({
    pageAssetId: link.pageAssetId,
    assetId: link.assetId,
    role: link.role,
    caption: link.caption,
    order: link.order,
    ...(link.sourceRefs === undefined ? {} : { sourceRefs: clone(link.sourceRefs) }),
  }))
  let heading = draft.contentBlocks.find(block => block.contentBlockId === page.titleBlockId || block.contentBlockId === refs.headingBlockId)
    ?? draft.contentBlocks.find(block => block.type === 'heading' && block.role === 'page_title')
  if (!heading) {
    heading = { contentBlockId: createStableId('contentBlock'), type: 'heading', role: 'page_title', order: 0, content: page.heading || '未命名页面', sourceRefs: [] }
    draft.contentBlocks.push(heading)
  }
  heading.content = page.heading || '未命名页面'
  let body = draft.contentBlocks.find(block => block.contentBlockId === refs.bodyBlockId)
  if (page.body) {
    if (!body) {
      body = { contentBlockId: createStableId('contentBlock'), type: 'text', role: 'body', order: draft.contentBlocks.length, content: page.body, sourceRefs: [] }
      draft.contentBlocks.push(body)
    }
    body.content = page.body
  } else if (body) draft.contentBlocks = draft.contentBlocks.filter(block => block !== body)
  let list = draft.contentBlocks.find(block => block.contentBlockId === refs.listBlockId)
  const bullets = (page.bullets ?? []).filter(value => String(value).trim())
  if (bullets.length) {
    if (!list) {
      list = { contentBlockId: createStableId('contentBlock'), type: 'list', role: 'body', order: draft.contentBlocks.length, listStyle: 'unordered', items: [], sourceRefs: [] }
      draft.contentBlocks.push(list)
    }
    list.items = bullets.map((content, index) => ({
      ...(list.items?.[index] ?? {}),
      listItemId: list.items?.[index]?.listItemId ?? createStableId('listItem'),
      content,
      order: index,
      sourceRefs: clone(list.items?.[index]?.sourceRefs ?? []),
    }))
  } else if (list) draft.contentBlocks = draft.contentBlocks.filter(block => block !== list)
  draft.contentBlocks = draft.contentBlocks.sort((a, b) => a.order - b.order).map((block, index) => ({ ...block, order: index }))

  let script = draft.scriptBlocks.find(block => block.scriptBlockId === refs.scriptBlockId) ?? draft.scriptBlocks[0]
  const canonicalScriptText = draft.scriptBlocks.slice().sort((a, b) => a.order - b.order).map(block => block.content).join('\n\n')
  if (page.script) {
    if (!script) {
      script = { scriptBlockId: createStableId('scriptBlock'), order: 0, content: page.script, estimatedDurationSeconds: null, sourceRefs: [], referencedContentBlockIds: [heading.contentBlockId], referencedAssetIds: [] }
      draft.scriptBlocks.push(script)
    }
    if (page.script !== canonicalScriptText) script.content = page.script
  } else if (script) draft.scriptBlocks = draft.scriptBlocks.filter(block => block !== script)
  draft.scriptBlocks = draft.scriptBlocks.map((block, index) => ({ ...block, order: index }))

  if (!Array.isArray(page.pageAssets) || (!page.pageAssets.length && (page.assets?.length ?? 0) > 0)) {
    const preservedPageAssets = new Map((draft.pageAssets ?? []).map(item => [item.assetId, item]))
    draft.pageAssets = (page.assets ?? []).map((asset, index) => ({
      ...clone(preservedPageAssets.get(asset.id) ?? {}),
      pageAssetId: preservedPageAssets.get(asset.id)?.pageAssetId ?? createStableId('pageAsset'),
      assetId: asset.id,
      role: preservedPageAssets.get(asset.id)?.role ?? 'supporting',
      order: index,
      caption: preservedPageAssets.get(asset.id)?.caption ?? '',
      sourceRefs: clone(preservedPageAssets.get(asset.id)?.sourceRefs ?? []),
    }))
  }
  return { draft, titleBlockId: heading.contentBlockId }
}

const EXTENSION_BY_MIME = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
})

function jpegDimensions(bytes) {
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { widthPx: bytes.readUInt16BE(offset + 7), heightPx: bytes.readUInt16BE(offset + 5) }
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2) break
    offset += length + 2
  }
  return null
}

function imageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png' && bytes.length >= 24) {
    return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) }
  }
  if (mimeType === 'image/gif' && bytes.length >= 10) {
    return { widthPx: bytes.readUInt16LE(6), heightPx: bytes.readUInt16LE(8) }
  }
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  if (mimeType === 'image/webp' && bytes.length >= 30 && bytes.subarray(12, 16).toString('ascii') === 'VP8X') {
    return {
      widthPx: 1 + bytes.readUIntLE(24, 3),
      heightPx: 1 + bytes.readUIntLE(27, 3),
    }
  }
  if (mimeType === 'image/svg+xml') {
    const source = bytes.toString('utf8')
    const svg = /<svg\b[^>]*>/iu.exec(source)?.[0] ?? ''
    const width = /\bwidth=["']([0-9]+(?:\.[0-9]+)?)/iu.exec(svg)?.[1]
    const height = /\bheight=["']([0-9]+(?:\.[0-9]+)?)/iu.exec(svg)?.[1]
    if (width && height) return { widthPx: Math.max(1, Math.round(Number(width))), heightPx: Math.max(1, Math.round(Number(height))) }
    const viewBox = /\bviewBox=["'][^"']*?([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s*["']/iu.exec(svg)
    if (viewBox) return { widthPx: Math.max(1, Math.round(Number(viewBox[1]))), heightPx: Math.max(1, Math.round(Number(viewBox[2]))) }
  }
  return null
}

async function blobHeader(openBlob, objectRef, limit = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of await openBlob(objectRef)) {
    const bytes = Buffer.from(chunk)
    chunks.push(bytes.subarray(0, Math.max(0, limit - size)))
    size += bytes.length
    if (size >= limit) break
  }
  return Buffer.concat(chunks)
}

async function materializePageAssets({ snapshot, documents, projectRoot, openBlob }) {
  const manifest = documents['assets/manifest.json']
  const records = new Map((manifest.assets ?? []).map(asset => [asset.assetId, asset]))
  for (const page of snapshot.pages) {
    for (const asset of page.assets ?? []) {
      const preserved = records.get(asset.id) ?? asset.extensionPayload?.standard ?? null
      if (!asset.objectRef) {
        if (asset.dataUrl || asset.dataBase64) throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '旧版内联素材必须先迁移为 ObjectRef 后才能导出。', { assetId: asset.id })
        if (!preserved) throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '页面素材缺少可导出的文件内容。', { assetId: asset.id })
        continue
      }
      if (typeof openBlob !== 'function') throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '恢复页面素材需要 Blob 读取器。', { assetId: asset.id })
      const mimeType = asset.mimeType ?? asset.type
      const extension = EXTENSION_BY_MIME[mimeType]
      if (!extension) throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '当前版本不支持导出该素材格式。', { assetId: asset.id, mimeType })
      const header = await blobHeader(openBlob, asset.objectRef)
      const dimensions = {
        widthPx: asset.widthPx ?? preserved?.metadata?.widthPx,
        heightPx: asset.heightPx ?? preserved?.metadata?.heightPx,
        ...imageDimensions(header, mimeType),
      }
      if (!dimensions.widthPx || !dimensions.heightPx) {
        throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '无法读取图片尺寸，不能生成可信的标准素材记录。', { assetId: asset.id, mimeType })
      }
      const relativePath = preserved?.relativePath ?? `assets/images/${asset.id}${extension}`
      await writeStreamWithin(projectRoot, relativePath, await openBlob(asset.objectRef))
      const createdAt = asset.createdAt ?? preserved?.createdAt ?? snapshot.project.createdAt
      records.set(asset.id, {
        ...clone(preserved ?? {}),
        assetId: asset.id,
        displayName: asset.name || preserved?.displayName || asset.id,
        mediaType: 'image',
        category: preserved?.category ?? 'image',
        semanticRole: preserved?.semanticRole ?? '页面素材',
        relativePath,
        mimeType,
        sizeBytes: asset.sizeBytes ?? asset.objectRef.sizeBytes,
        sha256: asset.sha256 ?? asset.objectRef.sha256,
        metadata: { ...clone(preserved?.metadata ?? {}), ...dimensions },
        adoptionStatus: preserved?.adoptionStatus ?? 'adopted',
        origin: clone(preserved?.origin ?? {
          type: 'human_added',
          sourceMaterialIds: [],
          parentAssetIds: [],
          method: 'Report Studio 页面上传',
          sourceTool: { name: 'report-studio', version: '0.1.1' },
        }),
        sourceRefs: clone(preserved?.sourceRefs ?? []),
        createdAt,
        adoptedAt: preserved?.adoptedAt ?? createdAt,
        retiredAt: preserved?.retiredAt ?? null,
      })
    }
  }
  manifest.assets = [...records.values()]
}

async function writeBytesWithin(projectRoot, relativePath, bytes) {
  const target = resolve(projectRoot, ...relativePath.split('/'))
  if (target !== projectRoot && !target.startsWith(`${projectRoot}${sep}`)) throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '标准项目文件路径越界。', { relativePath })
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, bytes)
}

async function writeStreamWithin(projectRoot, relativePath, stream) {
  const target = resolve(projectRoot, ...relativePath.split('/'))
  if (target !== projectRoot && !target.startsWith(`${projectRoot}${sep}`)) throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '标准项目文件路径越界。', { relativePath })
  await mkdir(resolve(target, '..'), { recursive: true })
  await pipeline(stream, createWriteStream(target, { flags: 'w' }))
}

export async function writeStandardProject({ snapshot, exportRoot, openBlob } = {}) {
  assertCanonicalSnapshot(snapshot)
  const root = resolve(exportRoot)
  const archived = snapshot.project.extensionPayload?.standardArchive
  const projectSlug = archived?.documents?.['project.json']?.projectSlug ?? slugify(snapshot.project.title)
  const projectRoot = join(root, `${snapshot.project.id}-${projectSlug}`)
  const documents = archived?.documents ? clone(archived.documents) : createMinimalProjectDocuments({
    projectId: snapshot.project.id,
    projectSlug,
    name: snapshot.project.title,
    createdAt: snapshot.project.createdAt,
  })
  await mkdir(projectRoot, { recursive: true })
  for (const directory of REQUIRED_DIRECTORIES) await mkdir(join(projectRoot, ...directory.split('/')), { recursive: true })
  for (const file of archived?.files ?? []) {
    if (JSON_DOCUMENTS.includes(file.relativePath) || file.relativePath.startsWith('pages/drafts/')) continue
    if (typeof openBlob !== 'function' || !file.objectRef) throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '恢复标准项目文件需要 Blob 读取器。', { relativePath: file.relativePath })
    await writeStreamWithin(projectRoot, file.relativePath, await openBlob(file.objectRef))
  }

  documents['project.json'].projectId = snapshot.project.id
  documents['project.json'].name = snapshot.project.title
  documents['rules.json'].projectId = snapshot.project.id
  documents['outline.json'].projectId = snapshot.project.id
  documents['pages/manifest.json'].projectId = snapshot.project.id
  documents['source-materials/manifest.json'].projectId = snapshot.project.id
  documents['assets/manifest.json'].projectId = snapshot.project.id
  await materializePageAssets({ snapshot, documents, projectRoot, openBlob })
  const preservedOutline = new Map((documents['outline.json'].nodes ?? []).map(node => [node.outlineNodeId, node]))
  documents['outline.json'].nodes = flattenOutline(snapshot.outline, preservedOutline)

  const preservedPages = new Map((documents['pages/manifest.json'].pages ?? []).map(page => [page.pageId, page]))
  const nextPageDocuments = {}
  documents['pages/manifest.json'].pages = snapshot.pages.map((page, index) => {
    const { draft, titleBlockId } = updateDraft(page, snapshot.project.id)
    const draftPath = `pages/drafts/${page.id}.json`
    nextPageDocuments[draftPath] = draft
    const original = preservedPages.get(page.id) ?? page.extensionPayload?.standard?.manifest ?? {}
    return {
      ...clone(original),
      pageId: page.id,
      outlineNodeId: page.outlineNodeId,
      order: index,
      titleBlockId,
      draftPath,
      sourceRefs: clone(original.sourceRefs ?? []),
    }
  })

  for (const [path, document] of Object.entries({ ...documents, ...nextPageDocuments })) {
    await writeBytesWithin(projectRoot, path, Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8'))
  }
  const validation = await validateProjectDirectoryWithAjv(projectRoot, { allowGitKeep: true })
  if (!validation.valid) throw new StudioError(ERROR_CODES.STANDARD_CONTRACT_INVALID, '导出的标准项目未通过 Contract 校验。', { errors: validation.errors }, 500)
  return { projectRoot, validation }
}
