import { createHash } from 'node:crypto'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import {
  REQUIRED_DIRECTORIES,
  SCHEMA_IDS,
  STANDARD_VERSION,
  createMinimalProjectDocuments,
  createStableId,
  isStableId,
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

async function archiveFiles(root) {
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) files.push({ relativePath: relative(root, path).split(sep).join('/'), dataBase64: (await readFile(path)).toString('base64') })
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
      title: node.title,
      children: children(node.outlineNodeId),
      extensionPayload: { standard: clone(node) },
    }))
  }
  return children(null)
}

function findAssetData(archive, asset) {
  const stored = archive.find(file => file.relativePath === asset.relativePath)
  return stored ? `data:${asset.mimeType};base64,${stored.dataBase64}` : null
}

export async function readStandardProject(projectRoot) {
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
  const archive = await archiveFiles(root)
  const assets = new Map(documents['assets/manifest.json'].assets.map(asset => [asset.assetId, asset]))
  const snapshot = {
    project: {
      id: documents['project.json'].projectId,
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
      const pageAssets = (draft?.pageAssets ?? []).map(link => assets.get(link.assetId)).filter(Boolean).map(asset => ({
        id: asset.assetId,
        name: asset.displayName,
        type: asset.mimeType,
        dataUrl: findAssetData(archive, asset),
      }))
      return {
        id: page.pageId,
        outlineNodeId: page.outlineNodeId,
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
    draftDocumentId: createStableId('draftDocument'),
    projectId,
    pageId: page.id,
    contentBlocks: [],
    scriptBlocks: [],
    pageAssets: [],
  }
  draft.projectId = projectId
  draft.pageId = page.id
  let heading = draft.contentBlocks.find(block => block.contentBlockId === refs.headingBlockId)
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
  if (page.script) {
    if (!script) {
      script = { scriptBlockId: createStableId('scriptBlock'), order: 0, content: page.script, estimatedDurationSeconds: null, sourceRefs: [], referencedContentBlockIds: [heading.contentBlockId], referencedAssetIds: [] }
      draft.scriptBlocks.push(script)
    }
    script.content = page.script
  } else if (script) draft.scriptBlocks = draft.scriptBlocks.filter(block => block !== script)
  draft.scriptBlocks = draft.scriptBlocks.map((block, index) => ({ ...block, order: index }))
  return { draft, titleBlockId: heading.contentBlockId }
}

async function writeBytesWithin(projectRoot, relativePath, bytes) {
  const target = resolve(projectRoot, ...relativePath.split('/'))
  if (target !== projectRoot && !target.startsWith(`${projectRoot}${sep}`)) throw new StudioError(ERROR_CODES.STANDARD_IMPORT_UNSUPPORTED, '标准项目文件路径越界。', { relativePath })
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, bytes)
}

export async function writeStandardProject({ snapshot, exportRoot }) {
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
  const pageDocuments = clone(archived?.pageDocuments ?? {})
  await mkdir(projectRoot, { recursive: true })
  for (const directory of REQUIRED_DIRECTORIES) await mkdir(join(projectRoot, ...directory.split('/')), { recursive: true })
  for (const file of archived?.files ?? []) await writeBytesWithin(projectRoot, file.relativePath, Buffer.from(file.dataBase64, 'base64'))

  documents['project.json'].projectId = snapshot.project.id
  documents['project.json'].name = snapshot.project.title
  documents['rules.json'].projectId = snapshot.project.id
  documents['outline.json'].projectId = snapshot.project.id
  documents['pages/manifest.json'].projectId = snapshot.project.id
  documents['source-materials/manifest.json'].projectId = snapshot.project.id
  documents['assets/manifest.json'].projectId = snapshot.project.id
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
