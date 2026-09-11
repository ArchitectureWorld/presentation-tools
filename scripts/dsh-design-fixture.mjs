// Test support only. No CLI, host installation, model calls, workflow execution,
// source repository constructors, credentials, or cleanup of caller directories.
import { createHash, randomUUID } from 'node:crypto'
import { lstat, realpath, readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute, parse, join, sep, win32, extname } from 'node:path'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createStableId, isStableId } from '../contracts/presentation-standard-project/src/ids.mjs'
import { ID_PREFIXES, REQUIRED_FILES } from '../contracts/presentation-standard-project/src/constants.mjs'
import { mimeMatchesExtension, sniffKnownMime } from '../contracts/presentation-standard-project/src/mime.mjs'
import { validateProjectDirectoryWithAjv } from '../contracts/presentation-standard-project/src/index.mjs'
import { assertCanonicalSnapshot, assertStudioCommand, createStudioId, CONTROL_SCHEMA_VERSION } from '../packages/studio-contracts/index.mjs'
import { assertLayoutPageDocument, createLayoutId } from '../packages/studio-layout-contracts/index.mjs'
import { writeStandardProject } from '../packages/studio-standard-adapter/index.mjs'

const captures = new WeakMap()
const clone = value => structuredClone(value)
const sha = value => createHash('sha256').update(value).digest('hex')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const sorted = value => Array.isArray(value) ? value.map(sorted) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value
const semanticHash = value => sha(JSON.stringify(sorted(value)))
const fail = (code, field = '') => { throw new Error(`${code}${field ? `: ${field}` : ''}`) }
const OPAQUE_SOURCE_MIMES = new Set(['application/acad', 'application/vnd.rar'])
const DWG_HEADERS = new Set(['AC1009', 'AC1012', 'AC1014', 'AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'])
// Signature recognition only: never parse, execute, or extract opaque contents.
function opaqueSourceMime(bytes, path, expected) {
  const extension = extname(path).toLowerCase()
  const dwg = bytes.length >= 8 && DWG_HEADERS.has(bytes.subarray(0, 6).toString('latin1')) && bytes[6] === 0 && bytes[7] === 0
  const rar = (bytes.length >= 7 && bytes.subarray(0, 7).equals(Buffer.from('526172211a0700', 'hex')))
    || (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('526172211a070100', 'hex')))
  const detected = dwg ? 'application/acad' : rar ? 'application/vnd.rar' : null
  if (detected || ['.dwg', '.rar'].includes(extension) || OPAQUE_SOURCE_MIMES.has(expected.mimeType)) {
    if (!detected || detected !== expected.mimeType || extension !== (dwg ? '.dwg' : '.rar')) fail('asset_opaque_signature_mime_mismatch')
    if (!Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes !== bytes.length) fail('asset_hash_integrity_mismatch', 'opaque recorded size')
  }
  return detected
}
const equal = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const within = (root, path) => equal(root, path) || (!relative(root, path).startsWith(`..${sep}`) && relative(root, path) !== '..' && !isAbsolute(relative(root, path)))
const overlap = (a, b) => within(a, b) || within(b, a)
const absolute = (path, field) => {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail('unsafe_absolute_path', field)
  return resolve(path)
}
const safeRelative = path => {
  if (typeof path !== 'string' || !path || isAbsolute(path) || win32.isAbsolute(path) || /[\\:\0]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail('unsafe_relative_path', 'relativePath')
  return path
}
async function noLinks(path) {
  const full = absolute(path, 'path')
  let cursor = parse(full).root
  for (const part of relative(cursor, full).split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    try {
      const stat = await lstat(cursor)
      if (stat.isSymbolicLink() || !equal(await realpath(cursor), cursor)) fail('unsafe_reparse_or_symlink', 'path ancestry')
    } catch (error) { if (error.code === 'ENOENT') return; throw error }
  }
}
const protectedRoots = [resolve('D:/少潭河'), resolve('C:/Users/2899/.dsh'), resolve('C:/Users/2899/Nutstore/1/开发/12_前期策划/Reference'), resolve(dirname(fileURLToPath(import.meta.url)), '..')]
async function validateTarget(targetRoot, containmentRoot, sources) {
  const target = absolute(targetRoot, 'targetRoot'); const container = absolute(containmentRoot, 'containmentRoot')
  if (equal(container, parse(container).root) || equal(container, homedir())) fail('unsafe_containment_root')
  if (!within(container, target) || equal(container, target)) fail('target_outside_containment')
  await noLinks(container); await noLinks(target)
  const actualContainer = await realpath(container)
  if (!within(actualContainer, target)) fail('target_outside_real_containment')
  if (protectedRoots.some(root => overlap(root, target)) || sources.some(root => overlap(root, target))) fail('target_overlaps_protected_source')
  try { await lstat(target); fail('target_already_exists') } catch (error) { if (error.code !== 'ENOENT') throw error }
  // A pre-existing parent is required; creation never recursively traverses
  // caller-selected missing ancestors.
  await realpath(dirname(target))
  return target
}

const TABLES = {
  preplanning_agent: ['projects', 'state_objects', 'revisions', 'events', 'bindings', 'proposals', 'questions', 'idempotency'],
  preplanning_governance: ['project_policies', 'authorizations', 'workflow_runs', 'gate_decisions', 'visual_policies', 'visual_tasks', 'visual_assets', 'site_boundaries', 'report_packages'],
  preplanning_presentation: ['bindings'],
  preplanning_synthetic_boundary_fingerprints: ['fingerprints'],
}
const RECORD_FIELDS = {
  projects: 'projectId name currentRevision currentStage createdAt updatedAt',
  state_objects: 'projectId objectId revision value updatedAt',
  revisions: 'revisionId projectId revision parentRevision committedAt committedBy stateSnapshot',
  events: 'eventId projectId eventType revision actor occurredAt payload',
  bindings: 'sessionId projectId boundAt',
  proposals: 'proposalId projectId expectedRevision idempotencyKey envelope status createdAt committedAt committedBy confirmedAt confirmedBy committedRevision',
  questions: 'questionId projectId prompt priority workflowId owner dueAt blockingLevel evidenceIds status createdAt resolvedAt resolvedRevision',
  idempotency: 'projectId idempotencyKey proposalId eventId revision createdAt',
  project_policies: 'projectId mode reportDepth visualPolicyId automationAuthorizationId updatedAt',
  authorizations: 'authorizationId projectId grantedBy startingRevision scope status grantedAt expiresAt revokedAt revokedBy revocationReason',
  workflow_runs: 'runId projectId workflowId chapterId workItemId targetObjectId status attempt proposalId confirmedRevision blockedReason updatedAt',
  gate_decisions: 'decisionId projectId gateId revision decision source authorizationId decidedBy decidedAt reason snapshot',
  visual_policies: 'policyId projectId enabled targetConceptImages maxAttemptsPerTask allowedMimeTypes minWidth minHeight projectGenerationBudget updatedAt',
  visual_tasks: 'taskId projectId chapterId workItemId kind required status attempts childId blockedReason updatedAt',
  visual_assets: 'assetId taskId projectId kind required status referenceAssetIds provider model promptSummary mimeType fileName sha256 boundaryGeometrySha256 boundaryEvidence width height quality createdAt adoptedRevision',
  site_boundaries: 'boundaryId projectId submittedRevision status source origin submissionChannel sourceAsset geometry submittedBy submittedAt confirmedBy confirmedAt confirmedRevision confirmationChannel confirmationStatement confirmationSourceSha256',
  report_packages: 'packageId projectId sourceRevision status sectionIds adoptedAssetIds warnings artifactManifestId createdAt publishedAt',
  presentation: 'preDesignProjectId presentationProjectId projectSlug workspaceRoot directoryRoot standardVersion state stableIds lastExportedPreDesignRevision lastExportedAt lastExportedObjectHashes lastExportedFileHashes lastFailure createdAt updatedAt',
  fingerprints: 'fingerprint boundaryId createdAt',
}
function readDomain(value, name) {
  if (!object(value) || value.unit?.name !== name || value.unit.version !== 1 || !object(value.tables)) fail('unsupported_storage_schema', name)
  if (value.global !== null && value.global !== undefined && (!object(value.global) || Object.keys(value.global).length)) fail('unsupported_unscoped_global', name)
  for (const table of Object.keys(value.tables)) if (!TABLES[name].includes(table)) fail('unsupported_storage_table', `${name}.${table}`)
  const tables = {}
  for (const table of TABLES[name]) {
    const records = value.tables[table] ?? {}
    if (!object(records)) fail('unsupported_storage_records', `${name}.${table}`)
    tables[table] = clone(records)
  }
  return { unit: { name, version: 1 }, global: value.global ?? {}, tables }
}
function scopePre(domains, projectId, revision, completed) {
  const result = clone(domains)
  for (const [name, domain] of Object.entries(result)) {
    if (name === 'preplanning_synthetic_boundary_fingerprints') continue
    for (const [table, records] of Object.entries(domain.tables)) {
      const ownerField = name === 'preplanning_presentation' ? 'preDesignProjectId' : 'projectId'
      for (const [key, record] of Object.entries(records)) {
        if (!object(record) || typeof record[ownerField] !== 'string') fail('unsupported_unscoped_record', `${name}.${table}`)
        if (record[ownerField] !== projectId) { delete records[key]; continue }
        const allowed = RECORD_FIELDS[name === 'preplanning_presentation' ? 'presentation' : table].split(' ')
        for (const field of Object.keys(record)) if (!allowed.includes(field)) fail('unsupported_record_field', `${name}.${table}.${field}`)
      }
    }
  }
  const a = result.preplanning_agent.tables; const g = result.preplanning_governance.tables
  const project = a.projects[projectId]; const frozen = a.revisions[`${projectId}:${revision}`]
  if (!project || project.currentRevision !== revision || !frozen || frozen.revision !== revision || frozen.projectId !== projectId || !object(frozen.stateSnapshot)) fail('pre_frozen_revision_identity_mismatch')
  a.revisions = { [`${projectId}:${revision}`]: frozen }
  // No invented prior revisions: this is an explicitly frozen revision island.
  frozen.parentRevision = null
  const state = {}
  for (const [key, value] of Object.entries(frozen.stateSnapshot)) {
    const record = a.state_objects[`${projectId}:${key}`]
    if (!record || record.objectId !== key || record.revision > revision || semanticHash(record.value) !== semanticHash(value)) fail('pre_frozen_state_integrity', 'state_objects/stateSnapshot')
    state[`${projectId}:${key}`] = record
  }
  a.state_objects = state
  a.proposals = Object.fromEntries(Object.entries(a.proposals).filter(([, row]) => ['confirmed', 'provisionally_committed'].includes(row.status) && row.committedRevision <= revision))
  a.events = Object.fromEntries(Object.entries(a.events).filter(([, row]) => row.revision <= revision))
  a.questions = Object.fromEntries(Object.entries(a.questions).filter(([, row]) => row.status === 'resolved' && row.resolvedRevision <= revision))
  a.idempotency = Object.fromEntries(Object.entries(a.idempotency).filter(([, row]) => row.revision <= revision && a.proposals[row.proposalId] && a.events[row.eventId]))
  g.workflow_runs = Object.fromEntries(Object.entries(g.workflow_runs).filter(([, row]) => ['confirmed', 'not_applicable'].includes(row.status) && (row.confirmedRevision ?? revision) <= revision))
  if (Object.keys(g.workflow_runs).length !== completed || new Set(Object.values(g.workflow_runs).map(row => row.workItemId)).size !== completed) fail('pre_completed_work_count_mismatch')
  g.visual_tasks = Object.fromEntries(Object.entries(g.visual_tasks).filter(([, row]) => row.status === 'adopted'))
  g.visual_assets = Object.fromEntries(Object.entries(g.visual_assets).filter(([, row]) => row.status === 'adopted' && row.adoptedRevision <= revision))
  g.site_boundaries = Object.fromEntries(Object.entries(g.site_boundaries).filter(([, row]) => row.status === 'confirmed_formal_boundary' && row.confirmedRevision <= revision))
  g.report_packages = {} // Published package IDs have external artifact bindings; not workflow state.
  for (const policy of Object.values(g.project_policies)) { policy.mode = 'manual'; delete policy.automationAuthorizationId }
  for (const authorization of Object.values(g.authorizations)) authorization.status = 'revoked'
  for (const policy of Object.values(g.visual_policies)) { policy.enabled = false; policy.projectGenerationBudget = 0 }
  for (const task of Object.values(g.visual_tasks)) delete task.childId
  result.preplanning_synthetic_boundary_fingerprints.tables.fingerprints = Object.fromEntries(Object.entries(result.preplanning_synthetic_boundary_fingerprints.tables.fingerprints).filter(([, row]) => Object.hasOwn(g.site_boundaries, row.boundaryId)))
  return result
}

function historicalReviewTargets(operational) {
  const revisions = new Set(); const targets = new Map(); const roundRevisions = new Map()
  const forRevision = revision => {
    if (!Number.isSafeInteger(revision) || revision < 0) return null
    revisions.add(revision)
    if (!targets.has(revision)) targets.set(revision, new Map())
    return targets.get(revision)
  }
  const add = (revision, id, kind = null, pageId = null) => {
    if (id === 'outline:root') return
    const rows = forRevision(revision)
    if (!rows || typeof id !== 'string' || !id) return
    if (!rows.has(id)) rows.set(id, { kinds: new Set(), pageIds: new Set() })
    if (kind) rows.get(id).kinds.add(kind)
    if (pageId) rows.get(id).pageIds.add(pageId)
  }
  const addReviewedPage = (revision, id) => {
    if (!forRevision(revision) || typeof id !== 'string' || !id) return
    add(revision, id, 'page', id)
  }
  const addScope = (revision, scopeKey) => {
    const pageId = typeof scopeKey === 'string' && scopeKey.startsWith('draft:') ? scopeKey.slice(6) : null
    addReviewedPage(revision, pageId)
    return pageId
  }
  const linkRound = (roundId, revision) => {
    if (typeof roundId !== 'string' || !forRevision(revision)) return
    if (!roundRevisions.has(roundId)) roundRevisions.set(roundId, new Set())
    roundRevisions.get(roundId).add(revision)
  }
  for (const annotation of operational.annotations ?? []) {
    const revision = annotation.createdAgainstRevision
    linkRound(annotation.reviewRoundId, revision); const pageId = addScope(revision, annotation.scopeKey)
    const kind = annotation.target?.type === 'page' ? 'page' : annotation.target?.type === 'content-block' ? 'contentBlock' : null
    if (kind === 'page') addReviewedPage(revision, annotation.target?.id)
    else add(revision, annotation.target?.id, kind, pageId)
  }
  for (const submission of operational.reviewSubmissions ?? []) {
    const revision = submission.baseRevision
    linkRound(submission.reviewRoundId, revision); const scopePageId = addScope(revision, submission.scopeKey); addReviewedPage(revision, submission.pageId)
    for (const id of submission.writableIds ?? []) {
      const owners = new Set([scopePageId, submission.pageId].filter(Boolean))
      if (!owners.size) add(revision, id)
      for (const pageId of owners) add(revision, id, null, pageId)
    }
  }
  for (const round of operational.reviewRounds ?? []) {
    for (const revision of roundRevisions.get(round.id ?? round.reviewRoundId) ?? []) {
      addScope(revision, round.scopeKey); addReviewedPage(revision, round.pageId)
    }
  }
  return { revisions, targets }
}

function snapshotReviewTargets(snapshot) {
  const result = new Map()
  for (const page of snapshot.pages) {
    const add = (id, kind) => result.set(id, { kind, pageId: page.id })
    add(page.id, 'page'); add(page.draftDocumentId, 'draftDocument')
    for (const block of page.contentBlocks) {
      add(block.contentBlockId, 'contentBlock')
      for (const item of block.type === 'list' ? block.items : []) add(item.listItemId, 'listItem')
    }
    for (const script of page.scriptBlocks) add(script.scriptBlockId, 'scriptBlock')
  }
  return result
}

function canonicalObjectIds(snapshot) {
  const ids = new Set([snapshot.project.id])
  const outline = nodes => {
    for (const node of nodes ?? []) { ids.add(node.id); outline(node.children) }
  }
  outline(snapshot.outline)
  for (const page of snapshot.pages) {
    for (const id of [page.id, page.draftDocumentId]) ids.add(id)
    for (const block of page.contentBlocks) {
      ids.add(block.contentBlockId)
      for (const item of block.items ?? []) ids.add(item.listItemId)
    }
    for (const script of page.scriptBlocks) ids.add(script.scriptBlockId)
    for (const asset of page.pageAssets) { ids.add(asset.pageAssetId); ids.add(asset.assetId) }
  }
  return ids
}

const UTC_MILLISECOND_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
function parseUtcMillisecondTimestamp(value) {
  if (typeof value !== 'string' || !UTC_MILLISECOND_TIMESTAMP.test(value)) return Number.NaN
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : Number.NaN
}

function validateReviewRunActivity(operational, leaseComparedAt) {
  const comparedAt = parseUtcMillisecondTimestamp(leaseComparedAt)
  for (const run of operational.reviewRuns ?? []) {
    if (run.leaseExpiresAt != null) {
      const expiresAt = parseUtcMillisecondTimestamp(run.leaseExpiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt > comparedAt) fail('unsupported_active_studio_review', 'reviewRuns.leaseExpiresAt')
    }
    if (run.phase === 'queued' && run.integrationState === 'dispatch_failed'
      && run.workerSessionRef === null) {
      const expiresAt = run.leaseExpiresAt == null ? null : parseUtcMillisecondTimestamp(run.leaseExpiresAt)
      if (run.leaseExpiresAt == null || (Number.isFinite(expiresAt) && expiresAt <= comparedAt)) continue
    }
    if (['queued', 'running'].includes(run.phase) || ['pending_dispatch', 'dispatched'].includes(run.integrationState)) {
      fail('unsupported_active_studio_review', 'reviewRuns')
    }
  }
}

function validateAcceptedCurrentProposal({ operational, snapshot, revision, revisionSha256, canonicalSha256, currentRevision }) {
  const proposals = operational.proposals ?? []
  if (!proposals.length) return
  if (proposals.length !== 1) fail('unsupported_current_proposals', 'operational.proposals')
  const proposal = proposals[0]
  if (!object(proposal) || Object.hasOwn(proposal, 'kind')) fail('accepted_proposal_kind')
  if (proposal.status !== 'accepted') fail('accepted_proposal_status')
  if (!object(proposal.candidateSnapshot)) fail('accepted_proposal_candidate')
  try { assertCanonicalSnapshot(proposal.candidateSnapshot) } catch { fail('accepted_proposal_candidate') }
  if (semanticHash(proposal.candidateSnapshot) !== semanticHash(snapshot)) fail('accepted_proposal_candidate')
  if (!Number.isSafeInteger(proposal.baseRevision) || proposal.baseRevision < 0
    || proposal.acceptedRevision !== currentRevision || proposal.baseRevision + 1 !== currentRevision) fail('accepted_proposal_revision')
  if (proposal.projectId !== snapshot.project.id) fail('accepted_proposal_references')
  const summaries = (operational.revisions ?? []).filter(row => row.number === currentRevision)
  const summary = summaries[0]
  if (revision.source !== 'agent' || revision.detail?.proposalId !== proposal.id || revision.detail?.submissionId !== proposal.submissionId
    || summaries.length !== 1 || summary.id !== revision.revisionId || summary.source !== 'agent'
    || summary.detail?.proposalId !== proposal.id || summary.detail?.submissionId !== proposal.submissionId
    || summary.stateHash !== canonicalSha256 || summary.revisionRef?.sha256 !== revisionSha256) fail('accepted_proposal_revision_evidence')
  if (!Array.isArray(proposal.commands) || !proposal.commands.length) fail('accepted_proposal_command')
  const currentPageIds = new Set(snapshot.pages.map(page => page.id))
  for (const command of proposal.commands) {
    try { assertStudioCommand(command) } catch { fail('accepted_proposal_command') }
    if (command.type !== 'draft.update' || command.riskLevel !== 'ordinary_reversible'
      || !object(command.patch) || Object.keys(command.patch).length !== 1 || typeof command.patch.body !== 'string'
      || command.baseRevision !== proposal.baseRevision || command.scopeKey !== proposal.scopeKey
      || command.scopeKey !== `draft:${command.pageId}` || !currentPageIds.has(command.pageId)) fail('accepted_proposal_command')
  }
  const submission = (operational.reviewSubmissions ?? []).find(row => row.id === proposal.submissionId && row.reviewSubmissionId === proposal.submissionId)
  const round = (operational.reviewRounds ?? []).find(row => row.id === proposal.reviewRoundId)
  const runs = (operational.reviewRuns ?? []).filter(row => row.reviewSubmissionId === proposal.submissionId && row.resultProposalId === proposal.id)
  if (!submission || submission.status !== 'accepted' || submission.reviewRoundId !== proposal.reviewRoundId
    || submission.projectId !== proposal.projectId || submission.scopeKey !== proposal.scopeKey || submission.baseRevision !== proposal.baseRevision
    || !submission.allowedCommands?.includes('draft.update') || !submission.writableIds?.includes(submission.pageId)
    || submission.scopeKey !== `draft:${submission.pageId}` || proposal.commands.some(command => command.pageId !== submission.pageId)
    || !round || round.projectId !== proposal.projectId || round.scopeKey !== proposal.scopeKey || round.pageId !== submission.pageId
    || runs.length !== 1 || runs[0].reviewRunId !== submission.activeReviewRunId
    || runs[0].integrationState !== 'accepted' || runs[0].phase !== 'completed') fail('accepted_proposal_references')
  const annotationIds = new Set((submission.annotationSnapshots ?? []).map(row => row.annotationId))
  const commandAnnotationIds = [...new Set(proposal.commands.flatMap(command => command.sourceAnnotationIds))].sort()
  if (!Array.isArray(proposal.sourceAnnotationIds) || JSON.stringify([...proposal.sourceAnnotationIds].sort()) !== JSON.stringify(commandAnnotationIds)
    || commandAnnotationIds.some(id => !annotationIds.has(id))
    || commandAnnotationIds.some(id => !(operational.annotations ?? []).some(row => row.id === id && row.reviewRoundId === proposal.reviewRoundId))) fail('accepted_proposal_references')
  const changes = proposal.diff?.changes
  const before = proposal.diff?.before
  const after = proposal.diff?.after
  const knownIds = canonicalObjectIds(snapshot)
  const affected = Array.isArray(proposal.affectedObjectIds) ? [...proposal.affectedObjectIds].sort() : []
  if (proposal.aggregateRiskLevel !== 'ordinary_reversible' || proposal.hasDeletion !== false || !Array.isArray(changes) || !changes.length
    || !Array.isArray(before) || !Array.isArray(after) || before.length !== changes.length || after.length !== changes.length
    || changes.some(change => !object(change) || change.changeType === 'deleted' || !knownIds.has(change.objectId))
    || changes.some((change, index) => !object(before[index]) || !object(after[index])
      || before[index].objectId !== change.objectId || after[index].objectId !== change.objectId
      || !Object.hasOwn(before[index], 'value') || !Object.hasOwn(after[index], 'value')
      || JSON.stringify(sorted(before[index].value)) !== JSON.stringify(sorted(change.before))
      || JSON.stringify(sorted(after[index].value)) !== JSON.stringify(sorted(change.after)))
    || JSON.stringify(affected) !== JSON.stringify(changes.map(change => change.objectId).sort())) fail('accepted_proposal_references')
}

/** Read only. All paths refer to stable captures or explicitly scoped byte roots.
 * revisionPath is the actual RevisionRecord object referenced by control;
 * canonicalPath is its CanonicalSnapshot object. Operational is control.operational.
 * referencedBlobs = [{path, sha256, sizeBytes, mimeType}]. For blobs outside the
 * capture/workspace, declare assetSourceRoots; no directory enumeration occurs.
 */
export async function captureFixtureSources(input) {
  const leaseComparedAt = new Date().toISOString()
  if (!input.manualLayoutPath) fail('manual_first_page_capture_required')
  const sourceRoots = [input.sourceSnapshotRoot, input.standardWorkspace, ...(input.assetSourceRoots ?? [])].map((path, i) => absolute(path, `sourceRoots[${i}]`))
  for (const root of sourceRoots) { await noLinks(root); await realpath(root) }
  const files = new Map(); const blobs = new Map()
  async function read(path) {
    const full = absolute(path, 'source file')
    if (!sourceRoots.some(root => within(root, full))) fail('source_file_outside_containment')
    await noLinks(full)
    const bytes = await readFile(full)
    const digest = sha(bytes)
    if (files.has(full) && files.get(full).sha256 !== digest) fail('source_changed_during_capture')
    files.set(full, { bytes, sha256: digest })
    return bytes
  }
  const readJson = async path => JSON.parse((await read(path)).toString('utf8'))
  const control = await readJson(input.controlPath)
  const revision = await readJson(input.revisionPath)
  const canonical = await readJson(input.canonicalPath)
  if (control.schemaVersion !== CONTROL_SCHEMA_VERSION || revision.kind !== 'RevisionRecord' || canonical.kind !== 'CanonicalSnapshot'
    || control.projectHead?.currentRevisionRef?.sha256 !== files.get(resolve(input.revisionPath)).sha256
    || revision.snapshotRef?.sha256 !== files.get(resolve(input.canonicalPath)).sha256
    || control.projectHead.currentRevision !== (input.expectedStudioRevision ?? 111) || revision.revisionNumber !== control.projectHead.currentRevision
    || control.projectHead.projectId !== canonical.value?.project?.id) fail('studio_current_object_integrity_mismatch')
  assertCanonicalSnapshot(canonical.value)
  const sourceSnapshot = clone(canonical.value)
  const domains = {}
  for (const name of Object.keys(TABLES)) domains[name] = readDomain(await readJson(input.preStoragePaths[name]), name)
  const pre = scopePre(domains, input.preProjectId, input.expectedPreRevision ?? 59, input.expectedCompletedWorkItems ?? 57)
  const binding = pre.preplanning_presentation.tables.bindings[input.preProjectId]
  if (!binding || binding.presentationProjectId !== canonical.value.project.id || binding.lastExportedPreDesignRevision !== (input.expectedPreRevision ?? 59)
    || !equal(resolve(binding.workspaceRoot ?? ''), resolve(input.standardWorkspace))) fail('presentation_binding_identity_mismatch')
  const workspaceDocuments = {}
  for (const path of REQUIRED_FILES) workspaceDocuments[path] = await readJson(join(input.standardWorkspace, path))
  if (workspaceDocuments['project.json'].projectId !== canonical.value.project.id) fail('standard_workspace_identity_mismatch')
  for (const page of workspaceDocuments['pages/manifest.json'].pages) if (page.draftPath) await readJson(join(input.standardWorkspace, safeRelative(page.draftPath)))
  async function addBlob(path, expected) {
    const bytes = await read(path)
    if (!/^[a-f0-9]{64}$/u.test(expected.sha256 ?? '') || sha(bytes) !== expected.sha256 || (expected.sizeBytes !== undefined && bytes.length !== expected.sizeBytes)) fail('asset_hash_integrity_mismatch')
    const detected = opaqueSourceMime(bytes, path, expected) ?? sniffKnownMime(bytes)
    if (!mimeMatchesExtension(path, expected.mimeType) || (detected && detected !== expected.mimeType) || (!detected && /^image\//u.test(expected.mimeType ?? ''))) fail('asset_mime_mismatch')
    if (!detected) {
      if (!['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/geo+json'].includes(expected.mimeType)) fail('unsupported_asset_mime_verification', 'referenced bytes MIME')
      let text
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { fail('asset_mime_mismatch', 'invalid UTF-8') }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) fail('asset_mime_mismatch', 'binary text content')
      if (expected.mimeType.includes('json')) { try { JSON.parse(text) } catch { fail('asset_mime_mismatch', 'invalid JSON') } }
    }
    blobs.set(expected.sha256, { bytes, sha256: expected.sha256, sizeBytes: bytes.length, mimeType: expected.mimeType })
  }
  for (const blob of input.referencedBlobs ?? []) await addBlob(blob.path, blob)
  const snapshot = clone(canonical.value)
  const docs = snapshot.project.extensionPayload?.standardArchive?.documents
  if (!docs) fail('unsupported_canonical_standardArchive', 'project.extensionPayload.standardArchive.documents')
  const usedAssetIds = new Set()
  function collectAssetRefs(value, field = '') {
    if (typeof value === 'string' && ['assetId', 'referencedAssetIds', 'evidenceIds'].includes(field) && isStableId('asset', value)) usedAssetIds.add(value)
    else if (Array.isArray(value)) value.forEach(child => collectAssetRefs(child, field))
    else if (object(value)) for (const [key, child] of Object.entries(value)) collectAssetRefs(child, key)
  }
  collectAssetRefs(snapshot.pages); collectAssetRefs(snapshot.outline)
  docs['assets/manifest.json'].assets = docs['assets/manifest.json'].assets.filter(asset => usedAssetIds.has(asset.assetId))
  // Archive manifests are authoritative content; workspace is only a source of
  // captured file bytes. Export later reconstructs current drafts via the adapter.
  for (const manifest of ['source-materials/manifest.json', 'assets/manifest.json']) {
    const records = docs[manifest]?.materials ?? docs[manifest]?.assets ?? []
    for (const record of records) await addBlob(join(input.standardWorkspace, safeRelative(record.relativePath)), record)
  }
  const managedPaths = new Set([...docs['source-materials/manifest.json'].materials, ...docs['assets/manifest.json'].assets].map(record => record.relativePath))
  snapshot.project.extensionPayload.standardArchive.files = (snapshot.project.extensionPayload.standardArchive.files ?? []).filter(file => {
    safeRelative(file.relativePath)
    if (!managedPaths.has(file.relativePath)) return false
    if (!blobs.has(file.objectRef?.sha256)) fail('referenced_archive_bytes_missing', 'standardArchive.files')
    return true
  })
  for (const page of snapshot.pages) for (const asset of page.pageAssets) {
    if (!asset.objectRef || !blobs.has(asset.objectRef.sha256)) fail('referenced_asset_bytes_missing', 'pageAssets.objectRef')
    const blob = blobs.get(asset.objectRef.sha256)
    if (blob.sizeBytes !== asset.objectRef.sizeBytes || blob.mimeType !== (asset.mimeType ?? asset.type)) fail('referenced_asset_integrity_mismatch')
  }
  for (const asset of Object.values(pre.preplanning_governance.tables.visual_assets)) {
    if (!blobs.has(asset.sha256)) fail('referenced_pre_asset_bytes_missing', 'visual_assets.sha256')
    safeRelative(asset.fileName)
    if (asset.mimeType !== blobs.get(asset.sha256).mimeType
      || !['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extname(asset.fileName).toLowerCase())
      || !mimeMatchesExtension(asset.fileName, asset.mimeType)) fail('referenced_pre_asset_mime_mismatch', 'visual_assets.mimeType/fileName')
  }
  let layout = null
  if (input.manualLayoutPath) {
    layout = assertLayoutPageDocument(await readJson(input.manualLayoutPath))
    const firstPage = [...snapshot.pages].sort((a, b) => a.order - b.order)[0]
    if (layout.projectId !== snapshot.project.id || layout.pageId !== firstPage?.id) fail('manual_first_page_identity_mismatch')
  }
  const operational = clone(control.operational)
  if (!object(operational)) fail('unsupported_operational_schema')
  for (const field of ['annotations', 'reviewRounds', 'reviewSubmissions', 'reviewRuns', 'proposals']) if (!Array.isArray(operational[field] ?? [])) fail('unsupported_operational_field', field)
  validateReviewRunActivity(operational, leaseComparedAt)
  validateAcceptedCurrentProposal({ operational, snapshot: sourceSnapshot, revision, revisionSha256: files.get(resolve(input.revisionPath)).sha256, canonicalSha256: files.get(resolve(input.canonicalPath)).sha256, currentRevision: control.projectHead.currentRevision })
  const historyInput = input.historicalSnapshots ?? []
  if (!Array.isArray(historyInput)) fail('unsupported_historical_snapshots_input')
  if (historyInput.length && !Array.isArray(operational.revisions)) fail('unsupported_operational_field', 'revisions')
  const reviewTargets = historyInput.length ? historicalReviewTargets(operational) : { revisions: new Set(), targets: new Map() }
  const currentTargets = snapshotReviewTargets(snapshot)
  const historicalSnapshots = []; const seenHistoricalRevisions = new Set()
  for (const [index, entry] of historyInput.entries()) {
    if (!object(entry) || Object.keys(entry).some(key => !['revisionPath', 'canonicalPath'].includes(key))) fail('unsupported_historical_snapshots_input', `historicalSnapshots[${index}]`)
    const historicalRevision = await readJson(entry.revisionPath); const historicalCanonical = await readJson(entry.canonicalPath)
    const revisionSha256 = files.get(resolve(entry.revisionPath)).sha256; const canonicalSha256 = files.get(resolve(entry.canonicalPath)).sha256
    const revisionNumber = historicalRevision.revisionNumber
    const summaries = (operational.revisions ?? []).filter(row => row.number === revisionNumber)
    if (historicalRevision.kind !== 'RevisionRecord' || !Number.isSafeInteger(revisionNumber) || revisionNumber < 0 || revisionNumber >= control.projectHead.currentRevision
      || seenHistoricalRevisions.has(revisionNumber) || summaries.length !== 1 || summaries[0].id !== historicalRevision.revisionId
      || summaries[0].revisionRef?.sha256 !== revisionSha256) fail('historical_revision_integrity_mismatch')
    if (historicalCanonical.kind !== 'CanonicalSnapshot' || historicalRevision.snapshotRef?.sha256 !== canonicalSha256
      || summaries[0].stateHash !== canonicalSha256) fail('historical_snapshot_integrity_mismatch')
    assertCanonicalSnapshot(historicalCanonical.value)
    if (historicalCanonical.value.project.id !== snapshot.project.id) fail('historical_project_identity_mismatch')
    if (!reviewTargets.revisions.has(revisionNumber)) fail('historical_review_revision_unreferenced')
    const defined = snapshotReviewTargets(historicalCanonical.value); const referenced = reviewTargets.targets.get(revisionNumber) ?? new Map()
    const historicalOnlyTargetIds = []
    for (const [id, expected] of referenced) {
      const actual = defined.get(id)
      if (!actual || !expected.pageIds.size || [...expected.pageIds].some(pageId => pageId !== actual.pageId) || (expected.kinds.size && !expected.kinds.has(actual.kind))) fail('historical_review_target_not_found')
      if (!currentTargets.has(id)) historicalOnlyTargetIds.push(id)
    }
    if (!historicalOnlyTargetIds.length) fail('historical_snapshot_unused')
    seenHistoricalRevisions.add(revisionNumber)
    historicalSnapshots.push({ revisionNumber, revisionSha256, canonicalSha256, historicalOnlyTargetIds: historicalOnlyTargetIds.sort() })
  }
  const data = { input: clone(input), sourceRoots, files, blobs, snapshot, pre, operational, layout, historicalSnapshots, leaseComparedAt }
  await unchanged(data)
  const token = Object.freeze({ sourceFileCount: files.size, sourceStudioRevision: control.projectHead.currentRevision, sourcePreRevision: input.expectedPreRevision ?? 59 })
  captures.set(token, data)
  return token
}

async function unchanged(data) {
  for (const [path, captured] of data.files) {
    await noLinks(path)
    if (sha(await readFile(path)) !== captured.sha256 || sha(captured.bytes) !== captured.sha256) fail('source_changed_integrity_failure')
  }
}
export async function verifyFixtureSources(capture) {
  const data = captures.get(capture)
  if (!data) fail('invalid_capture_token')
  await unchanged(data)
  return true
}

const STUDIO_KINDS = { annotation: 'annotation', review_round: 'reviewRound', review_submission: 'reviewSubmission', review_run: 'reviewRun', review_task: 'reviewTask', proposal: 'proposal', revision: 'revision', command: 'command', change_set: 'changeSet' }
function newIdentity(value) {
  for (const kind of Object.keys(ID_PREFIXES)) if (isStableId(kind, value)) return createStableId(kind)
  for (const [prefix, kind] of Object.entries(STUDIO_KINDS)) if (value.startsWith(`${prefix}_`)) return createStudioId(kind)
  if (value.startsWith('layout_page_')) return createLayoutId('layoutPage')
  if (value.startsWith('layout_element_')) return createLayoutId('layoutElement')
  return `fixture-${randomUUID()}`
}
const REF_FIELDS = /^(?:id|.*Id|.*Ids|scopeKey|sourceKey|idempotencyKey|writableIds)$/u
const STATIC_IDS = new Set(['workflowId', 'workflowIds', 'chapterId', 'chapterIds', 'workItemId', 'targetObjectId', 'objectId', 'objectIds', 'actorId', 'gateId', 'gateIds', 'sectionIds', 'provider', 'model'])
const PRE_PROPOSAL_REQUIRED_FIELDS = ['proposal_id', 'project_id', 'workflow_id', 'target_object_id', 'target_schema_id', 'expected_revision', 'actor', 'created_at', 'change_set', 'evidence_refs', 'assumptions', 'validation_intent']
const PRE_CHANGE_SET_REQUIRED_FIELDS = ['operation', 'payload', 'semantic_paths']
function prepareSeeds(data, workspace) {
  const mapping = new Map()
  const add = (id, value = newIdentity(id)) => { if (typeof id !== 'string' || !id) fail('incomplete_identity_definition'); if (!mapping.has(id)) mapping.set(id, value); return mapping.get(id) }
  const identities = { preProjectId: `preplan-${randomUUID()}`, studioProjectId: createStableId('project'), sessionId: `session-${randomUUID()}` }
  add(data.input.preProjectId, identities.preProjectId); add(data.snapshot.project.id, identities.studioProjectId)
  const project = data.snapshot.project
  add(project.projectRulesId); add(project.outlineDocumentId)
  function definitions(value) {
    if (Array.isArray(value)) { value.forEach(definitions); return }
    if (!object(value)) return
    for (const field of ['id', 'outlineNodeId', 'draftDocumentId', 'contentBlockId', 'listItemId', 'metricId', 'tableRowId', 'tableColumnId', 'tableCellId', 'scriptBlockId', 'pageAssetId', 'assetId', 'sourceMaterialId', 'layoutPageId', 'layoutElementId']) {
      if (typeof value[field] === 'string' && (field === 'id' || Object.keys(value).some(key => !REF_FIELDS.test(key) && !['kind', 'sourceRefs'].includes(key)))) add(value[field])
    }
    for (const [key, child] of Object.entries(value)) if (!['sourceRefs', 'sourceRef', 'target', 'fieldRefs', 'stableIds', 'provenance'].includes(key)) definitions(child)
  }
  definitions(data.snapshot); definitions(data.layout)
  for (const key of ['annotations', 'reviewRounds', 'reviewSubmissions', 'reviewRuns']) {
    for (const row of data.operational[key] ?? []) { add(row.id); if (row.taskId) add(row.taskId) }
  }
  for (const proposal of data.operational.proposals ?? []) {
    add(proposal.id)
    if (proposal.idempotencyKey) add(proposal.idempotencyKey)
    for (const command of proposal.commands ?? []) add(command.commandId)
  }
  for (const domain of Object.values(data.pre)) for (const [table, rows] of Object.entries(domain.tables)) {
    for (const [key, row] of Object.entries(rows)) {
      if (table === 'bindings' && row.sessionId) { add(row.sessionId, identities.sessionId); continue }
      if (table === 'fingerprints') continue
      if (table === 'revisions') { add(key, `${identities.preProjectId}:${row.revision}`); add(row.revisionId, `${identities.preProjectId}:${row.revision}`); continue }
      if (table === 'state_objects') { add(key, `${identities.preProjectId}:${row.objectId}`); continue }
      if (key !== data.input.preProjectId) add(key)
      if (table === 'proposals' && row.idempotencyKey) add(row.idempotencyKey)
      for (const field of ['revisionId', 'eventId', 'proposalId', 'questionId', 'runId', 'decisionId', 'policyId', 'authorizationId', 'taskId', 'assetId', 'boundaryId', 'packageId']) if (row[field]) add(row[field])
    }
  }
  const preSource = clone(data.pre)
  const preBusinessFacts = new WeakMap()
  const preProposalEnvelopes = new WeakMap()
  const preAgent = preSource.preplanning_agent.tables
  for (const row of Object.values(preAgent.state_objects)) if (object(row.value)) preBusinessFacts.set(row.value, row.objectId)
  for (const row of Object.values(preAgent.revisions)) {
    for (const [objectId, value] of Object.entries(row.stateSnapshot ?? {})) if (object(value)) preBusinessFacts.set(value, objectId)
  }
  for (const row of Object.values(preAgent.proposals)) if (object(row.envelope)) preProposalEnvelopes.set(row.envelope, row)
  for (const row of data.operational.reviewRuns ?? []) for (const field of ['sessionId', 'parentSessionId']) if (row[field]) add(row[field], identities.sessionId)
  function mappedIdentity(value, field) {
    if (mapping.has(value)) return mapping.get(value)
    if (value === 'outline:root') return value
    if (value.startsWith('draft:')) return `draft:${mappedIdentity(value.slice(6), 'pageId')}`
    if (value.startsWith('review:')) return `review:${mappedIdentity(value.slice(7), 'reviewSubmissionId')}`
    if (['evidenceIds', 'objectIds'].includes(field) && !/^(?:asset|source_material)_/u.test(value)) return value
    fail('incomplete_identity_reference', field)
  }
  function remapPreBusinessFact(value, field = '', trail = '', ownerObjectId = null, factPath = [], rootObjectId = null) {
    if (typeof value === 'string') {
      if (field === 'project_id') {
        if (value !== data.input.preProjectId) fail('pre_fact_project_identity_mismatch', trail)
        return identities.preProjectId
      }
      if (ownerObjectId === 'IM07' && rootObjectId === 'IM07' && factPath.length === 2 && factPath[0] === 'data' && factPath[1] === 'critical_path') return value
      if (['relativePath', 'draftPath', 'fileName', 'derivedFileName'].includes(field)) { safeRelative(value); return value }
      if (/path|root|directory|session|token|credential|secret/i.test(field)) fail('unsupported_live_external_field', trail)
      return value
    }
    if (Array.isArray(value)) return value.map((item, index) => remapPreBusinessFact(item, field, `${trail}[${index}]`, ownerObjectId, [...factPath, index], rootObjectId))
    if (!object(value)) return value
    const next = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'workspaceRoot' || key === 'directoryRoot') fail('unsupported_live_external_field', `${trail}.${key}`)
      next[key] = remapPreBusinessFact(child, key, `${trail}.${key}`, ownerObjectId, [...factPath, key], rootObjectId)
    }
    return next
  }
  function remapPreProposalEnvelope(value, row, trail) {
    for (const field of PRE_PROPOSAL_REQUIRED_FIELDS) if (!Object.hasOwn(value, field)) fail('pre_proposal_required_header', `${trail}.${field}`)
    if (!object(value.actor) || !object(value.change_set) || !Array.isArray(value.evidence_refs) || !Array.isArray(value.assumptions)) fail('pre_proposal_required_header', trail)
    for (const field of PRE_CHANGE_SET_REQUIRED_FIELDS) if (!Object.hasOwn(value.change_set, field)) fail('pre_proposal_required_header', `${trail}.change_set.${field}`)
    if (!object(value.change_set.payload) || !Array.isArray(value.change_set.semantic_paths) || value.change_set.semantic_paths.length === 0 || value.change_set.semantic_paths.some(path => typeof path !== 'string')) fail('pre_proposal_required_header', `${trail}.change_set`)
    const next = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'proposal_id' || key === 'project_id' || key === 'idempotency_key') {
        const expected = key === 'proposal_id' ? row.proposalId : key === 'project_id' ? row.projectId : row.idempotencyKey
        if (typeof child !== 'string' || child !== expected) fail('pre_proposal_identity_mismatch', `${trail}.${key}`)
        next[key] = key === 'project_id' ? mappedIdentity(child, 'projectId') : mappedIdentity(child, key === 'proposal_id' ? 'proposalId' : 'idempotencyKey')
        continue
      }
      if (key === 'change_set' && object(child)) {
        next[key] = Object.fromEntries(Object.entries(child).map(([changeKey, changeValue]) => {
          if (changeKey === 'payload') return [changeKey, remapPreBusinessFact(changeValue, changeKey, `${trail}.${key}.${changeKey}`, value.target_object_id, [], object(changeValue) ? changeValue.object_id : null)]
          if (changeKey === 'semantic_paths') return [changeKey, clone(changeValue)]
          return [changeKey, remap(changeValue, changeKey, `${trail}.${key}.${changeKey}`)]
        }))
        continue
      }
      next[key] = remap(child, key, `${trail}.${key}`)
    }
    return next
  }
  function remap(value, field = '', trail = '') {
    if (typeof value === 'string') {
      if (field === 'objectId' && /^\.proposals\[\d+\]\.diff(?:\.|\[)/u.test(trail)) return mappedIdentity(value, field)
      if (STATIC_IDS.has(field)) return value
      if (REF_FIELDS.test(field)) return mappedIdentity(value, field)
      if (['relativePath', 'draftPath', 'fileName', 'derivedFileName'].includes(field)) {
        safeRelative(value)
        return value.split('/').map(part => {
          if (mapping.has(part)) return mapping.get(part)
          const suffix = /^(.*)(\.[^.]+)$/u.exec(part)
          return suffix && mapping.has(suffix[1]) ? `${mapping.get(suffix[1])}${suffix[2]}` : part
        }).join('/')
      }
      if (/path|root|directory|session|token|credential|secret/i.test(field)) fail('unsupported_live_external_field', trail)
      return value // Text/prose is never substring-rewritten.
    }
    if (Array.isArray(value)) return value.map((item, index) => remap(item, field, `${trail}[${index}]`))
    if (!object(value)) return value
    if (preBusinessFacts.has(value)) return remapPreBusinessFact(value, field, trail, preBusinessFacts.get(value), [], value.object_id ?? null)
    if (preProposalEnvelopes.has(value)) return remapPreProposalEnvelope(value, preProposalEnvelopes.get(value), trail)
    const next = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'provenance' || key === 'sourceOrigin') { next[key] = clone(child); continue }
      if (key === 'workerSessionRef' || key === 'leaseExpiresAt') { next[key] = null; continue }
      if (key === 'workspaceRoot' || key === 'directoryRoot') {
        if (trail !== `.preplanning_presentation.tables.bindings.${data.input.preProjectId}`) fail('unsupported_live_external_field', `${trail}.${key}`)
        next[key] = workspace; continue
      }
      if (key === 'stableIds') { next[key] = Object.fromEntries(Object.entries(child).map(([semantic, id]) => [semantic, mappedIdentity(id, 'stableIds')])); continue }
      if (key === 'lastExportedFileHashes') { next[key] = {}; continue }
      const mappedKey = mapping.get(key) ?? key
      next[mappedKey] = remap(child, key, `${trail}.${key}`)
    }
    return next
  }
  // Historical identities are deliberately absent while active content,
  // layout and Pre state are remapped, so history can never authorize or
  // conceal a dangling reference in the current canonical snapshot.
  const snapshot = remap(data.snapshot)
  assertCanonicalSnapshot(snapshot)
  function resetStudioRevision(value) {
    if (Array.isArray(value)) { value.forEach(resetStudioRevision); return }
    if (!object(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (['baseRevision', 'acceptedRevision', 'createdAgainstRevision', 'baseDraftRevision', 'lastSyncedDraftRevision', 'lastSyncedSourceRevision'].includes(key) && child !== null) value[key] = 0
      else resetStudioRevision(child)
    }
  }
  const pre = remap(preSource)
  const layout = data.layout ? remap(data.layout) : null
  for (const history of data.historicalSnapshots) for (const id of history.historicalOnlyTargetIds) add(id)
  const sourceOperational = clone({ ...data.operational, revisions: [] })
  for (const proposal of sourceOperational.proposals ?? []) proposal.candidateSnapshot = clone(data.snapshot)
  const operational = remap(sourceOperational)
  operational.revisions = []
  resetStudioRevision(operational)
  for (const [index, source] of (data.operational.proposals ?? []).entries()) {
    operational.proposals[index].candidateSnapshot = clone(snapshot)
    operational.proposals[index].fixtureProvenance = { readOnly: true, sourceBaseRevision: source.baseRevision, sourceAcceptedRevision: source.acceptedRevision }
  }
  for (const submission of operational.reviewSubmissions ?? []) {
    if (['pending_dispatch', 'dispatched'].includes(submission.status)) fail('unsupported_active_studio_review', 'reviewSubmissions.status')
    for (const snapshots of [submission.annotationSnapshots, submission.annotations]) for (const row of snapshots ?? []) row.contentHash = sha(`${row.annotationId}:${row.version ?? row.annotationVersion}:${row.instruction}`)
  }
  for (const [index, run] of (data.operational.reviewRuns ?? []).entries()) {
    const isolated = operational.reviewRuns[index]
    if (run.phase === 'queued' && run.integrationState === 'dispatch_failed') {
      const expiresAt = run.leaseExpiresAt == null ? null : parseUtcMillisecondTimestamp(run.leaseExpiresAt)
      if (run.workerSessionRef !== null || (run.leaseExpiresAt != null && (!Number.isFinite(expiresAt) || expiresAt > parseUtcMillisecondTimestamp(data.leaseComparedAt)))) fail('unsupported_active_studio_review', 'reviewRuns.liveAuthority')
      isolated.phase = 'failed'
      isolated.fixtureProvenance = { readOnly: true, sourcePhase: run.phase, sourceIntegrationState: run.integrationState, sourceLeaseExpiresAt: run.leaseExpiresAt ?? null, leaseComparedAt: data.leaseComparedAt }
      continue
    }
    if (['queued', 'running'].includes(run.phase) || ['pending_dispatch', 'dispatched'].includes(run.integrationState)) fail('unsupported_active_studio_review', 'reviewRuns.phase')
    if (run.workerSessionRef != null || run.leaseExpiresAt != null) {
      isolated.fixtureProvenance = { readOnly: true, sourceWorkerSessionRef: run.workerSessionRef ?? null, sourceLeaseExpiresAt: run.leaseExpiresAt ?? null, ...(run.leaseExpiresAt == null ? {} : { leaseComparedAt: data.leaseComparedAt }) }
    }
  }
  const a = pre.preplanning_agent.tables
  a.projects = { [identities.preProjectId]: Object.values(a.projects)[0] }
  a.revisions = Object.fromEntries(Object.values(a.revisions).map(row => { row.revisionId = `${identities.preProjectId}:${row.revision}`; return [row.revisionId, row] }))
  a.state_objects = Object.fromEntries(Object.values(a.state_objects).map(row => [`${identities.preProjectId}:${row.objectId}`, row]))
  a.bindings = { [identities.sessionId]: { sessionId: identities.sessionId, projectId: identities.preProjectId, boundAt: new Date().toISOString() } }
  for (const authorization of Object.values(pre.preplanning_governance.tables.authorizations)) { authorization.status = 'revoked'; authorization.revocationReason = 'Isolated frozen fixture; no automation authorization'; authorization.revokedAt = new Date().toISOString() }
  resetStudioRevision(layout)
  return { snapshot, operational, pre, layout, mapping: Object.fromEntries(mapping), identities }
}

