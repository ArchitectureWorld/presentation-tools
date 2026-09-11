import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { realpath, mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, dirname, resolve, basename } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { createStableId } from '../contracts/presentation-standard-project/src/ids.mjs'
import { createMinimalProjectDocuments } from '../contracts/presentation-standard-project/src/factory.mjs'
import { canonicalFromState, createStudioId, CONTROL_SCHEMA_VERSION, projectStateFromParts } from '../packages/studio-contracts/index.mjs'
import { acceptProposal, beginReviewDispatch, createProposalFromAgent, executeAction, markSubmissionDispatch, submitReviewRound } from '../packages/studio-core/index.mjs'
import { writeStandardProject } from '../packages/studio-standard-adapter/index.mjs'
import { LAYOUT_SCHEMA_VERSION } from '../packages/studio-layout-contracts/index.mjs'
import { createRepository } from '../apps/studio-local/repository.mjs'

const api = await import('./dsh-design-fixture.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('dsh-design-fixture.mjs')) return {}
  throw error
})
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const at = '2026-09-06T00:00:00.000Z'
const actor = { actorId: 'synthetic-human', name: 'Synthetic', role: 'decision_owner' }
const json = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)) }
const names = ['preplanning_agent', 'preplanning_governance', 'preplanning_presentation', 'preplanning_synthetic_boundary_fingerprints']

