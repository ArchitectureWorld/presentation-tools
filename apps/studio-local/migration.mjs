import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { ERROR_CODES, STUDIO_SCHEMA_VERSION, StudioError, createStudioId } from '../../packages/studio-contracts/index.mjs'

const clone = value => structuredClone(value)

async function exists(path) {
  try { await stat(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

function validateLegacyState(value) {
  if (!value || !['report-studio.v0.1.0', 'report-studio.v0.1.1'].includes(value.schemaVersion) || !value.project || !Array.isArray(value.outline) || !Array.isArray(value.pages)) {
    throw new StudioError(ERROR_CODES.MIGRATION_FAILED, '旧 state.json 不是受支持的 Report Studio v0.1.0 或 v0.1.1 数据。', { schemaVersion: value?.schemaVersion ?? null }, 400)
  }
}

export async function inspectLegacyState(dataDir) {
  const path = join(dataDir, 'state.json')
  if (!(await exists(path))) return { exists: false, path, bytes: null, state: null }
  const bytes = await readFile(path, 'utf8')
  let state
  try { state = JSON.parse(bytes) }
  catch (error) { throw new StudioError(ERROR_CODES.MIGRATION_FAILED, '旧 state.json 无法解析。', { cause: error.message }, 400) }
  validateLegacyState(state)
  return { exists: true, path, bytes, state }
}

function mapLegacyState(legacy, migrationMap) {
  const ids = migrationMap.ids
  function mapped(oldId, kind) {
    if (oldId === null || oldId === undefined) return oldId
    if (!ids[oldId]) ids[oldId] = createStudioId(kind)
    return ids[oldId]
  }
  function reference(oldId) { return ids[oldId] ?? oldId }
  function scopeKey(value) {
    const text = String(value ?? '')
    const separator = text.indexOf(':')
    if (separator < 0) return text
    const prefix = text.slice(0, separator)
    const objectId = text.slice(separator + 1)
    return `${prefix}:${reference(objectId)}`
  }
  function target(value) {
    if (!value || typeof value !== 'object') return clone(value)
    return { ...clone(value), id: reference(value.id) }
  }
  function outlineNode(node, parentOutlineNodeId = null) {
    const nodeId = mapped(node.id, 'outlineNode')
    return {
      ...clone(node),
      id: nodeId,
      outlineNodeId: node.outlineNodeId ? mapped(node.outlineNodeId, 'outlineNode') : nodeId,
      parentOutlineNodeId: node.parentOutlineNodeId === null || node.parentOutlineNodeId === undefined ? parentOutlineNodeId : reference(node.parentOutlineNodeId),
      order: node.order ?? 0,
      sourceRefs: clone(node.sourceRefs ?? []),
      opaqueExtension: clone(node.opaqueExtension ?? null),
      children: (node.children ?? []).map(child => outlineNode(child, nodeId)),
    }
  }

  function canonicalId(value, key, kind) {
    return value ?? mapped(key, kind)
  }

  function pageCanonical(page, index) {
    const pageId = reference(page.id)
    const contentBlocks = clone(page.contentBlocks ?? [])
    const title = contentBlocks.find(block => block.contentBlockId === page.titleBlockId)
      ?? contentBlocks.find(block => block.type === 'heading' && block.role === 'page_title')
      ?? { contentBlockId: mapped(`${page.id}:titleBlock`, 'contentBlock'), type: 'heading', role: 'page_title', order: 0, content: page.heading ?? '未命名页面', sourceRefs: [] }
    if (!contentBlocks.includes(title)) contentBlocks.push(title)
    title.contentBlockId = canonicalId(title.contentBlockId, `${page.id}:titleBlock`, 'contentBlock')
    title.type ??= 'heading'
    title.role ??= 'page_title'
    title.content ??= page.heading ?? '未命名页面'
    title.sourceRefs ??= []
    let body = contentBlocks.find(block => block.type === 'text' && block.role === 'body') ?? null
    if (page.body) {
      if (!body) {
        body = { contentBlockId: mapped(`${page.id}:bodyBlock`, 'contentBlock'), type: 'text', role: 'body', order: contentBlocks.length, content: page.body, sourceRefs: [] }
        contentBlocks.push(body)
      }
      body.contentBlockId = canonicalId(body.contentBlockId, `${page.id}:bodyBlock`, 'contentBlock')
      body.content = page.body
      body.sourceRefs ??= []
    }
    let list = contentBlocks.find(block => block.type === 'list') ?? null
    const bullets = (page.bullets ?? []).filter(value => String(value).trim())
    if (bullets.length) {
      if (!list) {
        list = { contentBlockId: mapped(`${page.id}:listBlock`, 'contentBlock'), type: 'list', role: 'body', order: contentBlocks.length, listStyle: 'unordered', items: [], sourceRefs: [] }
        contentBlocks.push(list)
      }
      list.contentBlockId = canonicalId(list.contentBlockId, `${page.id}:listBlock`, 'contentBlock')
      list.items = bullets.map((content, itemIndex) => ({
        ...(list.items?.[itemIndex] ?? {}),
        listItemId: canonicalId(list.items?.[itemIndex]?.listItemId, `${page.id}:listItem:${itemIndex}`, 'listItem'),
        content: String(content), order: itemIndex,
        sourceRefs: clone(list.items?.[itemIndex]?.sourceRefs ?? []),
      }))
    }
    const scriptBlocks = clone(page.scriptBlocks ?? [])
    if (page.script && !scriptBlocks.length) scriptBlocks.push({
      scriptBlockId: mapped(`${page.id}:scriptBlock:0`, 'scriptBlock'), order: 0, content: page.script,
      estimatedDurationSeconds: null, referencedContentBlockIds: [title.contentBlockId], referencedAssetIds: [], sourceRefs: [],
    })
    for (const [scriptIndex, script] of scriptBlocks.entries()) {
      script.scriptBlockId = canonicalId(script.scriptBlockId, `${page.id}:scriptBlock:${scriptIndex}`, 'scriptBlock')
      script.order ??= scriptIndex
      script.content ??= ''
      script.estimatedDurationSeconds ??= null
      script.referencedContentBlockIds ??= [title.contentBlockId]
      script.referencedAssetIds ??= []
      script.sourceRefs ??= []
    }
    const pageAssets = clone(page.pageAssets ?? [])
    if (!pageAssets.length) for (const [assetIndex, asset] of (page.assets ?? []).entries()) {
      const { id: legacyId, ...legacyAsset } = clone(asset)
      pageAssets.push({
        ...legacyAsset, pageAssetId: mapped(`${page.id}:pageAsset:${assetIndex}`, 'pageAsset'), assetId: reference(legacyId),
        role: asset.role ?? 'supporting', caption: asset.caption ?? '', order: assetIndex,
        sourceRefs: clone(asset.sourceRefs ?? []),
      })
    }
    for (const [assetIndex, asset] of pageAssets.entries()) {
      asset.pageAssetId = canonicalId(asset.pageAssetId, `${page.id}:pageAsset:${assetIndex}`, 'pageAsset')
      asset.assetId = reference(asset.assetId)
      asset.order ??= assetIndex
      asset.role ??= 'supporting'
      asset.caption ??= ''
      asset.sourceRefs ??= []
    }
    return {
      ...clone(page), id: pageId, pageId,
      outlineNodeId: reference(page.outlineNodeId),
      draftDocumentId: canonicalId(page.draftDocumentId, `${page.id}:draftDocument`, 'draftDocument'),
      titleBlockId: title.contentBlockId, order: page.order ?? index,
      contentBlocks: contentBlocks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((block, blockIndex) => ({ ...block, order: blockIndex })),
      scriptBlocks: scriptBlocks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((block, blockIndex) => ({ ...block, order: blockIndex })),
      pageAssets: pageAssets.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((asset, assetIndex) => ({ ...asset, order: assetIndex })),
      assets: (page.assets ?? []).map(asset => ({ ...clone(asset), id: reference(asset.id), assetId: reference(asset.id) })),
    }
  }

  mapped(legacy.project.id, 'project')
  const outline = legacy.outline.map(node => outlineNode(node))
  for (const page of legacy.pages) {
    mapped(page.id, 'page')
    for (const asset of page.assets ?? []) mapped(asset.id, 'asset')
  }
  for (const annotation of legacy.annotations ?? []) mapped(annotation.id, 'annotation')
  for (const round of legacy.reviewRounds ?? []) mapped(round.id, 'reviewRound')
  for (const submission of legacy.reviewSubmissions ?? []) mapped(submission.id, 'reviewSubmission')
  for (const proposal of legacy.proposals ?? []) mapped(proposal.id, 'proposal')

  const pages = legacy.pages.map(pageCanonical)
  const annotations = (legacy.annotations ?? []).map(annotation => ({
    ...clone(annotation),
    id: reference(annotation.id),
    scopeKey: scopeKey(annotation.scopeKey),
    reviewRoundId: reference(annotation.reviewRoundId),
    target: target(annotation.target),
  }))
  const reviewRounds = (legacy.reviewRounds ?? []).map(round => ({
    ...clone(round), id: reference(round.id), scopeKey: scopeKey(round.scopeKey),
  }))
  const reviewSubmissions = (legacy.reviewSubmissions ?? []).map(submission => ({
    ...clone(submission),
    id: reference(submission.id),
    reviewRoundId: reference(submission.reviewRoundId),
    status: submission.status === 'created' ? 'pending_dispatch' : submission.status,
    annotations: (submission.annotations ?? []).map(annotation => ({ ...clone(annotation), id: reference(annotation.id), target: target(annotation.target) })),
  }))
  const proposals = (legacy.proposals ?? []).map(proposal => ({
    ...clone(proposal),
    id: reference(proposal.id),
    submissionId: reference(proposal.submissionId),
    reviewRoundId: reference(proposal.reviewRoundId),
    commands: (proposal.commands ?? []).map(command => ({
      ...clone(command),
      ...(command.nodeId ? { nodeId: reference(command.nodeId) } : {}),
      ...(command.parentId ? { parentId: reference(command.parentId) } : {}),
      ...(command.pageId ? { pageId: reference(command.pageId) } : {}),
      ...(command.outlineNodeId ? { outlineNodeId: reference(command.outlineNodeId) } : {}),
    })),
  }))

  return {
    schemaVersion: STUDIO_SCHEMA_VERSION,
    project: {
      ...clone(legacy.project),
      id: reference(legacy.project.id),
      projectId: legacy.project.projectId ? canonicalId(legacy.project.projectId, `${legacy.project.id}:projectId`, 'project') : reference(legacy.project.id),
      projectRulesId: canonicalId(legacy.project.projectRulesId, `${legacy.project.id}:projectRules`, 'projectRules'),
      outlineDocumentId: canonicalId(legacy.project.outlineDocumentId, `${legacy.project.id}:outlineDocument`, 'outlineDocument'),
    },
    outline,
    pages,
    annotations,
    reviewRounds,
    reviewSubmissions,
    proposals,
    revisions: [],
    ui: { ...clone(legacy.ui ?? { stage: 'outline', activePageId: null }), activePageId: reference(legacy.ui?.activePageId) },
  }
}

export async function prepareLegacyMigration(dataDir) {
  const inspected = await inspectLegacyState(dataDir)
  if (!inspected.exists) throw new StudioError(ERROR_CODES.MIGRATION_FAILED, '未找到可迁移的 state.json。', undefined, 404)
  const backupDirectory = join(dataDir, 'backups', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
  const backupPath = join(backupDirectory, `state.${inspected.state.schemaVersion.replace('report-studio.', '')}.json`)
  await mkdir(dirname(backupPath), { recursive: true })
  await writeFile(backupPath, inspected.bytes, { encoding: 'utf8', flag: 'wx' })

  const mapPath = join(dataDir, 'migration-map.json')
  let migrationMap
  if (await exists(mapPath)) migrationMap = JSON.parse(await readFile(mapPath, 'utf8'))
  else migrationMap = { schemaVersion: 'report-studio.migration-map.v0.1.1', sourceSchemaVersion: inspected.state.schemaVersion, ids: {} }
  const state = mapLegacyState(inspected.state, migrationMap)
  if (!(await exists(mapPath))) await writeFile(mapPath, `${JSON.stringify(migrationMap, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return {
    ...inspected,
    legacyState: inspected.state,
    sourceSchemaVersion: inspected.state.schemaVersion,
    state,
    migrationMap,
    mapPath,
    backupPath,
  }
}