/** Materialize a new test-only root. Seed JSON is NOT installed into a DSH home.
 * Later explicit host installation should use createRepository only for a new
 * repository, initializeFromStandardProject({snapshot}) and transactOperational;
 * keep its real Revision 0 record, and load captured blobs via putBlob.
 */
export async function buildIsolatedFixture({ capture, targetRoot, containmentRoot }) {
  const data = captures.get(capture)
  if (!data) fail('invalid_capture_token')
  const target = await validateTarget(targetRoot, containmentRoot, data.sourceRoots)
  await unchanged(data)
  // Adapter chooses <new project id>-<slug>; choose identities once, then bind it.
  const seeds = prepareSeeds(data, '__fixture_workspace__')
  const slug = seeds.snapshot.project.extensionPayload.standardArchive.documents['project.json'].projectSlug
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) fail('unsafe_project_slug')
  const workspace = join(target, 'standard', `${seeds.identities.studioProjectId}-${slug}`)
  const binding = Object.values(seeds.pre.preplanning_presentation.tables.bindings)[0]
  binding.workspaceRoot = workspace; binding.directoryRoot = workspace
  // All validation above precedes creation. The root is exclusively created;
  // failure leaves only this clearly marked partial root for caller inspection.
  await mkdir(target)
  const write = async (path, value) => {
    if (!within(target, path)) fail('output_outside_target')
    await noLinks(path)
    await mkdir(dirname(path), { recursive: true })
    await noLinks(dirname(path))
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  }
  await write(join(target, 'BUILDING.json'), { kind: 'isolated-fixture-partial', hostInstallAuthorized: false })
  const openBlob = ref => {
    const blob = data.blobs.get(ref.sha256)
    if (!blob || blob.sizeBytes !== ref.sizeBytes) fail('asset_bytes_integrity_mismatch')
    return Readable.from([blob.bytes])
  }
  await noLinks(join(target, 'standard'))
  // The product adapter re-sniffs unknown binary streams as octet-stream. Keep
  // these narrowly validated source materials outside that MIME rewrite, then
  // restore exact bytes/manifest records and validate the whole standard project.
  const archive = seeds.snapshot.project.extensionPayload.standardArchive
  const opaqueMaterials = archive.documents['source-materials/manifest.json'].materials.filter(record => OPAQUE_SOURCE_MIMES.has(record.mimeType))
  const opaquePaths = new Set(opaqueMaterials.map(record => record.relativePath))
  const exportSnapshot = clone(seeds.snapshot)
  if (opaqueMaterials.length) {
    const exportArchive = exportSnapshot.project.extensionPayload.standardArchive
    exportArchive.documents['source-materials/manifest.json'].materials = exportArchive.documents['source-materials/manifest.json'].materials.filter(record => !opaquePaths.has(record.relativePath))
    exportArchive.files = exportArchive.files.filter(file => !opaquePaths.has(file.relativePath))
  }
  const exported = await writeStandardProject({ snapshot: exportSnapshot, exportRoot: join(target, 'standard'), openBlob })
  if (!equal(exported.projectRoot, workspace)) fail('export_workspace_identity_mismatch')
  if (opaqueMaterials.length) {
    for (const record of opaqueMaterials) {
      const path = join(workspace, safeRelative(record.relativePath)); const blob = data.blobs.get(record.sha256)
      if (!blob || sha(blob.bytes) !== record.sha256 || blob.sizeBytes !== record.sizeBytes) fail('asset_hash_integrity_mismatch')
      opaqueSourceMime(blob.bytes, path, record)
      await noLinks(path); await mkdir(dirname(path), { recursive: true }); await noLinks(dirname(path))
      await writeFile(path, blob.bytes, { flag: 'wx', mode: 0o600 })
    }
    const manifestPath = join(workspace, 'source-materials/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const normalRecords = new Map(manifest.materials.map(record => [record.sourceMaterialId, record]))
    manifest.materials = archive.documents['source-materials/manifest.json'].materials.map(record => opaquePaths.has(record.relativePath) ? clone(record) : normalRecords.get(record.sourceMaterialId))
    await noLinks(manifestPath)
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w', mode: 0o600 })
    const validation = await validateProjectDirectoryWithAjv(workspace, { allowGitKeep: true })
    if (!validation.valid) fail('opaque_source_standard_contract_invalid')
  }
  const outputBlobs = {}
  for (const manifest of ['source-materials/manifest.json', 'assets/manifest.json']) {
    const document = JSON.parse(await readFile(join(workspace, manifest), 'utf8'))
    for (const record of document.materials ?? document.assets ?? []) {
      const path = join(workspace, safeRelative(record.relativePath))
      await noLinks(path)
      const bytes = await readFile(path)
      if (sha(bytes) !== record.sha256 || (record.sizeBytes !== undefined && bytes.length !== record.sizeBytes)) fail('output_asset_integrity_mismatch')
      outputBlobs[record.sha256] = path
    }
  }
  const preStorages = {}
  for (const [name, domain] of Object.entries(seeds.pre)) { preStorages[name] = join(target, 'seed', 'storages', `${name}.json`); await write(preStorages[name], domain) }
  for (const asset of Object.values(seeds.pre.preplanning_governance.tables.visual_assets)) {
    const path = join(target, 'visual-assets', safeRelative(asset.fileName))
    await noLinks(path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, data.blobs.get(asset.sha256).bytes, { flag: 'wx', mode: 0o600 })
    if (sha(await readFile(path)) !== asset.sha256) fail('output_pre_asset_integrity_mismatch')
    outputBlobs[asset.sha256] = path
  }
  const studioSeed = join(target, 'seed', 'studio-current.json')
  await write(studioSeed, { snapshot: seeds.snapshot, operational: seeds.operational, revision: 0 })
  const manualLayoutSeed = seeds.layout ? join(target, 'seed', 'manual-layout.json') : null
  if (manualLayoutSeed) await write(manualLayoutSeed, seeds.layout)
  // Input hashes are rechecked after materialization, including original drafts.
  await unchanged(data)
  const provenance = { readOnly: true, sourceStudioProjectId: data.snapshot.project.id, sourcePreProjectId: data.input.preProjectId, sourceStudioRevision: capture.sourceStudioRevision, sourcePreRevision: capture.sourcePreRevision, sourceWorkspace: data.input.standardWorkspace, sourceControlSha256: data.files.get(resolve(data.input.controlPath)).sha256, historicalSnapshots: data.historicalSnapshots.map(history => ({ readOnly: true, revisionNumber: history.revisionNumber, revisionSha256: history.revisionSha256, canonicalSha256: history.canonicalSha256, mappedHistoricalOnlyTargetIds: history.historicalOnlyTargetIds })), historicalContentImported: false, historicalDesignScopeGranted: false, builtAt: new Date().toISOString(), builderVersion: 2 }
  const integrity = { sourcesUnchanged: true, outputAssetsVerified: true, sourceFileCount: data.files.size, sourceHashes: [...data.files].map(([path, row]) => ({ path, sha256: row.sha256 })), canonicalSourceSha256: semanticHash(data.snapshot), canonicalFixtureSha256: semanticHash(seeds.snapshot), scriptSourceSha256: semanticHash(data.snapshot.pages.map(page => page.scriptBlocks)), sourceRefsSourceSha256: semanticHash(data.snapshot.pages.map(page => page.contentBlocks.map(block => block.sourceRefs))), assets: [...data.blobs.values()].map(({ sha256, sizeBytes, mimeType }) => ({ sha256, sizeBytes, mimeType })), manualGeometryPreserved: seeds.layout ? semanticHash(seeds.layout.elements.map(row => ({ frame: row.frame, style: row.style }))) === semanticHash(data.layout.elements.map(row => ({ frame: row.frame, style: row.style }))) : null }
  const result = { identities: seeds.identities, paths: { workspace, studioSeed, preStorages, manualLayoutSeed, blobs: outputBlobs, visualAssetRoot: join(target, 'visual-assets') }, mapping: seeds.mapping, provenance, integrity, hostInstalled: false }
  await write(join(target, 'fixture-report.json'), result)
  return result
}