// Only synthetic records and bytes; no access to a real DSH home or project.
async function sourceFixture(t) {
  // The runner may expose an 8.3 alias (RUNNER~1). Canonicalize only OUR fixture parent.
  const fixtureParent = await realpath(tmpdir())
  const root = await mkdtemp(join(fixtureParent, 'dsh-fixture-test-'))
  t.after(async () => { assert.equal(dirname(root), fixtureParent); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const source = join(root, 'source'); await mkdir(source)
  const ids = Object.fromEntries(['project', 'projectRules', 'outlineDocument', 'outlineNode', 'page', 'draftDocument', 'contentBlock', 'scriptBlock', 'pageAsset', 'asset', 'sourceMaterial'].map(kind => [kind, createStableId(kind)]))
  const oldPre = 'preplan-synthetic-original'; const oldSession = 'session-synthetic-original'
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>')
  const material = Buffer.from('Synthetic source material. Do not rewrite preplan-synthetic-original in prose.\n')
  const objectRef = { sha256: hash(bytes), sizeBytes: bytes.length, mimeType: 'image/svg+xml' }
  const sourceRefs = [{ provider: 'pre-design', sourceProjectId: oldPre, sourceRevision: 59, objectIds: ['project_identity'], evidenceIds: [ids.sourceMaterial] }]
  const documents = createMinimalProjectDocuments({ projectId: ids.project, projectSlug: 'synthetic', name: 'Synthetic title', createdAt: at, ids: { projectRulesId: ids.projectRules, outlineDocumentId: ids.outlineDocument } })
  documents['source-materials/manifest.json'].materials.push({ sourceMaterialId: ids.sourceMaterial, originalFileName: 'source.txt', category: 'document', relativePath: 'source-materials/documents/source.txt', mimeType: 'text/plain', sha256: hash(material), sizeBytes: material.length, importedAt: at, status: 'available' })
  const snapshot = {
    project: { id: ids.project, projectId: ids.project, projectRulesId: ids.projectRules, outlineDocumentId: ids.outlineDocument, title: 'Synthetic title', createdAt: at, extensionPayload: { standardArchive: { documents, files: [{ relativePath: 'source-materials/documents/source.txt', objectRef: { sha256: hash(material), sizeBytes: material.length, mimeType: 'text/plain' } }] } } },
    outline: [{ id: ids.outlineNode, outlineNodeId: ids.outlineNode, parentOutlineNodeId: null, order: 0, title: 'Synthetic section', sourceRefs, opaqueExtension: null, children: [] }],
    pages: [{ id: ids.page, pageId: ids.page, outlineNodeId: ids.outlineNode, draftDocumentId: ids.draftDocument, titleBlockId: ids.contentBlock, order: 0,
      contentBlocks: [{ contentBlockId: ids.contentBlock, order: 0, type: 'heading', role: 'page_title', content: 'Keep preplan-synthetic-original in prose', sourceRefs }],
      scriptBlocks: [{ scriptBlockId: ids.scriptBlock, order: 0, content: 'Verbatim script\nSecond line', estimatedDurationSeconds: 8, referencedContentBlockIds: [ids.contentBlock], referencedAssetIds: [ids.asset], sourceRefs }],
      pageAssets: [{ id: ids.asset, assetId: ids.asset, pageAssetId: ids.pageAsset, role: 'primary', caption: 'Original caption', order: 0, sourceRefs, mimeType: 'image/svg+xml', name: 'test.svg', objectRef, widthPx: 4, heightPx: 4 }] }],
  }
  const { projectRoot: standardWorkspace } = await writeStandardProject({ snapshot, exportRoot: join(source, 'standard'), openBlob: ref => Readable.from([ref.sha256 === objectRef.sha256 ? bytes : material]) }).catch(error => { throw new Error(JSON.stringify(error.details)) })
  const annotation = createStudioId('annotation'); const round = createStudioId('reviewRound'); const submission = createStudioId('reviewSubmission'); const run = createStudioId('reviewRun')
  const operational = { project: { updatedAt: at }, annotations: [{ id: annotation, scopeKey: `draft:${ids.page}`, reviewRoundId: round, target: { type: 'content-block', id: ids.contentBlock, label: 'Title' }, instruction: 'Preserve this review', lifecycle: 'submitted', resolution: 'open', version: 1, createdAgainstRevision: 111, createdAt: at, updatedAt: at }],
    reviewRounds: [{ id: round, projectId: ids.project, scopeKey: `draft:${ids.page}`, stage: 'draft', pageId: ids.page, status: 'open', createdAt: at, updatedAt: at }],
    reviewSubmissions: [{ id: submission, reviewSubmissionId: submission, reviewRoundId: round, projectId: ids.project, scopeKey: `draft:${ids.page}`, pageId: ids.page, baseRevision: 111, status: 'dispatch_failed', activeReviewRunId: run, writableIds: [ids.contentBlock], idempotencyKey: `review:${submission}`, annotationSnapshots: [{ annotationId: annotation, id: annotation, version: 1, instruction: 'Preserve this review', contentHash: hash(`${annotation}:1:Preserve this review`) }] }],
    reviewRuns: [{ id: run, reviewRunId: run, reviewSubmissionId: submission, sessionId: oldSession, parentSessionId: oldSession, workerSessionRef: 'source-worker', integrationState: 'dispatch_failed', phase: 'blocked', taskId: createStudioId('reviewTask'), leaseExpiresAt: at }], proposals: [], revisions: [{ id: createStudioId('revision'), number: 111 }] }
  const canonicalPath = join(source, 'canonical.json'); await json(canonicalPath, { kind: 'CanonicalSnapshot', value: snapshot })
  const canonicalBytes = await readFile(canonicalPath)
  const revisionPath = join(source, 'revision.json'); await json(revisionPath, { kind: 'RevisionRecord', revisionId: operational.revisions[0].id, revisionNumber: 111, snapshotRef: { sha256: hash(canonicalBytes) } })
  const controlPath = join(source, 'control.json'); await json(controlPath, { schemaVersion: CONTROL_SCHEMA_VERSION, projectHead: { projectId: ids.project, currentRevision: 111, currentRevisionRef: { sha256: hash(await readFile(revisionPath)) } }, operational })
  const pre = Object.fromEntries(names.map(name => [name, { unit: { name, version: 1 }, global: {}, tables: {} }]))
  const agent = pre.preplanning_agent.tables
  agent.projects = { [oldPre]: { projectId: oldPre, name: 'Synthetic title', currentRevision: 59, currentStage: '04-01', createdAt: at, updatedAt: at }, foreign: { projectId: 'foreign', name: 'Foreign project private content', currentRevision: 1 } }
  agent.bindings = { [oldSession]: { projectId: oldPre, sessionId: oldSession, boundAt: at }, foreignSession: { projectId: 'foreign', sessionId: 'foreignSession' } }
  agent.revisions = { [`${oldPre}:59`]: { revisionId: `${oldPre}:59`, projectId: oldPre, revision: 59, parentRevision: 58, committedAt: at, committedBy: actor, stateSnapshot: { project_identity: { statement: 'Keep preplan-synthetic-original in prose' } } } }
  agent.state_objects = { [`${oldPre}:project_identity`]: { projectId: oldPre, objectId: 'project_identity', revision: 59, value: agent.revisions[`${oldPre}:59`].stateSnapshot.project_identity, updatedAt: at } }
  agent.events = {}; agent.questions = {}; agent.idempotency = {}; agent.proposals = { pending: { proposalId: 'pending', projectId: oldPre, status: 'pending_review' } }
  const gov = pre.preplanning_governance.tables
  gov.project_policies = { [oldPre]: { projectId: oldPre, mode: 'automatic', reportDepth: 'standard', automationAuthorizationId: 'auth-old', updatedAt: at } }
  gov.authorizations = { 'auth-old': { authorizationId: 'auth-old', projectId: oldPre, grantedBy: actor, startingRevision: 0, scope: { chapterIds: [], workflowIds: [], gateIds: [], maxVisualGenerations: 0, maxModelTurns: 1, stopOnBlocking: true }, status: 'active', grantedAt: at } }
  gov.workflow_runs = Object.fromEntries(Array.from({ length: 57 }, (_, i) => [`${oldPre}:wf-${i}`, { runId: `${oldPre}:wf-${i}`, projectId: oldPre, workflowId: `workflow-${i}`, chapterId: '01', workItemId: `item-${i}`, targetObjectId: 'project_identity', status: 'confirmed', attempt: 1, confirmedRevision: 59, updatedAt: at }]))
  gov.workflow_runs.queued = { runId: 'queued', projectId: oldPre, status: 'ready' }
  gov.gate_decisions = {}; gov.visual_policies = {}; gov.visual_tasks = { queued: { taskId: 'queued', projectId: oldPre, status: 'queued' } }; gov.visual_assets = {}; gov.site_boundaries = {}; gov.report_packages = {}
  pre.preplanning_presentation.tables.bindings = { [oldPre]: { preDesignProjectId: oldPre, presentationProjectId: ids.project, projectSlug: 'synthetic', workspaceRoot: standardWorkspace, directoryRoot: standardWorkspace, standardVersion: '0.1.0', state: 'ready', stableIds: { 'project:root': ids.project, 'page:page-one': ids.page }, lastExportedPreDesignRevision: 59, lastExportedObjectHashes: {}, lastExportedFileHashes: {}, createdAt: at, updatedAt: at } }
  pre.preplanning_synthetic_boundary_fingerprints.tables.fingerprints = { [`image:${'a'.repeat(64)}`]: { fingerprint: `image:${'a'.repeat(64)}`, boundaryId: 'foreign-boundary', createdAt: at } }
  const preStoragePaths = {}; for (const name of names) { preStoragePaths[name] = join(source, `${name}.json`); await json(preStoragePaths[name], pre[name]) }
  const blobPath = join(source, 'test.svg'); await writeFile(blobPath, bytes)
  const layoutPath = join(source, 'manual-layout.json')
  const layout = { schemaVersion: LAYOUT_SCHEMA_VERSION, layoutPageId: 'layout_page_original', projectId: ids.project, pageId: ids.page, canvas: { width: 1600, height: 900, unit: 'studio_unit' }, baseDraftRevision: 111, lastSyncedDraftRevision: 111, syncState: 'synced', elements: [{ layoutElementId: 'layout_element_original', type: 'text', frame: { x: 31, y: 47, width: 412, height: 99, rotation: 0 }, style: { fontSize: 29 }, zIndex: 0, syncPolicy: 'live', elementState: 'normal', sourceRef: { kind: 'content-block', contentBlockId: ids.contentBlock }, lastSyncedSourceRevision: 111 }] }
  await json(layoutPath, layout)
  const input = { sourceSnapshotRoot: source, controlPath, canonicalPath, revisionPath, preStoragePaths, preProjectId: oldPre, standardWorkspace, referencedBlobs: [{ path: blobPath, ...objectRef }], manualLayoutPath: layoutPath, expectedStudioRevision: 111, expectedPreRevision: 59, expectedCompletedWorkItems: 57 }
  return { root, source, input, pre, ids, snapshot, operational, bytes, material, layout, oldPre, oldSession }
}

async function addPreBusinessDecisionFact(f, decisionId = 'ex-dec-01', includeEnvelopeIdempotency = true) {
  const a = f.pre.preplanning_agent.tables
  const decision = { id: decisionId, name: '暂不决定实施模式', description: '保留原始业务决定标识与说明。' }
  const value = {
    object_id: 'PS02', project_id: f.oldPre,
    data: { decision_question: '本轮只确认策划边界。', excluded_decisions: [decision] },
  }
  const revision = a.revisions[`${f.oldPre}:59`]
  revision.stateSnapshot.PS02 = structuredClone(value)
  a.state_objects[`${f.oldPre}:PS02`] = { projectId: f.oldPre, objectId: 'PS02', revision: 59, value: structuredClone(value), updatedAt: at }
  const proposalId = 'proposal-pre-business-01'
  const idempotencyKey = 'request-pre-business-01'
  const envelope = {
    proposal_id: proposalId, project_id: f.oldPre, workflow_id: 'preplan.wf.01.02',
    target_object_id: 'PS02', target_schema_id: 'urn:preplan:v0.6:state:PS02', expected_revision: 58,
    actor: { actor_id: 'synthetic-pre-agent', name: 'Synthetic Pre Agent', role: 'agent', authority_scope: ['propose'] },
    created_at: at, change_set: { operation: 'create', payload: structuredClone(value), semantic_paths: ['/PS02'] },
    evidence_refs: [], assumptions: [], validation_intent: 'human_review', requested_state: 'pending_review',
  }
  if (includeEnvelopeIdempotency) envelope.idempotency_key = idempotencyKey
  a.proposals[proposalId] = {
    proposalId, projectId: f.oldPre, expectedRevision: 58, idempotencyKey, envelope,
    status: 'confirmed', createdAt: at, committedAt: at, committedBy: actor, confirmedAt: at, confirmedBy: actor, committedRevision: 59,
  }
  await json(f.input.preStoragePaths.preplanning_agent, f.pre.preplanning_agent)
  return { decision, proposalId, idempotencyKey }
}

async function replacePreBusinessFact(f, objectId, value) {
  const a = f.pre.preplanning_agent.tables
  a.revisions[`${f.oldPre}:59`].stateSnapshot[objectId] = structuredClone(value)
  a.state_objects[`${f.oldPre}:${objectId}`] = { projectId: f.oldPre, objectId, revision: 59, value: structuredClone(value), updatedAt: at }
  const proposal = Object.values(a.proposals).find(row => row.status === 'confirmed')
  proposal.envelope.target_object_id = objectId
  proposal.envelope.target_schema_id = `urn:preplan:v0.6:state:${objectId}`
  proposal.envelope.change_set.payload = structuredClone(value)
  await json(f.input.preStoragePaths.preplanning_agent, f.pre.preplanning_agent)
}

async function capture(f) { assert.equal(typeof api.captureFixtureSources, 'function', 'read-only capture API must exist'); return api.captureFixtureSources(f.input) }
async function build(f, captured, targetRoot = join(f.root, 'output')) { assert.equal(typeof api.buildIsolatedFixture, 'function', 'contained builder API must exist'); return api.buildIsolatedFixture({ capture: captured, targetRoot, containmentRoot: f.root }) }

test('refuses source==target and both source/target ancestry directions before any writes', async t => {
  const f = await sourceFixture(t); const c = await capture(f)
  for (const target of [f.source, join(f.source, 'nested'), f.root]) await assert.rejects(build(f, c, target), /target|source|contain/i)
})
test('refuses pre-existing empty/nonempty, broad and outside targets', async t => {
  const f = await sourceFixture(t); const c = await capture(f); await mkdir(join(f.root, 'existing'))
  for (const target of [join(f.root, 'existing'), homedir(), dirname(f.root), join(dirname(f.root), 'outside')]) await assert.rejects(build(f, c, target), /target|contain|exist/i)
})
test('refuses junction ancestry escaping containment and referenced asset traversal', async t => {
  const f = await sourceFixture(t); const c = await capture(f)
  await symlink(f.source, join(f.root, 'alias'), 'junction')
  await assert.rejects(build(f, c, join(f.root, 'alias', 'escape')), /reparse|symlink|target|source/i)
  f.input.referencedBlobs[0].path = join(f.source, '..', 'external.svg')
  await assert.rejects(capture(f), /source|contain|outside|ENOENT/i)
})
test('detects changed captured source bytes and leaves target absent', async t => {
  const f = await sourceFixture(t); const c = await capture(f)
  await writeFile(f.input.controlPath, 'changed')
  await assert.rejects(build(f, c), /source.*changed|integrity/i)
  await assert.rejects(access(join(f.root, 'output')))
})
test('rejects mismatched cross-domain binding identity', async t => {
  const f = await sourceFixture(t)
  f.pre.preplanning_presentation.tables.bindings[f.oldPre].presentationProjectId = createStableId('project')
  await json(f.input.preStoragePaths.preplanning_presentation, f.pre.preplanning_presentation)
  await assert.rejects(capture(f), /identity|binding/i)
})
test('preserves current content/script/source/material bytes and manual geometry with complete new references', async t => {
  const f = await sourceFixture(t); const c = await capture(f); const result = await build(f, c)
  assert.notEqual(result.identities.preProjectId, f.oldPre); assert.notEqual(result.identities.sessionId, f.oldSession)
  assert.notEqual(result.identities.studioProjectId, f.ids.project)
  const state = JSON.parse(await readFile(result.paths.studioSeed, 'utf8'))
  const page = state.snapshot.pages[0]
  assert.equal(page.contentBlocks[0].content, 'Keep preplan-synthetic-original in prose')
  assert.equal(page.scriptBlocks[0].content, 'Verbatim script\nSecond line')
  assert.deepEqual(page.scriptBlocks[0].referencedContentBlockIds, [page.contentBlocks[0].contentBlockId])
  assert.equal(page.contentBlocks[0].sourceRefs[0].sourceProjectId, result.identities.preProjectId)
  assert.equal(page.contentBlocks[0].sourceRefs[0].sourceRevision, 59)
  assert.equal(state.operational.annotations[0].scopeKey, `draft:${page.pageId}`)
  assert.equal(state.operational.annotations[0].target.id, page.contentBlocks[0].contentBlockId)
  assert.equal(state.operational.reviewRuns[0].sessionId, result.identities.sessionId)
  assert.equal(state.operational.reviewRuns[0].workerSessionRef, null)
  assert.equal(state.operational.reviewSubmissions[0].status, 'dispatch_failed')
  assert.equal(state.operational.reviewSubmissions[0].baseRevision, 0)
  const layout = JSON.parse(await readFile(result.paths.manualLayoutSeed, 'utf8'))
  assert.deepEqual(layout.elements[0].frame, f.layout.elements[0].frame)
  assert.deepEqual(layout.elements[0].style, f.layout.elements[0].style)
  assert.equal(layout.elements[0].sourceRef.contentBlockId, page.contentBlocks[0].contentBlockId)
  const assetManifest = JSON.parse(await readFile(join(result.paths.workspace, 'assets/manifest.json')))
  assert.deepEqual(await readFile(join(result.paths.workspace, assetManifest.assets[0].relativePath)), f.bytes)
  assert.deepEqual(await readFile(join(result.paths.workspace, 'source-materials/documents/source.txt')), f.material)
  assert.equal(result.integrity.sourcesUnchanged, true)
  assert.equal(result.provenance.sourceStudioRevision, 111)
  assert.equal(result.provenance.sourcePreRevision, 59)
  for (const [digest, path] of Object.entries(result.paths.blobs)) assert.equal(hash(await readFile(path)), digest)
  assert.equal(result.integrity.outputAssetsVerified, true)
})
test('scopes all four Pre domains, retains 57 completed workflows and removes runnable authorization/work', async t => {
  const f = await sourceFixture(t); const result = await build(f, await capture(f))
  const seeded = {}; for (const name of names) seeded[name] = JSON.parse(await readFile(result.paths.preStorages[name]))
  const a = seeded.preplanning_agent.tables; const g = seeded.preplanning_governance.tables
  assert.deepEqual(Object.keys(a.projects), [result.identities.preProjectId])
  assert.deepEqual(Object.keys(a.bindings), [result.identities.sessionId])
  assert.equal(Object.values(a.bindings)[0].projectId, result.identities.preProjectId)
  assert.equal(Object.values(a.revisions)[0].stateSnapshot.project_identity.statement, 'Keep preplan-synthetic-original in prose')
  assert.equal(Object.values(g.workflow_runs).length, 57)
  assert.equal(Object.values(g.workflow_runs)[0].workflowId, 'workflow-0')
  assert.equal(Object.values(g.authorizations)[0].status, 'revoked')
  assert.equal(Object.values(g.project_policies)[0].mode, 'manual')
  assert.equal(Object.values(g.project_policies)[0].automationAuthorizationId, undefined)
  assert.deepEqual(g.visual_tasks, {}); assert.deepEqual(a.proposals, {})
  assert.deepEqual(seeded.preplanning_synthetic_boundary_fingerprints.tables.fingerprints, {})
  const binding = Object.values(seeded.preplanning_presentation.tables.bindings)[0]
  assert.equal(binding.workspaceRoot, result.paths.workspace)
  assert.equal(binding.directoryRoot, result.paths.workspace)
  assert.equal(binding.presentationProjectId, result.identities.studioProjectId)
  assert.equal(binding.stableIds['page:page-one'], result.mapping[f.ids.page])
  assert.equal(result.mapping[`${f.oldPre}:59`], Object.values(a.revisions)[0].revisionId)
  assert.ok(!JSON.stringify(seeded).includes('Foreign project private content'))
})
test('preserves schema-owned Pre business ids in current, frozen and committed payloads while remapping runtime ownership', async t => {
  const f = await sourceFixture(t); const business = await addPreBusinessDecisionFact(f)
  const result = await build(f, await capture(f))
  const domain = JSON.parse(await readFile(result.paths.preStorages.preplanning_agent))
  const a = domain.tables; const revision = Object.values(a.revisions)[0]
  const stateValue = Object.values(a.state_objects).find(row => row.objectId === 'PS02').value
  const proposal = Object.values(a.proposals)[0]; const proposalValue = proposal.envelope.change_set.payload
  for (const value of [stateValue, revision.stateSnapshot.PS02, proposalValue]) {
    assert.equal(value.project_id, result.identities.preProjectId)
    assert.deepEqual(value.data.excluded_decisions, [business.decision])
  }
  assert.notEqual(proposal.proposalId, business.proposalId)
  assert.notEqual(proposal.idempotencyKey, business.idempotencyKey)
  assert.notEqual(proposal.idempotencyKey, proposal.proposalId)
  assert.equal(proposal.envelope.proposal_id, proposal.proposalId)
  assert.equal(proposal.envelope.project_id, result.identities.preProjectId)
  assert.equal(proposal.envelope.idempotency_key, proposal.idempotencyKey)
  assert.deepEqual(Object.keys(a.bindings), [result.identities.sessionId])
  assert.equal(Object.values(a.bindings)[0].projectId, result.identities.preProjectId)
})
test('allows the optional Pre envelope idempotency_key to be absent while remapping the record identity', async t => {
  const f = await sourceFixture(t); const business = await addPreBusinessDecisionFact(f, 'ex-dec-01', false)
  const result = await build(f, await capture(f))
  const domain = JSON.parse(await readFile(result.paths.preStorages.preplanning_agent))
  const proposal = Object.values(domain.tables.proposals)[0]
  assert.notEqual(proposal.idempotencyKey, business.idempotencyKey)
  assert.equal(Object.hasOwn(proposal.envelope, 'idempotency_key'), false)
})
test('rejects missing or mismatched required Pre proposal runtime headers', async t => {
  const cases = [
    ['missing proposal_id', envelope => { delete envelope.proposal_id }],
    ['missing project_id', envelope => { delete envelope.project_id }],
    ['mismatched proposal_id', envelope => { envelope.proposal_id = 'proposal-pre-other' }],
    ['mismatched project_id', envelope => { envelope.project_id = 'preplan-other' }],
  ]
  for (const [name, mutate] of cases) await t.test(name, async child => {
    const f = await sourceFixture(child); await addPreBusinessDecisionFact(f)
    const proposal = Object.values(f.pre.preplanning_agent.tables.proposals).find(row => row.status === 'confirmed')
    proposal.idempotencyKey = proposal.proposalId
    proposal.envelope.idempotency_key = proposal.proposalId
    mutate(proposal.envelope)
    await json(f.input.preStoragePaths.preplanning_agent, f.pre.preplanning_agent)
    await assert.rejects(build(f, await capture(f)), /pre_proposal_(?:required_header|identity_mismatch)/)
    await assert.rejects(access(join(f.root, 'output')))
  })
})
test('preserves the schema-defined IM07 implementation critical_path in all frozen fact copies', async t => {
  const f = await sourceFixture(t); await addPreBusinessDecisionFact(f)
  const value = { object_id: 'IM07', project_id: f.oldPre, data: { critical_path: '先完成征收协调，再启动首期实施。' } }
  await replacePreBusinessFact(f, 'IM07', value)
  const result = await build(f, await capture(f))
  const domain = JSON.parse(await readFile(result.paths.preStorages.preplanning_agent))
  const a = domain.tables; const revision = Object.values(a.revisions)[0]; const proposal = Object.values(a.proposals)[0]
  assert.equal(Object.values(a.state_objects).find(row => row.objectId === 'IM07').value.data.critical_path, value.data.critical_path)
  assert.equal(revision.stateSnapshot.IM07.data.critical_path, value.data.critical_path)
  assert.equal(proposal.envelope.change_set.payload.data.critical_path, value.data.critical_path)
})
test('does not generalize the IM07 critical_path exception to other fact positions or live paths', async t => {
  const cases = [
    ['same field in PS02', 'PS02', { object_id: 'PS02', project_id: null, data: { critical_path: 'Not an IM07 contract field' } }],
    ['same field at another IM07 position', 'IM07', { object_id: 'IM07', project_id: null, data: { nested: { critical_path: 'Wrong schema position' } } }],
    ['live sourcePath in IM07', 'IM07', { object_id: 'IM07', project_id: null, data: { sourcePath: 'D:/private/external.json' } }],
  ]
  for (const [name, objectId, template] of cases) await t.test(name, async child => {
    const f = await sourceFixture(child); await addPreBusinessDecisionFact(f)
    const value = structuredClone(template); value.project_id = f.oldPre
    await replacePreBusinessFact(f, objectId, value)
    await assert.rejects(build(f, await capture(f)), /unsupported_live_external_field/)
    await assert.rejects(access(join(f.root, 'output')))
  })
})
test('does not let a same-named Pre business id authorize a Studio writable identity', async t => {
  const f = await sourceFixture(t); await addPreBusinessDecisionFact(f)
  f.pre.preplanning_agent.tables.proposals = {}
  await json(f.input.preStoragePaths.preplanning_agent, f.pre.preplanning_agent)
  const control = JSON.parse(await readFile(f.input.controlPath))
  control.operational.reviewSubmissions[0].writableIds.push('ex-dec-01')
  await json(f.input.controlPath, control)
  await assert.rejects(build(f, await capture(f)), /incomplete_identity_reference/)
  await assert.rejects(access(join(f.root, 'output')))
})
test('rejects unsupported unscoped global state instead of guessing and rejects MIME/hash mismatch', async t => {
  const f = await sourceFixture(t)
  f.pre.preplanning_agent.global = { activeProject: f.oldPre }
  await json(f.input.preStoragePaths.preplanning_agent, f.pre.preplanning_agent)
  await assert.rejects(capture(f), /unsupported.*global|unscoped/i)
  f.pre.preplanning_agent.global = {}; await json(f.input.preStoragePaths.preplanning_agent, f.pre.preplanning_agent)
  f.input.referencedBlobs[0].mimeType = 'image/png'
  await assert.rejects(capture(f), /mime/i)
})

async function rewriteCanonical(f) {
  await json(f.input.canonicalPath, { kind: 'CanonicalSnapshot', value: f.snapshot })
  const revision = JSON.parse(await readFile(f.input.revisionPath))
  revision.snapshotRef.sha256 = hash(await readFile(f.input.canonicalPath)); await json(f.input.revisionPath, revision)
  const control = JSON.parse(await readFile(f.input.controlPath))
  control.projectHead.currentRevisionRef.sha256 = hash(await readFile(f.input.revisionPath)); await json(f.input.controlPath, control)
}

async function addAcceptedCurrentReview(f) {
  const sourceRevision = f.input.expectedStudioRevision
  let state = projectStateFromParts({ snapshot: f.snapshot, currentRevision: sourceRevision, operational: f.operational, ui: { stage: 'draft', activePageId: f.ids.page } })
  state.reviewRuns[0].phase = 'queued'
  state.reviewRuns[0].workerSessionRef = null
  state.reviewRuns[0].leaseExpiresAt = null
  const added = executeAction(state, {
    type: 'annotation.add', scopeKey: `draft:${f.ids.page}`,
    target: { type: 'content-block', id: f.ids.contentBlock, label: 'Title' },
    instruction: 'Add an accepted body update',
  })
  state = added.state
  const submitted = submitReviewRound(state, { projectId: f.ids.project, scopeKey: `draft:${f.ids.page}` })
  state = submitted.state
  const begun = beginReviewDispatch(state, submitted.submission.id, { sessionId: f.oldSession, at })
  state = markSubmissionDispatch(begun.state, submitted.submission.id, { status: 'dispatched', reviewRunId: begun.reviewRun.id, sessionId: f.oldSession, at }).state
  const command = {
    commandId: createStudioId('command'), type: 'draft.update', scopeKey: submitted.submission.scopeKey,
    baseRevision: sourceRevision, riskLevel: 'ordinary_reversible', sourceAnnotationIds: [added.annotation.id],
    pageId: f.ids.page, patch: { body: 'Accepted synthetic body' },
  }
  const proposed = createProposalFromAgent(state, submitted.submission.id, {
    submissionId: submitted.submission.id, projectId: f.ids.project, baseRevision: sourceRevision,
    scopeKey: submitted.submission.scopeKey, idempotencyKey: submitted.submission.idempotencyKey,
    message: 'Apply the accepted body update', commands: [command],
  })
  const accepted = acceptProposal(proposed.state, proposed.proposal.id)
  state = accepted.state
  const snapshot = canonicalFromState(state)
  const canonicalPath = f.input.canonicalPath
  await json(canonicalPath, { kind: 'CanonicalSnapshot', value: snapshot })
  const canonicalSha256 = hash(await readFile(canonicalPath))
  const committed = state.revisions.at(-1)
  const revisionObject = {
    kind: 'RevisionRecord', revisionId: committed.id, revisionNumber: committed.number,
    parentRevision: committed.parentRevision, parentRevisionRef: null,
    snapshotRef: { sha256: canonicalSha256 }, source: committed.source,
    detail: structuredClone(committed.detail), idempotencyKey: null, createdAt: committed.createdAt,
  }
  await json(f.input.revisionPath, revisionObject)
  const revisionSha256 = hash(await readFile(f.input.revisionPath))
  const operational = {
    project: { updatedAt: state.project.updatedAt }, annotations: state.annotations,
    reviewRounds: state.reviewRounds, reviewSubmissions: state.reviewSubmissions,
    reviewRuns: state.reviewRuns, proposals: state.proposals,
    revisions: [
      ...state.revisions.slice(0, -1),
      { ...structuredClone(committed), stateHash: canonicalSha256, revisionRef: { sha256: revisionSha256 } },
    ],
  }
  const control = JSON.parse(await readFile(f.input.controlPath))
  control.projectHead.currentRevision = committed.number
  control.projectHead.currentRevisionRef.sha256 = revisionSha256
  control.operational = operational
  await json(f.input.controlPath, control)
  f.snapshot = snapshot
  f.operational = operational
  f.input.expectedStudioRevision = committed.number
  return { sourceRevision, acceptedRevision: committed.number, annotation: added.annotation, submission: submitted.submission, run: begun.reviewRun, command, proposal: state.proposals.find(row => row.id === proposed.proposal.id), revisionObject }
}

async function rewriteAcceptedCurrentObjects(f, control, snapshot) {
  await json(f.input.canonicalPath, { kind: 'CanonicalSnapshot', value: snapshot })
  const canonicalSha256 = hash(await readFile(f.input.canonicalPath))
  const revision = JSON.parse(await readFile(f.input.revisionPath))
  revision.snapshotRef.sha256 = canonicalSha256
  await json(f.input.revisionPath, revision)
  const revisionSha256 = hash(await readFile(f.input.revisionPath))
  control.projectHead.currentRevisionRef.sha256 = revisionSha256
  const summary = control.operational.revisions.find(row => row.number === control.projectHead.currentRevision)
  summary.stateHash = canonicalSha256; summary.revisionRef.sha256 = revisionSha256
  await json(f.input.controlPath, control)
  f.snapshot = snapshot
  f.operational = control.operational
}

function addSiblingCurrentPage(f, snapshot) {
  const original = snapshot.pages[0]; const sibling = structuredClone(original); const blockMapping = new Map()
  sibling.id = createStableId('page'); sibling.pageId = sibling.id; sibling.order = 1; sibling.draftDocumentId = createStableId('draftDocument')
  sibling.contentBlocks = sibling.contentBlocks.map(block => {
    const contentBlockId = createStableId('contentBlock'); blockMapping.set(block.contentBlockId, contentBlockId)
    return { ...block, contentBlockId, ...(block.items ? { items: block.items.map((item, order) => ({ ...item, listItemId: createStableId('listItem'), order })) } : {}) }
  })
  sibling.titleBlockId = blockMapping.get(original.titleBlockId)
  sibling.scriptBlocks = sibling.scriptBlocks.map(script => ({ ...script, scriptBlockId: createStableId('scriptBlock'), referencedContentBlockIds: script.referencedContentBlockIds.map(id => blockMapping.get(id)) }))
  sibling.pageAssets = sibling.pageAssets.map(asset => ({ ...asset, pageAssetId: createStableId('pageAsset') }))
  snapshot.pages.push(sibling)
  return sibling
}

test('retains one verified accepted current Proposal as inert Revision 0 history and normalizes only its legacy terminal queue', async t => {
  const f = await sourceFixture(t); const accepted = await addAcceptedCurrentReview(f)
  const result = await build(f, await capture(f)); const seed = JSON.parse(await readFile(result.paths.studioSeed))
  assert.equal(seed.revision, 0); assert.deepEqual(seed.operational.revisions, [])
  assert.equal(seed.operational.annotations.length, 2); assert.equal(seed.operational.reviewSubmissions.length, 2); assert.equal(seed.operational.reviewRuns.length, 2)
  assert.equal(seed.snapshot.pages.length, f.snapshot.pages.length)
  assert.deepEqual(seed.snapshot.pages.map(page => page.scriptBlocks.map(script => script.content)), f.snapshot.pages.map(page => page.scriptBlocks.map(script => script.content)))
  const proposal = seed.operational.proposals[0]; const sourceProposal = accepted.proposal
  assert.notEqual(proposal.id, sourceProposal.id); assert.equal(proposal.id, result.mapping[sourceProposal.id])
  assert.notEqual(proposal.commands[0].commandId, accepted.command.commandId); assert.equal(proposal.commands[0].commandId, result.mapping[accepted.command.commandId])
  assert.notEqual(proposal.idempotencyKey, sourceProposal.idempotencyKey); assert.equal(proposal.idempotencyKey, result.mapping[sourceProposal.idempotencyKey])
  assert.equal(proposal.status, 'accepted'); assert.equal(proposal.baseRevision, 0); assert.equal(proposal.acceptedRevision, 0)
  assert.deepEqual(proposal.fixtureProvenance, { readOnly: true, sourceBaseRevision: accepted.sourceRevision, sourceAcceptedRevision: accepted.acceptedRevision })
  assert.deepEqual(proposal.candidateSnapshot, seed.snapshot)
  assert.equal(proposal.submissionId, result.mapping[sourceProposal.submissionId]); assert.equal(proposal.reviewRoundId, result.mapping[sourceProposal.reviewRoundId])
  assert.equal(proposal.commands[0].pageId, result.mapping[accepted.command.pageId]); assert.deepEqual(proposal.commands[0].patch, { body: 'Accepted synthetic body' })
  for (const sourceId of sourceProposal.affectedObjectIds) assert.ok(proposal.affectedObjectIds.includes(result.mapping[sourceId]))
  for (const change of sourceProposal.diff.changes) assert.equal(proposal.diff.changes.find(row => row.objectId === result.mapping[change.objectId])?.changeType, change.changeType)
  const legacyRun = seed.operational.reviewRuns.find(run => run.reviewSubmissionId === result.mapping[f.operational.reviewSubmissions[0].id])
  assert.equal(legacyRun.phase, 'failed'); assert.equal(legacyRun.integrationState, 'dispatch_failed')
  assert.equal(legacyRun.fixtureProvenance.readOnly, true); assert.equal(legacyRun.fixtureProvenance.sourcePhase, 'queued')
  assert.equal(legacyRun.fixtureProvenance.sourceIntegrationState, 'dispatch_failed'); assert.equal(legacyRun.fixtureProvenance.sourceLeaseExpiresAt, null)
  assert.ok(Number.isFinite(Date.parse(legacyRun.fixtureProvenance.leaseComparedAt)))
  const acceptedRun = seed.operational.reviewRuns.find(run => run.resultProposalId === proposal.id)
  assert.equal(acceptedRun.phase, 'completed'); assert.equal(acceptedRun.integrationState, 'accepted')
  assert.equal(acceptedRun.reviewSubmissionId, proposal.submissionId)
  const repository = await createRepository(join(f.root, 'output', 'accepted-install'))
  try {
    await repository.initializeFromStandardProject({ snapshot: seed.snapshot, detail: result.provenance })
    await repository.transactOperational(state => ({ ...state, ...seed.operational, project: { ...state.project, ...seed.operational.project }, revisions: state.revisions }))
    const installed = repository.getState(); const beforeReplay = structuredClone(installed)
    assert.equal(installed.project.currentRevision, 0); assert.equal(installed.revisions.length, 1)
    assert.throws(() => acceptProposal(installed, proposal.id), /Proposal.*processed|Proposal.*handled|Proposal.*\u5df2\u5904\u7406/u)
    assert.deepEqual(installed, beforeReplay)
  } finally { await repository.close() }
})

test('verifies accepted candidate against source canonical before authorized unused-asset cleanup and normalizes both seed copies together', async t => {
  const f = await sourceFixture(t); await addAcceptedCurrentReview(f)
  const control = JSON.parse(await readFile(f.input.controlPath)); const sourceSnapshot = structuredClone(f.snapshot)
  const archive = sourceSnapshot.project.extensionPayload.standardArchive
  const unusedAssetId = createStableId('asset'); const unusedPath = 'assets/images/unused-current.svg'
  const unused = { ...archive.documents['assets/manifest.json'].assets[0], assetId: unusedAssetId, relativePath: unusedPath }
  archive.documents['assets/manifest.json'].assets.push(unused)
  archive.files.push({ relativePath: unusedPath, objectRef: { sha256: unused.sha256, sizeBytes: unused.sizeBytes, mimeType: unused.mimeType } })
  archive.files.push({ relativePath: 'private-unmanaged.txt', objectRef: { sha256: 'b'.repeat(64), sizeBytes: 7, mimeType: 'text/plain' } })
  control.operational.proposals[0].candidateSnapshot = structuredClone(sourceSnapshot)
  await rewriteAcceptedCurrentObjects(f, control, sourceSnapshot)
  const captured = await capture(f); const result = await build(f, captured); const seed = JSON.parse(await readFile(result.paths.studioSeed))
  const proposal = seed.operational.proposals[0]; const outputArchive = seed.snapshot.project.extensionPayload.standardArchive
  assert.deepEqual(proposal.candidateSnapshot, seed.snapshot)
  assert.equal(outputArchive.documents['assets/manifest.json'].assets.some(asset => asset.assetId === unusedAssetId), false)
  assert.equal(outputArchive.files.some(file => [unusedPath, 'private-unmanaged.txt'].includes(file.relativePath)), false)
  assert.equal(await api.verifyFixtureSources(captured), true)
})

test('rejects an accepted submission whose pageId and round point at another existing page than its frozen scope and command', async t => {
  const f = await sourceFixture(t); await addAcceptedCurrentReview(f)
  const control = JSON.parse(await readFile(f.input.controlPath)); const sourceSnapshot = structuredClone(f.snapshot)
  const sibling = addSiblingCurrentPage(f, sourceSnapshot)
  control.operational.proposals[0].candidateSnapshot = structuredClone(sourceSnapshot)
  const submission = control.operational.reviewSubmissions.at(-1); const round = control.operational.reviewRounds.at(-1)
  submission.pageId = sibling.id; submission.writableIds.push(sibling.id); round.pageId = sibling.id
  await rewriteAcceptedCurrentObjects(f, control, sourceSnapshot)
  await assert.rejects(capture(f), /accepted_proposal_references/)
})

test('normalizes only a demonstrably expired legacy dispatch lease and preserves terminal worker evidence as inert provenance', async t => {
  const f = await sourceFixture(t); await addAcceptedCurrentReview(f)
  const control = JSON.parse(await readFile(f.input.controlPath)); const expiredAt = '2000-01-01T00:00:00.000Z'
  const legacySource = control.operational.reviewRuns[0]; legacySource.leaseExpiresAt = expiredAt
  const acceptedSource = control.operational.reviewRuns.at(-1); acceptedSource.workerSessionRef = acceptedSource.taskId; acceptedSource.leaseExpiresAt = expiredAt
  await json(f.input.controlPath, control)
  const result = await build(f, await capture(f)); const seed = JSON.parse(await readFile(result.paths.studioSeed))
  const legacy = seed.operational.reviewRuns.find(run => run.integrationState === 'dispatch_failed')
  assert.equal(legacy.phase, 'failed'); assert.equal(legacy.leaseExpiresAt, null); assert.equal(legacy.workerSessionRef, null)
  assert.equal(legacy.fixtureProvenance.sourceLeaseExpiresAt, expiredAt); assert.ok(Number.isFinite(Date.parse(legacy.fixtureProvenance.leaseComparedAt)))
  const accepted = seed.operational.reviewRuns.find(run => run.integrationState === 'accepted')
  assert.equal(accepted.phase, 'completed'); assert.equal(accepted.workerSessionRef, null); assert.equal(accepted.leaseExpiresAt, null)
  assert.equal(accepted.fixtureProvenance.sourceWorkerSessionRef, acceptedSource.taskId); assert.equal(accepted.fixtureProvenance.sourceLeaseExpiresAt, expiredAt)
  assert.equal(accepted.fixtureProvenance.leaseComparedAt, legacy.fixtureProvenance.leaseComparedAt)
})

test('rejects malformed or unexpired leases and never generalizes expiry to running or nonterminal tasks', async t => {
  const cases = [
    ['malformed lease', run => { run.leaseExpiresAt = 'not-a-date' }],
    ['parseable non-timestamp lease', run => { run.leaseExpiresAt = '0' }],
    ['invalid calendar lease', run => { run.leaseExpiresAt = '2000-02-30T00:00:00.000Z' }],
    ['missing millisecond lease', run => { run.leaseExpiresAt = '2000-01-01T00:00:00Z' }],
    ['future lease', run => { run.leaseExpiresAt = '2999-01-01T00:00:00.000Z' }],
    ['running expired task', run => { run.phase = 'running'; run.leaseExpiresAt = '2000-01-01T00:00:00.000Z' }],
    ['nonterminal expired task', run => { run.integrationState = 'pending_dispatch'; run.leaseExpiresAt = '2000-01-01T00:00:00.000Z' }],
    ['accepted malformed lease', (run, control) => { control.operational.reviewRuns.at(-1).leaseExpiresAt = 'not-a-date' }],
    ['accepted future lease', (run, control) => { control.operational.reviewRuns.at(-1).leaseExpiresAt = '2999-01-01T00:00:00.000Z' }],
  ]
  for (const [name, mutate] of cases) await t.test(name, async child => {
    const f = await sourceFixture(child); await addAcceptedCurrentReview(f)
    const control = JSON.parse(await readFile(f.input.controlPath)); mutate(control.operational.reviewRuns[0], control); await json(f.input.controlPath, control)
    await assert.rejects(capture(f), /unsupported_active_studio_review/)
  })
})

test('rejects accepted Proposal history without exact current canonical and revision evidence closure', async t => {
  const cases = [
    ['pending status', async (f, control) => { control.operational.proposals[0].status = 'pending' }, /accepted_proposal_status/],
    ['unknown kind', async (f, control) => { control.operational.proposals[0].kind = 'ordinary' }, /accepted_proposal_kind/],
    ['wrong canonical', async (f, control) => { control.operational.proposals[0].candidateSnapshot.project.title = 'Wrong candidate' }, /accepted_proposal_candidate/],
    ['missing candidate', async (f, control) => { delete control.operational.proposals[0].candidateSnapshot }, /accepted_proposal_candidate/],
    ['wrong accepted revision', async (f, control) => { control.operational.proposals[0].acceptedRevision -= 1 }, /accepted_proposal_revision/],
    ['missing revision summaries', async (f, control) => { delete control.operational.revisions }, /accepted_proposal_revision_evidence/],
    ['missing agent summary', async (f, control) => { control.operational.revisions.at(-1).source = 'human' }, /accepted_proposal_revision_evidence/],
    ['wrong revision proposal link', async (f, control) => { control.operational.revisions.at(-1).detail.proposalId = createStudioId('proposal') }, /accepted_proposal_revision_evidence/],
    ['wrong RevisionRecord detail', async (f, control) => {
      const revision = JSON.parse(await readFile(f.input.revisionPath)); revision.detail.proposalId = createStudioId('proposal'); await json(f.input.revisionPath, revision)
      const digest = hash(await readFile(f.input.revisionPath)); control.projectHead.currentRevisionRef.sha256 = digest; control.operational.revisions.at(-1).revisionRef.sha256 = digest
    }, /accepted_proposal_revision_evidence/],
    ['wrong submission link', async (f, control) => { control.operational.proposals[0].submissionId = createStudioId('reviewSubmission') }, /accepted_proposal_revision_evidence/],
    ['wrong round link', async (f, control) => { control.operational.proposals[0].reviewRoundId = createStudioId('reviewRound') }, /accepted_proposal_references/],
    ['wrong run result link', async (f, control) => { control.operational.reviewRuns.at(-1).resultProposalId = createStudioId('proposal') }, /accepted_proposal_references/],
    ['malformed diff evidence', async (f, control) => { delete control.operational.proposals[0].diff.before }, /accepted_proposal_references/],
    ['collusive foreign project refs', async (f, control) => {
      const foreign = createStableId('project'); const proposal = control.operational.proposals[0]
      proposal.projectId = foreign; control.operational.reviewSubmissions.at(-1).projectId = foreign; control.operational.reviewRounds.at(-1).projectId = foreign
    }, /accepted_proposal_references/],
    ['collusive unknown page refs', async (f, control) => {
      const pageId = createStableId('page'); const proposal = control.operational.proposals[0]; const command = proposal.commands[0]
      proposal.scopeKey = `draft:${pageId}`; command.scopeKey = proposal.scopeKey; command.pageId = pageId
      control.operational.reviewSubmissions.at(-1).scopeKey = proposal.scopeKey; control.operational.reviewSubmissions.at(-1).pageId = pageId
      control.operational.reviewRounds.at(-1).scopeKey = proposal.scopeKey; control.operational.reviewRounds.at(-1).pageId = pageId
    }, /accepted_proposal_command/],
  ]
  for (const [name, mutate, expected] of cases) await t.test(name, async child => {
    const f = await sourceFixture(child); await addAcceptedCurrentReview(f)
    const control = JSON.parse(await readFile(f.input.controlPath)); await mutate(f, control); await json(f.input.controlPath, control)
    await assert.rejects(capture(f), expected)
  })
})

test('rejects accepted Proposal commands outside the one body-only ordinary draft update contract', async t => {
  const cases = [
    ['non draft update', command => { command.type = 'project.rename'; delete command.pageId; delete command.patch; command.projectId = createStableId('project'); command.title = 'No' }, /accepted_proposal_command/],
    ['heading patch', command => { command.patch = { heading: 'No' } }, /accepted_proposal_command/],
    ['extra patch key', command => { command.patch.extra = 'No' }, /accepted_proposal_command/],
    ['wrong scope', command => { command.scopeKey = 'outline:root' }, /accepted_proposal_command/],
    ['wrong annotation', command => { command.sourceAnnotationIds = [createStudioId('annotation')] }, /accepted_proposal_references/],
  ]
  for (const [name, mutate, expected] of cases) await t.test(name, async child => {
    const f = await sourceFixture(child); await addAcceptedCurrentReview(f)
    const control = JSON.parse(await readFile(f.input.controlPath)); mutate(control.operational.proposals[0].commands[0]); await json(f.input.controlPath, control)
    await assert.rejects(capture(f), expected)
  })
})

test('rejects truly active review runs and terminal failures that retain live authority', async t => {
  const cases = [
    ['queued accepted run', run => { run.phase = 'queued' }, /unsupported_active_studio_review/],
    ['running accepted run', run => { run.phase = 'running' }, /unsupported_active_studio_review/],
    ['pending integration', run => { run.integrationState = 'pending_dispatch' }, /unsupported_active_studio_review/],
    ['terminal queue with worker', run => { run.workerSessionRef = 'still-live' }, /unsupported_active_studio_review/],
    ['terminal queue with lease', run => { run.leaseExpiresAt = '2999-01-01T00:00:00.000Z' }, /unsupported_active_studio_review/],
  ]
  for (const [name, mutate, expected] of cases) await t.test(name, async child => {
    const f = await sourceFixture(child); await addAcceptedCurrentReview(f)
    const control = JSON.parse(await readFile(f.input.controlPath))
    mutate(name.includes('terminal queue') ? control.operational.reviewRuns[0] : control.operational.reviewRuns.at(-1))
    await json(f.input.controlPath, control)
    await assert.rejects(async () => build(f, await capture(f)), expected)
  })
})

async function addHistoricalReviewSnapshot(f, revisionNumber = 19) {
  const pageId = createStableId('page'); const draftDocumentId = createStableId('draftDocument')
  const contentBlockId = createStableId('contentBlock'); const listBlockId = createStableId('contentBlock')
  const listItemIds = [createStableId('listItem'), createStableId('listItem')]; const scriptBlockId = createStableId('scriptBlock')
  const historical = structuredClone(f.snapshot); const page = historical.pages[0]
  page.id = pageId; page.pageId = pageId; page.draftDocumentId = draftDocumentId
  page.titleBlockId = contentBlockId; page.contentBlocks[0].contentBlockId = contentBlockId
  page.contentBlocks.push({ contentBlockId: listBlockId, order: 1, type: 'list', role: 'key_points', items: listItemIds.map((listItemId, order) => ({ listItemId, order, content: `Historical item ${order + 1}`, sourceRefs: [] })), sourceRefs: [] })
  page.scriptBlocks[0].scriptBlockId = scriptBlockId; page.scriptBlocks[0].referencedContentBlockIds = [contentBlockId, listBlockId]
  const canonicalPath = join(f.source, `historical-canonical-${revisionNumber}.json`)
  await json(canonicalPath, { kind: 'CanonicalSnapshot', value: historical })
  const canonicalSha256 = hash(await readFile(canonicalPath))
  const revisionId = createStudioId('revision')
  const revisionPath = join(f.source, `historical-revision-${revisionNumber}.json`)
  await json(revisionPath, { kind: 'RevisionRecord', revisionId, revisionNumber, snapshotRef: { sha256: canonicalSha256 } })
  const revisionSha256 = hash(await readFile(revisionPath))
  const control = JSON.parse(await readFile(f.input.controlPath))
  const annotation = control.operational.annotations[0]
  annotation.scopeKey = `draft:${pageId}`; annotation.target = { type: 'content-block', id: contentBlockId, label: 'Deleted title' }; annotation.createdAgainstRevision = revisionNumber
  const round = control.operational.reviewRounds[0]
  round.scopeKey = `draft:${pageId}`; round.pageId = pageId
  const submission = control.operational.reviewSubmissions[0]
  const historicalOnlyIds = [pageId, draftDocumentId, contentBlockId, listBlockId, ...listItemIds, scriptBlockId]
  submission.scopeKey = `draft:${pageId}`; submission.pageId = pageId; submission.writableIds = historicalOnlyIds; submission.baseRevision = revisionNumber
  control.operational.revisions.unshift({ id: revisionId, number: revisionNumber, stateHash: canonicalSha256, revisionRef: { sha256: revisionSha256 } })
  await json(f.input.controlPath, control)
  f.input.historicalSnapshots = [{ revisionPath, canonicalPath }]
  return { pageId, draftDocumentId, contentBlockId, listBlockId, listItemIds, scriptBlockId, historicalOnlyIds, revisionId, revisionNumber, revisionPath, canonicalPath, revisionSha256, canonicalSha256 }
}

async function refreshHistoricalHashes(f, history) {
  const revision = JSON.parse(await readFile(history.revisionPath))
  revision.snapshotRef.sha256 = hash(await readFile(history.canonicalPath)); await json(history.revisionPath, revision)
  const control = JSON.parse(await readFile(f.input.controlPath))
  const summary = control.operational.revisions.find(row => row.number === history.revisionNumber)
  summary.stateHash = revision.snapshotRef.sha256; summary.revisionRef.sha256 = hash(await readFile(history.revisionPath))
  await json(f.input.controlPath, control)
}

test('maps all schema-defined writable descendants of the verified historical review page without importing design scope', async t => {
  const f = await sourceFixture(t); const currentPageId = f.ids.page; const currentScript = f.snapshot.pages[0].scriptBlocks[0].content
  const history = await addHistoricalReviewSnapshot(f)
  const result = await build(f, await capture(f)); const seed = JSON.parse(await readFile(result.paths.studioSeed)); const operational = seed.operational
  const mappedPageId = result.mapping[history.pageId]; const mappedBlockId = result.mapping[history.contentBlockId]
  assert.equal(operational.annotations[0].scopeKey, `draft:${mappedPageId}`); assert.equal(operational.annotations[0].target.id, mappedBlockId)
  assert.equal(operational.reviewRounds[0].scopeKey, `draft:${mappedPageId}`); assert.equal(operational.reviewRounds[0].pageId, mappedPageId)
  assert.equal(operational.reviewSubmissions[0].scopeKey, `draft:${mappedPageId}`); assert.equal(operational.reviewSubmissions[0].pageId, mappedPageId)
  assert.deepEqual(operational.reviewSubmissions[0].writableIds, history.historicalOnlyIds.map(id => result.mapping[id])); assert.equal(operational.reviewSubmissions[0].status, 'dispatch_failed')
  assert.deepEqual(seed.snapshot.pages.map(page => page.id), [result.mapping[currentPageId]])
  assert.equal(seed.snapshot.pages[0].scriptBlocks[0].content, currentScript)
  const activeIds = new Set(seed.snapshot.pages.flatMap(page => [page.id, page.draftDocumentId, ...page.contentBlocks.flatMap(block => [block.contentBlockId, ...(block.items ?? []).map(item => item.listItemId)]), ...page.scriptBlocks.map(script => script.scriptBlockId)]))
  for (const id of history.historicalOnlyIds) assert.equal(activeIds.has(result.mapping[id]), false, id)
  const layout = JSON.parse(await readFile(result.paths.manualLayoutSeed)); assert.equal(layout.pageId, result.mapping[currentPageId]); assert.notEqual(layout.pageId, mappedPageId)
  assert.deepEqual(result.provenance.historicalSnapshots, [{ readOnly: true, revisionNumber: 19, revisionSha256: history.revisionSha256, canonicalSha256: history.canonicalSha256, mappedHistoricalOnlyTargetIds: history.historicalOnlyIds.toSorted() }])
  assert.equal(result.provenance.historicalContentImported, false); assert.equal(result.provenance.historicalDesignScopeGranted, false)
})

test('does not resolve an obsolete review target without a declared verified historical snapshot', async t => {
  const f = await sourceFixture(t); await addHistoricalReviewSnapshot(f); delete f.input.historicalSnapshots
  await assert.rejects(build(f, await capture(f)), /incomplete_identity_reference/)
  await assert.rejects(access(join(f.root, 'output')))
})

test('rejects a random review target absent from its declared historical snapshot', async t => {
  const f = await sourceFixture(t); const history = await addHistoricalReviewSnapshot(f)
  const control = JSON.parse(await readFile(f.input.controlPath))
  control.operational.annotations[0].target.id = createStableId('contentBlock')
  control.operational.reviewSubmissions[0].writableIds = [history.pageId, history.contentBlockId]
  await json(f.input.controlPath, control)
  await assert.rejects(capture(f), /historical_review_target_not_found/)
})

test('rejects a valid descendant owned by another page in the same historical snapshot', async t => {
  const f = await sourceFixture(t); const history = await addHistoricalReviewSnapshot(f)
  const canonical = JSON.parse(await readFile(history.canonicalPath)); const otherPage = structuredClone(canonical.value.pages[0])
  otherPage.id = createStableId('page'); otherPage.pageId = otherPage.id; otherPage.order = 1; otherPage.draftDocumentId = createStableId('draftDocument')
  otherPage.contentBlocks = otherPage.contentBlocks.map(block => ({ ...block, contentBlockId: createStableId('contentBlock'), ...(block.items ? { items: block.items.map((item, order) => ({ ...item, listItemId: createStableId('listItem'), order })) } : {}) }))
  otherPage.titleBlockId = otherPage.contentBlocks[0].contentBlockId
  otherPage.scriptBlocks = otherPage.scriptBlocks.map(script => ({ ...script, scriptBlockId: createStableId('scriptBlock'), referencedContentBlockIds: otherPage.contentBlocks.map(block => block.contentBlockId) }))
  otherPage.pageAssets = otherPage.pageAssets.map(asset => ({ ...asset, pageAssetId: createStableId('pageAsset') }))
  canonical.value.pages.push(otherPage); await json(history.canonicalPath, canonical); await refreshHistoricalHashes(f, history)
  const control = JSON.parse(await readFile(f.input.controlPath)); control.operational.reviewSubmissions[0].writableIds = [history.pageId, history.contentBlockId, otherPage.contentBlocks[0].contentBlockId]; await json(f.input.controlPath, control)
  await assert.rejects(capture(f), /historical_review_target_not_found/)
})

test('rejects historical snapshots with an unverified hash, project or review-revision relationship', async t => {
  const cases = [
    ['wrong revision object hash', async (f, history) => { const control = JSON.parse(await readFile(f.input.controlPath)); control.operational.revisions.find(row => row.number === 19).revisionRef.sha256 = 'a'.repeat(64); await json(f.input.controlPath, control) }],
    ['wrong canonical object hash', async (f, history) => { const revision = JSON.parse(await readFile(history.revisionPath)); revision.snapshotRef.sha256 = 'b'.repeat(64); await json(history.revisionPath, revision); const control = JSON.parse(await readFile(f.input.controlPath)); control.operational.revisions.find(row => row.number === 19).revisionRef.sha256 = hash(await readFile(history.revisionPath)); await json(f.input.controlPath, control) }],
    ['other Studio project', async (f, history) => { const canonical = JSON.parse(await readFile(history.canonicalPath)); canonical.value.project.id = createStableId('project'); canonical.value.project.projectId = canonical.value.project.id; await json(history.canonicalPath, canonical); await refreshHistoricalHashes(f, history) }],
    ['revision not referenced by captured review history', async (f, history) => { const control = JSON.parse(await readFile(f.input.controlPath)); control.operational.annotations[0].createdAgainstRevision = 111; control.operational.reviewSubmissions[0].baseRevision = 111; await json(f.input.controlPath, control) }],
  ]
  for (const [name, mutate] of cases) await t.test(name, async child => {
    const f = await sourceFixture(child); const history = await addHistoricalReviewSnapshot(f); await mutate(f, history)
    await assert.rejects(capture(f), /historical_(?:revision|snapshot|project|review)/)
  })
})

test('rejects review history changed after a historical capture and leaves target absent', async t => {
  const f = await sourceFixture(t); await addHistoricalReviewSnapshot(f); const captured = await capture(f)
  const control = JSON.parse(await readFile(f.input.controlPath)); control.operational.annotations[0].instruction = 'Changed after capture'; await json(f.input.controlPath, control)
  await assert.rejects(build(f, captured), /source_changed_integrity_failure/)
  await assert.rejects(access(join(f.root, 'output')))
})

test('rejects dangling script and annotation references instead of inventing missing identities', async t => {
  const f = await sourceFixture(t)
  f.snapshot.pages[0].scriptBlocks[0].referencedContentBlockIds = [createStableId('contentBlock')]
  await rewriteCanonical(f)
  await assert.rejects(capture(f), /ScriptBlock|reference/i)
  f.snapshot.pages[0].scriptBlocks[0].referencedContentBlockIds = [f.ids.contentBlock]; await rewriteCanonical(f)
  const control = JSON.parse(await readFile(f.input.controlPath))
  control.operational.annotations[0].target.id = createStableId('contentBlock'); await json(f.input.controlPath, control)
  await assert.rejects(build(f, await capture(f)), /incomplete_identity_reference/)
  await assert.rejects(access(join(f.root, 'output')))
})
test('requires manual first-page capture and refuses a different-page layout', async t => {
  const f = await sourceFixture(t)
  const originalPath = f.input.manualLayoutPath; delete f.input.manualLayoutPath
  await assert.rejects(capture(f), /manual.*required/i)
  f.input.manualLayoutPath = originalPath; f.layout.pageId = createStableId('page'); await json(originalPath, f.layout)
  await assert.rejects(capture(f), /manual.*identity/i)
})
test('rejects unknown live paths in frozen JSON before materializing any target', async t => {
  const f = await sourceFixture(t)
  const a = f.pre.preplanning_agent.tables
  a.revisions[`${f.oldPre}:59`].stateSnapshot.project_identity.sourcePath = 'D:/private/external.json'
  await json(f.input.preStoragePaths.preplanning_agent, f.pre.preplanning_agent)
  await assert.rejects(build(f, await capture(f)), /unsupported_live_external_field.*sourcePath/)
  await assert.rejects(access(join(f.root, 'output')))
})

test('Pre seeds parse with the actual pure domain schemas when explicitly supplied', { skip: !process.env.DSH_FIXTURE_PRE_SCHEMA_ROOT }, async t => {
  const f = await sourceFixture(t); const result = await build(f, await capture(f))
  const schemaRoot = process.env.DSH_FIXTURE_PRE_SCHEMA_ROOT
  const state = await import(pathToFileURL(join(schemaRoot, 'src/state/domain.ts')))
  const governance = await import(pathToFileURL(join(schemaRoot, 'src/governance/domain.ts')))
  const presentation = await import(pathToFileURL(join(schemaRoot, 'src/presentation/binding-domain.ts')))
  for (const spec of [state.preplanningDomainSpec, governance.preplanningGovernanceDomainSpec, governance.preplanningSyntheticBoundaryFingerprintDomainSpec, presentation.preplanningPresentationDomainSpec]) {
    const medium = JSON.parse(await readFile(result.paths.preStorages[spec.name]))
    for (const [table, tableSpec] of Object.entries(spec.tables)) for (const row of Object.values(medium.tables[table])) assert.ok(tableSpec.valueSchema.parse(row))
  }
})

test('Studio seed installs through current repository APIs as one new Revision 0', async t => {
  const f = await sourceFixture(t); const result = await build(f, await capture(f))
  const seed = JSON.parse(await readFile(result.paths.studioSeed))
  const repository = await createRepository(join(f.root, 'output', 'synthetic-install'))
  try {
    for (const [digest, path] of Object.entries(result.paths.blobs)) {
      const record = result.integrity.assets.find(asset => asset.sha256 === digest)
      const ref = await repository.putBlob(Readable.from([await readFile(path)]), { mimeType: record.mimeType, originalFileName: basename(path) })
      assert.equal(ref.sha256, digest)
    }
    await repository.initializeFromStandardProject({ snapshot: seed.snapshot, detail: result.provenance })
    await repository.transactOperational(state => ({ ...state, ...seed.operational, project: { ...state.project, ...seed.operational.project }, revisions: state.revisions }))
    assert.equal(repository.getState().project.currentRevision, 0)
    assert.equal(repository.getState().revisions.length, 1)
    assert.equal(repository.getState().annotations[0].instruction, 'Preserve this review')
    assert.equal(repository.getState().reviewRuns[0].sessionId, result.identities.sessionId)
  } finally { await repository.close() }
})

test('drops unrelated archived files rather than copying private workspace extras', async t => {
  const f = await sourceFixture(t)
  f.snapshot.project.extensionPayload.standardArchive.files.push({ relativePath: 'private-unrelated.txt', objectRef: { sha256: 'a'.repeat(64), sizeBytes: 8, mimeType: 'text/plain' } })
  await rewriteCanonical(f)
  const result = await build(f, await capture(f))
  await assert.rejects(access(join(result.paths.workspace, 'private-unrelated.txt')))
  assert.equal(result.integrity.assets.some(asset => asset.sha256 === 'a'.repeat(64)), false)
})

test('refuses byte formats whose advertised MIME cannot be verified', async t => {
  const f = await sourceFixture(t)
  const bytes = Buffer.from([0, 1, 2, 3]); const path = join(f.source, 'invalid.docx')
  await writeFile(path, bytes)
  f.input.referencedBlobs.push({ path, sha256: hash(bytes), sizeBytes: bytes.length, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  await assert.rejects(capture(f), /unsupported_asset_mime|mime.*mismatch/i)
})

test('copies only referenced assets, excluding unused manifest assets', async t => {
  const f = await sourceFixture(t)
  const manifest = JSON.parse(await readFile(join(f.input.standardWorkspace, 'assets/manifest.json')))
  const unusedBytes = Buffer.from(f.bytes.toString().replace('<rect ', '<rect x="1" '))
  const unused = { ...manifest.assets[0], assetId: createStableId('asset'), relativePath: 'assets/images/unused.svg', sha256: hash(unusedBytes), sizeBytes: unusedBytes.length }
  await writeFile(join(f.input.standardWorkspace, unused.relativePath), unusedBytes)
  const archive = f.snapshot.project.extensionPayload.standardArchive
  archive.documents['assets/manifest.json'].assets.push(unused)
  archive.files.push({ relativePath: unused.relativePath, objectRef: { sha256: unused.sha256, sizeBytes: unused.sizeBytes, mimeType: unused.mimeType } })
  await rewriteCanonical(f)
  const result = await build(f, await capture(f))
  const output = JSON.parse(await readFile(join(result.paths.workspace, 'assets/manifest.json')))
  assert.equal(output.assets.length, 1)
  await assert.rejects(access(join(result.paths.workspace, 'assets/images/unused.svg')))
})

test('preserves verified opaque DWG and RAR4/RAR5 source material bytes and MIME', async t => {
  const f = await sourceFixture(t)
  const archive = f.snapshot.project.extensionPayload.standardArchive
  const samples = [
    { name: 'source.DWG', mimeType: 'application/acad', hex: '4143313032370000' },
    { name: 'source-rar4.rar', mimeType: 'application/vnd.rar', hex: '526172211a0700' },
    { name: 'source-rar5.rar', mimeType: 'application/vnd.rar', hex: '526172211a070100' },
  ]
  for (const sample of samples) {
    sample.bytes = Buffer.concat([Buffer.from(sample.hex, 'hex'), Buffer.from([0x00, 0xff, 0x31])])
    const relativePath = `source-materials/${sample.name.endsWith('.DWG') ? 'drawings' : 'other'}/${sample.name}`
    sample.relativePath = relativePath
    const record = { sourceMaterialId: createStableId('sourceMaterial'), originalFileName: sample.name, category: sample.name.endsWith('.DWG') ? 'drawing' : 'other', relativePath, mimeType: sample.mimeType, sha256: hash(sample.bytes), sizeBytes: sample.bytes.length, importedAt: at, status: 'available' }
    archive.documents['source-materials/manifest.json'].materials.push(record)
    archive.files.push({ relativePath, objectRef: { sha256: record.sha256, sizeBytes: record.sizeBytes, mimeType: record.mimeType } })
    f.snapshot.pages[0].contentBlocks[0].sourceRefs[0].evidenceIds.push(record.sourceMaterialId)
    await writeFile(join(f.input.standardWorkspace, relativePath), sample.bytes)
  }
  await json(join(f.input.standardWorkspace, 'source-materials/manifest.json'), archive.documents['source-materials/manifest.json'])
  await rewriteCanonical(f)
  const result = await build(f, await capture(f))
  const manifest = JSON.parse(await readFile(join(result.paths.workspace, 'source-materials/manifest.json')))
  const seed = JSON.parse(await readFile(result.paths.studioSeed))
  for (const sample of samples) {
    const record = manifest.materials.find(item => item.originalFileName === sample.name)
    assert.equal(record.mimeType, sample.mimeType)
    assert.equal(record.sha256, hash(sample.bytes)); assert.equal(record.sizeBytes, sample.bytes.length)
    assert.deepEqual(await readFile(join(result.paths.workspace, record.relativePath)), sample.bytes)
    assert.deepEqual(await readFile(result.paths.blobs[record.sha256]), sample.bytes)
    const archived = seed.snapshot.project.extensionPayload.standardArchive.files.find(file => file.relativePath === record.relativePath)
    assert.equal(archived.objectRef.mimeType, record.mimeType)
  }
  const pageAsset = seed.snapshot.pages[0].pageAssets[0]
  const assets = JSON.parse(await readFile(join(result.paths.workspace, 'assets/manifest.json')))
  assert.equal(pageAsset.mimeType, pageAsset.objectRef.mimeType)
  assert.equal(pageAsset.mimeType, assets.assets.find(asset => asset.assetId === pageAsset.assetId).mimeType)
  assert.equal(result.integrity.sourcesUnchanged, true)
})

test('rejects malformed opaque signatures, mismatched extension/MIME and recorded hash/size', async t => {
  const f = await sourceFixture(t)
  const original = [...f.input.referencedBlobs]
  const cases = [
    ['truncated.dwg', 'application/acad', '4143313032'],
    ['unknown.dwg', 'application/acad', '4143393939390000'],
    ['malformed.dwg', 'application/acad', '4143313032370100'],
    ['high-bit.dwg', 'application/acad', 'c1c3313032370000'],
    ['truncated.rar', 'application/vnd.rar', '526172211a07'],
    ['truncated-rar5.rar', 'application/vnd.rar', '526172211a0701'],
    ['unknown.rar', 'application/vnd.rar', '526172211a070200'],
    ['malformed.rar', 'application/vnd.rar', '526172221a070100'],
    ['wrong.txt', 'application/vnd.rar', '526172211a070100'],
    ['wrong.dwg', 'application/vnd.rar', '526172211a070100'],
    ['wrong.rar', 'application/acad', '4143313032370000'],
    ['wrong-mime.rar', 'application/octet-stream', '526172211a070100'],
  ]
  for (const [name, mimeType, hex] of cases) {
    const path = join(f.source, name); const bytes = Buffer.from(hex, 'hex'); await writeFile(path, bytes)
    f.input.referencedBlobs = [...original, { path, sha256: hash(bytes), sizeBytes: bytes.length, mimeType }]
    await assert.rejects(capture(f), /mime|signature/i, name)
  }
  const path = join(f.source, 'integrity.rar'); const bytes = Buffer.from('526172211a07010000ff', 'hex'); await writeFile(path, bytes)
  for (const metadata of [{ sha256: 'a'.repeat(64), sizeBytes: bytes.length }, { sha256: hash(bytes), sizeBytes: bytes.length + 1 }, { sha256: hash(bytes) }]) {
    f.input.referencedBlobs = [...original, { path, mimeType: 'application/vnd.rar', ...metadata }]
    await assert.rejects(capture(f), /hash_integrity/i)
  }
})

for (const field of ['workspaceRoot', 'directoryRoot']) test(`rejects unknown nested ${field} consistently present in both frozen state copies`, async t => {
  const f = await sourceFixture(t); const a = f.pre.preplanning_agent.tables
  const value = { statement: 'Frozen statement remains verbatim', nested: { [field]: f.input.standardWorkspace } }
  a.revisions[`${f.oldPre}:59`].stateSnapshot.project_identity = structuredClone(value)
  a.state_objects[`${f.oldPre}:project_identity`].value = structuredClone(value)
  await json(f.input.preStoragePaths.preplanning_agent, f.pre.preplanning_agent)
  const captured = await capture(f)
  await assert.rejects(build(f, captured), new RegExp(`unsupported_live_external_field.*nested\\.${field}`))
  await assert.rejects(access(join(f.root, 'output')))
  assert.equal(await api.verifyFixtureSources(captured), true)
})

async function adoptedSvg(f, { mimeType = 'image/svg+xml', fileName = `${f.oldPre}/adopted/diagram.svg` } = {}) {
  const tables = f.pre.preplanning_governance.tables
  tables.visual_tasks['adopted-task'] = { taskId: 'adopted-task', projectId: f.oldPre, chapterId: '01', workItemId: 'item-0', kind: 'deterministic', required: true, status: 'adopted', attempts: 1, updatedAt: at }
  const asset = { assetId: 'adopted-svg', taskId: 'adopted-task', projectId: f.oldPre, kind: 'deterministic', required: true, status: 'adopted', mimeType, fileName, sha256: hash(f.bytes), width: 4, height: 4, createdAt: at, adoptedRevision: 59 }
  tables.visual_assets['adopted-svg'] = asset
  await json(f.input.preStoragePaths.preplanning_governance, f.pre.preplanning_governance)
  return asset
}

test('preserves an adopted Pre visual asset with verified own MIME, extension and bytes', async t => {
  const f = await sourceFixture(t); await adoptedSvg(f)
  const result = await build(f, await capture(f))
  const domain = JSON.parse(await readFile(result.paths.preStorages.preplanning_governance))
  const asset = Object.values(domain.tables.visual_assets)[0]
  assert.equal(asset.mimeType, 'image/svg+xml')
  assert.equal(asset.fileName, `${result.identities.preProjectId}/adopted/diagram.svg`)
  assert.deepEqual(await readFile(join(result.paths.visualAssetRoot, asset.fileName)), f.bytes)
  assert.equal(hash(await readFile(result.paths.blobs[asset.sha256])), asset.sha256)
  assert.equal(result.integrity.outputAssetsVerified, true)
  assert.equal(JSON.stringify(domain).includes('__fixture_workspace__'), false)
  if (process.env.DSH_FIXTURE_PRE_SCHEMA_ROOT) {
    const { preplanningGovernanceDomainSpec } = await import(pathToFileURL(join(process.env.DSH_FIXTURE_PRE_SCHEMA_ROOT, 'src/governance/domain.ts')))
    assert.deepEqual(preplanningGovernanceDomainSpec.tables.visual_assets.valueSchema.parse(asset), asset)
  }
})

test('rejects adopted Pre visual record MIME or filename inconsistent with validated SVG bytes during capture', async t => {
  const f = await sourceFixture(t)
  for (const candidate of [
    { mimeType: 'image/png', fileName: `${f.oldPre}/adopted/diagram.png` },
    { mimeType: 'image/svg+xml', fileName: `${f.oldPre}/adopted/diagram.png` },
    { mimeType: 'image/png', fileName: `${f.oldPre}/adopted/diagram.svg` },
    { mimeType: 'image/svg+xml', fileName: `${f.oldPre}/adopted/diagram.bin` },
  ]) {
    await adoptedSvg(f, candidate)
    await assert.rejects(capture(f), /referenced_pre_asset_mime_mismatch/)
  }
  await assert.rejects(access(join(f.root, 'output')))
})
