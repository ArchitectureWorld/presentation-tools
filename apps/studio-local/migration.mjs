import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { ERROR_CODES, STUDIO_SCHEMA_VERSION, StudioError, createStudioId } from '../../packages/studio-contracts/index.mjs'

const clone = value => structuredClone(value)

async function exists(path) {
  try { await stat(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

function validateLegacyState(value) {
  if (!value || value.schemaVersion !== 'report-studio.v0.1.0' || !value.project || !Array.isArray(value.outline) || !Array.isArray(value.pages)) {
    throw new StudioError(ERROR_CODES.MIGRATION_FAILED, '旧 state.json 不是受支持的 Report Studio v0.1.0 数据。', { schemaVersion: value?.schemaVersion ?? null }, 400)
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
  function outlineNode(node) {
    return {
      ...clone(node),
      id: mapped(node.id, 'outlineNode'),
      children: (node.children ?? []).map(outlineNode),
    }
  }

  mapped(legacy.project.id, 'project')
  const outline = legacy.outline.map(outlineNode)
  for (const page of legacy.pages) {
    mapped(page.id, 'page')
    for (const asset of page.assets ?? []) mapped(asset.id, 'asset')
  }
  for (const annotation of legacy.annotations ?? []) mapped(annotation.id, 'annotation')
  for (const round of legacy.reviewRounds ?? []) mapped(round.id, 'reviewRound')
  for (const submission of legacy.reviewSubmissions ?? []) mapped(submission.id, 'reviewSubmission')
  for (const proposal of legacy.proposals ?? []) mapped(proposal.id, 'proposal')

  const pages = legacy.pages.map(page => ({
    ...clone(page),
    id: reference(page.id),
    outlineNodeId: reference(page.outlineNodeId),
    assets: (page.assets ?? []).map(asset => ({ ...clone(asset), id: reference(asset.id) })),
  }))
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
    project: { ...clone(legacy.project), id: reference(legacy.project.id) },
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
  const backupPath = join(backupDirectory, 'state.v0.1.0.json')
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
