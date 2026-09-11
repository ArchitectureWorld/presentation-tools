// Test-only staged Host harness. Importing this file performs no I/O or dispatch.
import { createHash, randomUUID } from 'node:crypto'
import { lstat, realpath, readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve, relative, isAbsolute, sep, parse } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { createRepository } from '../apps/studio-local/repository.mjs'
import { readWorkspaceSnapshot } from '../apps/studio-local/workspace-live-link.mjs'
import { createLayoutService } from '../apps/studio-local/layout-service.mjs'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
const fail = code => { throw Object.assign(new Error(code), { code }) }
const domains = ['preplanning_agent', 'preplanning_governance', 'preplanning_presentation', 'preplanning_synthetic_boundary_fingerprints']
function requireApprovedHashes(input) {
  if (typeof input.fixtureReportSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.fixtureReportSha256)) fail('required_sha256_missing_or_invalid')
  if (!Array.isArray(input.packages) || !same(input.packages.map(p => p?.role).sort(), ['pre', 'studio'])) fail('two_explicit_packages_required')
  for (const pkg of input.packages) if (typeof pkg.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pkg.sha256)) fail('required_sha256_missing_or_invalid')
}
function inside(root, path) { const r = relative(root, path); return r !== '' && !r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r) }
function absolute(p) { if (typeof p !== 'string' || !isAbsolute(p)) fail('absolute_path_required'); return resolve(p) }
async function noLinks(path) {
  const p = absolute(path); let cursor = parse(p).root
  for (const part of relative(cursor, p).split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    try {
      const st = await lstat(cursor)
      if (st.isSymbolicLink() || resolve(await realpath(cursor)).toLowerCase() !== resolve(cursor).toLowerCase()) fail('symlink_reparse_forbidden')
    } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
}
async function absent(path) { try { await lstat(path); fail('destination_exists') } catch (e) { if (e.code !== 'ENOENT') throw e } }
async function checkedFile(path, digest) {
  await noLinks(path); const st = await lstat(path); if (!st.isFile() || st.nlink !== 1) fail('regular_independent_file_required')
  const bytes = await readFile(path)
  if (digest !== undefined && (!/^[a-f0-9]{64}$/.test(digest) || sha(bytes) !== digest)) fail('sha256_mismatch')
  return bytes
}
async function safeWrite(root, path, value) {
  if (!inside(root, path)) fail('write_containment')
  await noLinks(path); await mkdir(dirname(path), { recursive: true }); await noLinks(dirname(path))
  await writeFile(path, Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
export function isolatedEnvironment(home, environment = process.env) {
  const env = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) if (typeof environment[key] === 'string') env[key] = environment[key]
  return Object.assign(env, { DSH_HOME: absolute(home), CI: '1', NO_COLOR: '1' })
}
export function minimizeRoute(settings, credentials) {
  const route = settings?.['agent-default-model']; const selected = settings?.['llm-pi-ai']?.providers?.[route?.provider]
  if (!route || !selected || !selected.models?.some(m => m.id === route.model)) fail('selected_route_missing')
  const allowed = new Set(['displayName', 'api', 'baseURL', 'models', 'apiKeyEnv', 'defaultInput'])
  if (Object.keys(selected).some(k => !allowed.has(k))) fail('unsupported_provider_field')
  if (Object.keys(route).some(k => !['provider', 'model', 'reasoningEffort'].includes(k))) fail('unsupported_route_field')
  const ref = selected.apiKeyEnv
  if (credentials?.version !== 1 || typeof ref !== 'string' || !ref || typeof credentials.refs?.[ref] !== 'string' || !credentials.refs[ref].trim()) fail('credential_ref_missing')
  return { settings: { 'llm-pi-ai': { providers: { [route.provider]: structuredClone(selected) } }, 'agent-default-model': structuredClone(route) }, credentials: { version: 1, refs: { [ref]: credentials.refs[ref] }, records: {} }, route: structuredClone(route), declaredInput: structuredClone(selected.models.find(m => m.id === route.model).input ?? selected.defaultInput ?? ['text']) }
}
export async function prepareIsolation(input) {
  requireApprovedHashes(input)
  const root = absolute(input.containmentRoot); const home = absolute(input.home)
  if (!inside(root, home) || home === resolve(homedir()) || root === parse(root).root || root === resolve(homedir())) fail('destination_containment')
  await noLinks(root); await noLinks(home); await absent(home)
  if (!(await lstat(dirname(home))).isDirectory()) fail('destination_parent_missing')
  const reportPath = absolute(input.fixtureReportPath)
  if (!inside(root, reportPath) || inside(home, reportPath) || inside(dirname(reportPath), home)) fail('fixture_home_overlap')
  const report = JSON.parse(await checkedFile(reportPath, input.fixtureReportSha256))
  if (report.hostInstalled !== false || report.provenance?.readOnly !== true || report.integrity?.sourcesUnchanged !== true || report.integrity?.outputAssetsVerified !== true) fail('reviewed_fixture_required')
  const fixtureRoot = dirname(reportPath)
  for (const path of [report.paths.workspace, report.paths.studioSeed, ...Object.values(report.paths.preStorages), ...Object.values(report.paths.blobs), ...(report.paths.manualLayoutSeed ? [report.paths.manualLayoutSeed] : [])]) {
    if (!inside(fixtureRoot, absolute(path))) fail('fixture_path_containment')
    await noLinks(path)
  }
  if (!same(Object.keys(report.paths.preStorages).sort(), [...domains].sort())) fail('four_pre_domains_required')
  const seedHashes = {}
  for (const path of [report.paths.studioSeed, ...Object.values(report.paths.preStorages), ...(report.paths.manualLayoutSeed ? [report.paths.manualLayoutSeed] : [])]) seedHashes[path] = sha(await checkedFile(path))
  const dshBin = absolute(input.dshBin); await checkedFile(dshBin)
  if (!/\.[cm]?js$/i.test(dshBin)) fail('dsh_node_entry_required')
  if (!Array.isArray(input.packages) || !same(input.packages.map(p => p.role).sort(), ['pre', 'studio'])) fail('two_explicit_packages_required')
  const packages = []
  for (const pkg of input.packages) { await checkedFile(absolute(pkg.path), pkg.sha256); packages.push({ role: pkg.role, path: resolve(pkg.path), sha256: pkg.sha256 }) }
  const parseDocument = input.parseDocument ?? createRequire(dshBin)('yaml').parse
  let minimized
  try { minimized = minimizeRoute(parseDocument((await checkedFile(absolute(input.settingsSourcePath))).toString()), parseDocument((await checkedFile(absolute(input.credentialsSourcePath))).toString())) }
  catch (e) { if (e.code?.startsWith('credential_') || e.code?.startsWith('unsupported_') || e.code === 'selected_route_missing') throw e; fail('private_route_read_failed') }
  const paths = { settings: join(home, 'settings.yaml'), credentials: join(home, '.credentials.yaml'), sessions: join(home, 'sessions'), storages: join(home, 'storages'), studio: join(home, 'report-studio-v0.1.0'), patch: join(home, 'isolation.patch.json'), evidence: join(home, 'evidence'), presentation: join(home, 'presentation-projects'), visualAssets: join(home, 'preplanning-agent', 'visual-assets'), reportPackages: join(home, 'preplanning-agent', 'report-packages'), clientProfiles: join(home, 'preplanning-agent', 'client-profiles') }
  await mkdir(home); await noLinks(home)
  await safeWrite(home, paths.settings, minimized.settings); await safeWrite(home, paths.credentials, minimized.credentials)
  const patch = [{ id: 'settings', config: { path: paths.settings } }, { id: 'credentials', config: { path: paths.credentials } }, { id: 'session-persistence-jsonl', config: { root: paths.sessions } }, { id: 'storage-json', config: { root: paths.storages } }, { id: 'attachment-local', config: { dshHome: home } }, { id: 'report-studio-dsh', config: { dataDir: paths.studio } }]
  await safeWrite(home, paths.patch, patch)
  for (const path of [paths.sessions, paths.storages, paths.evidence, paths.presentation, paths.visualAssets, paths.reportPackages, paths.clientProfiles]) await mkdir(path, { recursive: true })
  const prepared = { home, containmentRoot: root, fixtureRoot, fixtureReportPath: reportPath, fixtureReportSha256: input.fixtureReportSha256, seedHashes, fixture: report, paths, packages, dshBin, env: isolatedEnvironment(home, input.environment), route: minimized.route, declaredInput: minimized.declaredInput, actualHostRun: false, actualModelRun: false }
  await safeWrite(home, join(paths.evidence, 'prepared.json'), { packages: packages.map(({ role, sha256 }) => ({ role, sha256 })), fixtureReportSha256: input.fixtureReportSha256, route: minimized.route, actualHostRun: false, actualModelRun: false })
  return prepared
}
function activeContent(snapshot) {
  return { projectId: snapshot.project.id, outline: snapshot.outline.map(r => ({ id: r.id, title: r.title })), pages: snapshot.pages.map(p => ({ id: p.id, contentBlocks: p.contentBlocks, scriptBlocks: p.scriptBlocks, pageAssets: (p.pageAssets ?? []).map(a => ({ pageAssetId: a.pageAssetId, assetId: a.assetId, role: a.role, caption: a.caption, objectRef: a.objectRef ? { sha256: a.objectRef.sha256, sizeBytes: a.objectRef.sizeBytes, mimeType: a.objectRef.mimeType } : null })) })) }
}
export async function seedIsolatedRepository(prepared) {
  const { home, paths, fixture: f } = prepared
  await checkedFile(prepared.fixtureReportPath, prepared.fixtureReportSha256)
  for (const [path, digest] of Object.entries(prepared.seedHashes)) await checkedFile(path, digest)
  await noLinks(home); await noLinks(f.paths.workspace)
  const workspace = await realpath(f.paths.workspace)
  const repositoryRoot = join(paths.studio, 'workspaces', sha(workspace).slice(0, 32))
  if (!inside(home, repositoryRoot) || !inside(prepared.fixtureRoot, workspace)) fail('seed_containment')
  await absent(repositoryRoot); await noLinks(repositoryRoot)
  const seed = JSON.parse(await checkedFile(f.paths.studioSeed))
  if (seed.revision !== 0 || seed.snapshot.project.id !== f.identities.studioProjectId) fail('seed_identity_mismatch')
  if ((seed.operational.reviewRuns ?? []).some(r => r.workerSessionRef || r.leaseExpiresAt || ['pending_dispatch', 'dispatched', 'running', 'queued'].includes(r.integrationState))) fail('active_review_forbidden')
  const pre = {}
  for (const name of domains) pre[name] = JSON.parse(await checkedFile(f.paths.preStorages[name]))
  const workflows = pre.preplanning_governance.tables.workflow_runs ?? {}
  if (Object.values(workflows).some(r => !['confirmed', 'not_applicable'].includes(r.status))) fail('runnable_workflow_forbidden')
  if (Object.keys(workflows).length !== 57) fail('completed_workflow_count_mismatch')
  if (Object.values(pre.preplanning_governance.tables.authorizations ?? {}).some(r => r.status === 'active') || Object.values(pre.preplanning_governance.tables.project_policies ?? {}).some(r => r.mode !== 'manual' || r.automationAuthorizationId)) fail('automation_authority_forbidden')
  const bindings = pre.preplanning_agent.tables.bindings
  if (!bindings || !same(Object.keys(bindings), [f.identities.sessionId]) || bindings[f.identities.sessionId].sessionId !== f.identities.sessionId) fail('session_binding_mismatch')
  for (const b of Object.values(pre.preplanning_presentation.tables.bindings ?? {})) if (resolve(b.workspaceRoot) !== workspace || resolve(b.directoryRoot) !== workspace || b.presentationProjectId !== f.identities.studioProjectId) fail('pre_workspace_binding_mismatch')
  const repository = await createRepository(repositoryRoot)
  try {
    for (const [digest, path] of Object.entries(f.paths.blobs)) {
      const bytes = await checkedFile(path, digest)
      const refs = []; const visit = v => { if (!v || typeof v !== 'object') return; if (v.sha256 === digest && v.mimeType && v.sizeBytes !== undefined) refs.push(v); Object.values(v).forEach(visit) }; visit(seed.snapshot)
      if (refs.length) await repository.putBlob(Readable.from([bytes]), { ...refs[0], originalFileName: basename(path) })
    }
    const current = await readWorkspaceSnapshot(workspace, { putBlob: repository.putBlob })
    if (current.status !== 'connected' || !same(activeContent(current.snapshot), activeContent(seed.snapshot))) fail('workspace_active_content_incoherent')
    await repository.initializeFromStandardProject({ snapshot: seed.snapshot, source: 'workspace_upstream', detail: { actionType: 'workspace.upstream_publish', workspaceRoot: workspace, fingerprint: current.fingerprint, sourceRevision: current.sourceRevision, sourceRevisions: current.sourceRevisions, fixtureProvenance: f.provenance } })
    await repository.transactOperational(state => { const revisions = state.revisions; const { project, revisions: ignored, ...records } = seed.operational; Object.assign(state, structuredClone(records)); Object.assign(state.project, project); state.revisions = revisions; return state })
    let layoutRef = null
    if (f.paths.manualLayoutSeed) {
      await noLinks(join(workspace, 'layouts'))
      try { if ((await readdir(join(workspace, 'layouts'))).some(name => name !== '.gitkeep')) fail('layout_destination_not_empty') } catch (e) { if (e.code !== 'ENOENT') throw e }
      const layout = JSON.parse(await checkedFile(f.paths.manualLayoutSeed))
      const service = createLayoutService({ repository, layoutRoot: join(workspace, 'layouts') })
      const ctx = await service.designContext({ pageId: layout.pageId })
      const preparedLayout = await service.store.preparePage(layout, { expectedLayoutRevision: -1, sourceProjectRevision: 0, sourceStateHash: ctx.projection.sourceStateHash })
      await service.publishDesign({ pageId: layout.pageId, prepared: preparedLayout, baseProjectRevision: 0, baseLayoutRevision: null, baseLayoutSha: null, sourceStateHash: ctx.projection.sourceStateHash })
      layoutRef = preparedLayout.ref
    }
    for (const name of domains) await safeWrite(home, join(paths.storages, `${name}.json`), pre[name])
    for (const asset of Object.values(pre.preplanning_governance.tables.visual_assets ?? {})) {
      if (!asset.fileName || !inside(paths.visualAssets, resolve(paths.visualAssets, asset.fileName))) fail('visual_asset_path_escape')
      const blob = f.paths.blobs[asset.sha256]; if (!blob) fail('visual_asset_blob_missing')
      await safeWrite(home, resolve(paths.visualAssets, asset.fileName), await checkedFile(blob, asset.sha256))
    }
    const result = { repositoryRoot, fingerprint: current.fingerprint, revision: repository.getState().project.currentRevision, layoutRef, completedWorkflowCount: Object.keys(workflows).length, workflowDigest: sha(JSON.stringify(sorted(workflows))), actualHostRun: false, actualModelRun: false }
    await safeWrite(home, join(paths.evidence, 'seeded.json'), result)
    return result
  } finally { await repository.close() }
}
export async function dispatchModelPrompt({ prepared, rpc, text, executeModel = false, clientTimeZone }) {
  if (executeModel !== true) fail('explicit_model_dispatch_required')
  if (typeof text !== 'string' || !text.trim()) fail('prompt_required')
  const payload = { sessionId: prepared.fixture.identities.sessionId, mode: 'queue', content: [{ type: 'text', text }] }
  if (clientTimeZone) payload.clientTimeZone = clientTimeZone
  const result = await rpc('session.prompt', payload)
  if (result?.accepted !== true) fail('prompt_not_accepted')
  return { accepted: true, completionVerified: false, actualModelRun: true }
}
const deadlineError = () => Object.assign(new Error('deadline_exceeded'), { code: 'deadline_exceeded' })
function withinDeadline(work, { deadline, signal }) {
  if (!Number.isFinite(deadline)) return Promise.reject(new Error('finite_deadline_required'))
  if (Date.now() >= deadline) return Promise.reject(deadlineError())
  if (signal?.aborted) return Promise.reject(signal.reason ?? deadlineError())
  return new Promise((done, reject) => {
    const controller = new AbortController(); let settled = false
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer)
      signal?.removeEventListener('abort', parentAbort); controller.signal.removeEventListener('abort', abort)
      error ? reject(error) : done(value)
    }
    const abort = () => finish(controller.signal.reason ?? deadlineError())
    const parentAbort = () => controller.abort(signal.reason ?? deadlineError())
    const timer = setTimeout(() => controller.abort(deadlineError()), Math.ceil(deadline - Date.now()))
    controller.signal.addEventListener('abort', abort, { once: true }); signal?.addEventListener('abort', parentAbort, { once: true })
    Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal) }).then(value => {
      if (Date.now() >= deadline) controller.abort(deadlineError())
      else finish(null, value)
    }, error => finish(error))
  })
}
export async function readNativeHistory({ rpc, sessionId, maxPages = 100, maxMessages = 100, deadline = Date.now() + 30000, signal }) {
  if (!Number.isFinite(deadline)) fail('finite_deadline_required')
  const pages = []; let beforeSeq; let projections
  const collected = partial => {
    const events = pages.flatMap(p => p.events).sort((a, b) => a.event.seq - b.event.seq)
    if (new Set(events.map(r => r.event.seq)).size !== events.length) fail('history_duplicate_sequence')
    return { events, hasMore: partial, projections, ...(partial ? { partial: true } : {}) }
  }
  for (let i = 0; i < maxPages; i++) {
    if (Date.now() >= deadline || signal?.aborted) return collected(true)
    let page
    try { page = await withinDeadline(boundedSignal => rpc('session.history', { sessionId, maxMessages, ...(beforeSeq === undefined ? {} : { beforeSeq }) }, { deadline, signal: boundedSignal }), { deadline, signal }) }
    catch (error) { if (error.code === 'deadline_exceeded' || signal?.aborted) return collected(true); throw error }
    if (!Array.isArray(page?.events) || typeof page.hasMore !== 'boolean' || page.events.some(r => !Number.isInteger(r.event?.seq) || r.event.seq < 0)) fail('history_schema_invalid')
    if (page.projections) projections = page.projections
    const minimum = Math.min(...page.events.map(r => r.event.seq))
    if (page.hasMore && (!page.events.length || (beforeSeq !== undefined && minimum >= beforeSeq))) fail('history_pagination_stalled')
    pages.push(page)
    if (!page.hasMore) return collected(false)
    beforeSeq = minimum
  }
  fail('history_pagination_limit')
}
export async function readNativeAttachment({ rpc, sessionId, attachmentId, expectedSha256 }) {
  const result = await rpc('session.attachment', { sessionId, attachmentId }); const ref = result?.attachment
  if (!ref || ref.attachmentId !== attachmentId || ref.mediaType !== 'image/png' || typeof result.data !== 'string') fail('attachment_mismatch')
  const bytes = Buffer.from(result.data, 'base64')
  if (bytes.length < 33 || bytes.length !== ref.bytes || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== ref.width || bytes.readUInt32BE(20) !== ref.height || sha(bytes) !== expectedSha256) fail('attachment_png_sha256_mismatch')
  return { attachment: ref, bytes, sha256: sha(bytes) }
}
function assertPreservation(input) {
  const identity = value => typeof value === 'string' && value.trim() === value && value.length > 0 && !value.includes('\0')
  const classes = [
    ['source', 'sourcePaths', row => row?.path, true],
    ['protected', 'protectedPageIds', row => row?.pageId, true],
    ['sourceHistory', 'sourceHistoryPaths', row => row?.path, true],
    ['workflows', 'workflowRunIds', row => row?.runId ?? row?.id, false],
  ]
  for (const [kind, scope, getId, needsHash] of classes) {
    const expected = input.expectedPreservation?.[scope]
    if (!Array.isArray(expected) || !expected.length || expected.some(id => !identity(id)) || new Set(expected).size !== expected.length) fail(`${kind}_expected_scope_invalid`)
    const index = rows => {
      if (!Array.isArray(rows) || rows.length !== expected.length) fail(`${kind}_preservation_not_verified`)
      const indexed = new Map()
      for (const row of rows) {
        const id = getId(row)
        if (!identity(id) || indexed.has(id) || !expected.includes(id) || (needsHash && (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)))) fail(`${kind}_preservation_identity_or_hash_invalid`)
        if (!needsHash && row.runId !== undefined && row.id !== undefined && row.runId !== row.id) fail('workflows_preservation_identity_or_hash_invalid')
        indexed.set(id, row)
      }
      return indexed
    }
    const before = index(input.preservation?.[`${kind}Before`]); const after = index(input.preservation?.[`${kind}After`])
    if (expected.some(id => !same(before.get(id), after.get(id)))) fail(`${kind}_preservation_not_verified`)
  }
}
export function verifyDesignTrace(input) {
  if (!input.effectiveInput?.includes('image')) return { status: 'visual_not_executed', reasons: ['effective_model_has_no_image_input'] }
  try {
    const { history, candidates, proposals, savedLayoutRef, attachmentReadbacks, preservation } = input
    if (!Array.isArray(history?.events) || history.hasMore !== false || !Array.isArray(candidates) || !Array.isArray(proposals)) fail('complete_native_evidence_required')
    const calls = new Map(); const completed = []; let lastSeq = -1
    for (const { event } of history.events) {
      if (!Number.isInteger(event?.seq) || event.seq <= lastSeq) fail('invalid_event_sequence')
      lastSeq = event.seq
      if (event.type === 'tool/call') {
        const d = event.data
        if (!d?.callId || calls.has(d.callId)) fail('invalid_tool_call_identity')
        calls.set(d.callId, { name: d.name, args: JSON.parse(d.arguments), seq: event.seq })
      }
      if (event.type === 'tool/result') for (const block of event.data?.message?.content ?? []) {
        if (block.type !== 'tool-result') continue
        const call = calls.get(block.toolCallId)
        if (!call || call.resultSeq !== undefined) fail('unmatched_tool_result')
        call.resultSeq = event.seq
        if (block.isError || !String(call.name).startsWith('studio_')) continue
        const texts = (block.content ?? []).filter(b => b.type === 'text')
        let value
        try { value = texts.length === 1 ? JSON.parse(texts[0].text) : null } catch { continue }
        completed.push({ ...call, value, images: (block.content ?? []).filter(b => b.type === 'image').map(b => b.attachment) })
      }
    }
    const matches = c => c.sessionId === input.sessionId && c.projectId === input.projectId && c.pageId === input.pageId && c.runId === input.runId
    const chain = candidates.filter(matches).map(candidate => {
      const prepared = completed.find(c => c.name === 'studio_prepare_layout_candidate' && c.value?.candidateId === candidate.candidateId && c.value.candidateSha === candidate.candidateSha && c.args.runId === input.runId && c.args.pageId === input.pageId)
      const rendered = completed.find(c => c.name === 'studio_render_layout_preview' && c.args.candidateId === candidate.candidateId && c.args.candidateSha === candidate.candidateSha && c.value?.preview?.sha256 === candidate.preview?.sha256 && c.value.preview.fingerprint === candidate.preview.fingerprint && c.images.length === 1)
      const observed = completed.find(c => c.name === 'studio_submit_layout_review' && c.args.candidateId === candidate.candidateId && c.args.candidateSha === candidate.candidateSha && c.args.previewFingerprint === candidate.preview?.fingerprint && typeof c.args.observations === 'string' && c.args.observations.trim() && c.value?.id)
      if (!prepared || !rendered || !observed || !(prepared.resultSeq < rendered.seq && rendered.resultSeq < observed.seq)) return null
      const image = rendered.images[0]
      const readback = attachmentReadbacks?.find(r => r.attachment?.attachmentId === image.attachmentId)
      if (image.mediaType !== 'image/png' || !readback || readback.attachment.mediaType !== 'image/png' || readback.sha256 !== candidate.preview.sha256 || !(readback.bytes instanceof Uint8Array)) return null
      const bytes = Buffer.from(readback.bytes)
      if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || sha(bytes) !== candidate.preview.sha256) return null
      return { candidate, prepared, rendered, observed, attachmentId: image.attachmentId }
    }).filter(Boolean).sort((a, b) => a.prepared.seq - b.prepared.seq)
    const pair = chain.flatMap((a, i) => chain.slice(i + 1).map(b => [a, b])).find(([a, b]) => a.candidate.candidateSha !== b.candidate.candidateSha && a.observed.resultSeq < b.prepared.seq && b.candidate.status === 'applied')
    if (!pair) fail('observed_refinement_chain_missing')
    const second = pair[1].candidate
    const accepted = proposals.find(p => p.candidateId === second.candidateId && p.candidateSha === second.candidateSha && p.status === 'accepted' && p.sessionId === input.sessionId && p.projectId === input.projectId && p.pageId === input.pageId && p.previewFingerprint === second.preview.fingerprint)
    if (!accepted || pair[1].observed.value.id !== accepted.id || savedLayoutRef?.sha256 !== second.candidateSha || savedLayoutRef.pageId !== input.pageId || savedLayoutRef.projectId !== input.projectId || !(input.savedLayoutBytes instanceof Uint8Array) || sha(input.savedLayoutBytes) !== second.candidateSha) fail('accepted_saved_candidate_mismatch')
    assertPreservation(input)
    if (preservation.workflowsBefore.length !== (input.expectedCompletedWorkItems ?? 57) || preservation.workflowsBefore.some(row => !['confirmed', 'not_applicable'].includes(row.status))) fail('frozen_workflow_count_mismatch')
    return { status: 'evidence_chain_verified', visualQuality: 'not_verified', reasons: ['structured_tool_observations_do_not_prove_visual_quality'], candidateIds: pair.map(c => c.candidate.candidateId), attachmentIds: pair.map(c => c.attachmentId), acceptedSha256: second.candidateSha }
  } catch (e) { return { status: 'not_verified', reasons: [e.code ?? 'malformed_trace'] } }
}

function commandSpec(prepared, args, timeoutMs = 180000) {
  return { command: process.execPath, args: [prepared.dshBin, ...args], cwd: prepared.home, env: isolatedEnvironment(prepared.home, prepared.env), shell: false, windowsHide: true, timeoutMs }
}
export function runNodeCommand(spec, { spawnImpl = spawn } = {}) {
  return new Promise((done, reject) => {
    const child = spawnImpl(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''; let settled = false
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : done(value) }
    const timer = setTimeout(() => { child.kill(); finish(Object.assign(new Error('isolated_child_timeout'), { code: 'isolated_child_timeout' })) }, spec.timeoutMs ?? 180000)
    child.stdout.on('data', c => { stdout += c; if (stdout.length > 8_000_000) { child.kill(); finish(new Error('isolated_child_output_limit')) } })
    child.stderr.on('data', c => { stderr += c; if (stderr.length > 8_000_000) { child.kill(); finish(new Error('isolated_child_output_limit')) } })
    child.once('error', () => finish(new Error('isolated_child_start_failed')))
    child.once('close', code => finish(code === 0 ? null : new Error(`isolated_child_exit_${code}`), { code, stdout, stderr }))
  })
}
export async function installIsolatedPlugins({ prepared, run = runNodeCommand }) {
  requireApprovedHashes(prepared)
  await noLinks(prepared.home); await checkedFile(prepared.fixtureReportPath, prepared.fixtureReportSha256)
  for (const pkg of prepared.packages) await checkedFile(pkg.path, pkg.sha256)
  for (const pkg of prepared.packages) await run(commandSpec(prepared, ['plugin', '--profile', 'web', 'add', '--workspace-root', pkg.path], 600000))
  return { installed: true, packages: prepared.packages.map(({ role, sha256 }) => ({ role, sha256 })), actualModelRun: false }
}
export function assertIsolatedConfig({ prepared, rows }) {
  const flat = []; const walk = row => { if (Array.isArray(row)) return row.forEach(walk); if (!row || typeof row !== 'object') return; if (typeof row.id === 'string') flat.push(row); for (const key of ['plugins', 'children', 'group', 'insert']) if (row[key]) walk(row[key]) }; walk(rows)
  const expected = { settings: ['path', prepared.paths.settings], credentials: ['path', prepared.paths.credentials], 'session-persistence-jsonl': ['root', prepared.paths.sessions], 'storage-json': ['root', prepared.paths.storages], 'attachment-local': ['dshHome', prepared.home], 'report-studio-dsh': ['dataDir', prepared.paths.studio] }
  for (const [id, [key, value]] of Object.entries(expected)) {
    const matched = flat.filter(r => r.id === id)
    if (matched.length !== 1 || typeof matched[0].config?.[key] !== 'string' || resolve(matched[0].config[key]) !== resolve(value)) fail('config_path_not_isolated')
  }
  for (const name of ['@architectureworld/report-studio-dsh', '@architectureworld/dsh-preplanning-agent']) if (!flat.some(r => r.name === name)) fail('required_plugin_missing')
  return { isolated: true, checkedPathCount: Object.keys(expected).length, actualModelRun: false }
}
export async function dumpAndVerifyConfig({ prepared, run = runNodeCommand, parseDocument }) {
  const result = await run(commandSpec(prepared, ['--profile', 'web', '--patch', prepared.paths.patch, '--dump-config']))
  // !!js tags remain inert in --dump-config; parser must never evaluate code.
  const parser = parseDocument ?? createRequire(prepared.dshBin)('yaml').parse
  const rows = parser(result.stdout)
  return assertIsolatedConfig({ prepared, rows })
}
function loopback(baseUrl) {
  const url = new URL(baseUrl)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.port === '3080' || url.username || url.password) fail('isolated_loopback_required')
  return url.origin
}
export function nativeRpc({ baseUrl, fetchImpl = fetch, timeoutMs = 15000 }) {
  const origin = loopback(baseUrl)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail('finite_rpc_timeout_required')
  return async (method, payload, budget = {}) => {
    if (!['session.create', 'session.list', 'session.history', 'session.attachment', 'session.prompt', 'session.models'].includes(method)) fail('unsupported_native_rpc')
    const deadline = Math.min(Date.now() + timeoutMs, budget.deadline ?? Infinity)
    return withinDeadline(async signal => {
      const response = await fetchImpl(`${origin}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }), signal })
      if (!response.ok) fail('native_rpc_http_failed')
      const result = await response.json()
      if (result?.result?.ok !== true) fail('native_rpc_rejected')
      return result.result.value
    }, { deadline, signal: budget.signal })
  }
}
export async function createNativeSession({ rpc, sessionId, cwd }) {
  const created = await rpc('session.create', { sessionId, cwd })
  if (created?.sessionId !== sessionId) fail('session_identity_mismatch_no_automatic_remap')
  const listed = await rpc('session.list', {})
  const session = listed?.items?.find(row => row.sessionId === sessionId)
  if (!session?.cwd || resolve(session.cwd) !== resolve(cwd)) fail('session_workspace_mismatch')
  return { sessionId, cwd: session.cwd, actualModelRun: false }
}

export async function reserveLoopbackPort() {
  const server = net.createServer()
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const port = server.address().port
  let released = false
  const release = async () => { if (released) return; released = true; await new Promise((done, reject) => server.close(e => e ? reject(e) : done())) }
  if (port === 3080) { await release(); fail('isolated_loopback_required') }
  return { port, release }
}
export async function launchIsolatedHost({ prepared, spawnImpl = spawn }) {
  await noLinks(prepared.home); await checkedFile(prepared.fixtureReportPath, prepared.fixtureReportSha256)
  const reservation = await reserveLoopbackPort()
  const spec = commandSpec(prepared, ['--profile', 'web', '--patch', prepared.paths.patch, '--port', String(reservation.port), '--no-open'])
  // DSH does not accept a prebound socket; release only immediately before spawn.
  await reservation.release()
  const child = spawnImpl(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let exited = false; let failed = false; let logBytes = 0
  child.once('error', () => { failed = true })
  child.once('exit', () => { exited = true })
  // Raw logs can contain private model content: drain without displaying/persisting.
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { logBytes += chunk.length })
  const stop = async () => {
    if (exited || child.exitCode !== null) return
    let done; const completion = new Promise(resolve => { done = resolve; child.once('exit', resolve) })
    child.kill('SIGTERM')
    let timer; await Promise.race([completion, new Promise(resolve => { timer = setTimeout(resolve, 5000) })]); clearTimeout(timer)
    if (!exited && child.exitCode === null) child.kill('SIGKILL')
    child.removeListener('exit', done)
  }
  return { baseUrl: `http://127.0.0.1:${reservation.port}`, pid: child.pid, actualHostRun: true, actualModelRun: false, status: () => ({ exited, failed, logBytes }), stop }
}

export async function verifyNativeHost({ baseUrl, sessionId, fetchImpl = fetch }) {
  const origin = loopback(baseUrl)
  const get = async path => {
    const response = await fetchImpl(`${origin}${path}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) fail('native_host_route_failed')
    return response
  }
  const health = await (await get(`/report-studio/api/health?sessionId=${encodeURIComponent(sessionId)}`)).json()
  if (health.agentMode !== 'dsh-native' || health.agentConfigured !== true || health.migrationStatus !== 'ready' || health.securityMode !== 'local-single-user-only' || health.listenHost !== '127.0.0.1' || health.networkSharedSecurity !== false) fail('native_health_mismatch')
  const shell = await (await get('/')).text()
  const page = await (await get(`/report-studio/?sessionId=${encodeURIComponent(sessionId)}`)).text()
  const bridge = await (await get('/report-studio/dsh-native-runtime.js')).text()
  if (!shell.toLowerCase().includes('<!doctype html>') || !page.includes('report-studio-standalone-notice') || !bridge.includes('report-studio.prompt')) fail('native_production_ui_missing')
  return { nativeHostVerified: true, nativeBridgeServed: true, browserInteractionVerified: false, actualModelRun: false }
}
export async function pollNativeCompletion({ rpc, sessionId, afterSeq, timeoutMs = 30000, intervalMs = 500, signal }) {
  if (!Number.isInteger(afterSeq) || afterSeq < -1 || !Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60000 || !Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 60000) fail('bounded_poll_arguments_required')
  const deadline = Date.now() + timeoutMs
  let history = { events: [], hasMore: true, partial: true }
  while (Date.now() < deadline && !signal?.aborted) {
    history = await readNativeHistory({ rpc, sessionId, deadline, signal })
    if (history.partial || Date.now() >= deadline || signal?.aborted) break
    let sessions
    try { sessions = await withinDeadline(boundedSignal => rpc('session.list', {}, { deadline, signal: boundedSignal }), { deadline, signal }) }
    catch (error) { if (error.code === 'deadline_exceeded' || signal?.aborted) break; throw error }
    const session = sessions?.items?.find(r => r.sessionId === sessionId)
    const terminal = history.events.find(r => r.event.seq > afterSeq && r.event.type === 'turn/end')
    if (terminal && session?.running === false) return { status: 'turn_ended', history, terminalSeq: terminal.event.seq, visualAcceptance: 'not_verified' }
    if (Date.now() >= deadline) break
    await new Promise(done => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); done() }
      const timer = setTimeout(finish, Math.min(intervalMs, deadline - Date.now())); signal?.addEventListener('abort', finish, { once: true })
    })
  }
  return { status: 'not_completed', history, visualAcceptance: 'not_verified' }
}
export async function verifyInstalledPackageContract({ prepared, studioRoot, preRoot }) {
  for (const root of [studioRoot, preRoot]) { if (!inside(prepared.home, absolute(root))) fail('installed_package_containment'); await noLinks(root) }
  const manifests = await Promise.all([studioRoot, preRoot].map(async root => JSON.parse(await checkedFile(join(root, 'package.json')))))
  if (manifests[0].name !== '@architectureworld/report-studio-dsh' || manifests[1].name !== '@architectureworld/dsh-preplanning-agent' || manifests[0].dependencies?.['playwright-core'] !== '1.63.0') fail('installed_package_identity_or_renderer_dependency')
  const modules = [
    [studioRoot, 'lib/index.js', 'apply'],
    [studioRoot, 'lib/design-tools.js', 'registerDesignTools'],
    [studioRoot, 'lib/runtime.js', 'createStudioDshRuntime'],
    [studioRoot, 'lib/isolated-worker.js', 'createDshReviewWorker'],
    [studioRoot, 'vendor/apps/studio-local/layout-preview.mjs', 'createLayoutPreviewRenderer'],
    [studioRoot, 'vendor/apps/studio-local/design-rules.mjs', 'getDesignRules'],
    [preRoot, 'lib/index.js', 'apply'],
  ]
  const hashes = []
  for (const [root, file, symbol] of modules) {
    const path = join(root, file); const bytes = await checkedFile(path)
    const module = await import(pathToFileURL(path).href)
    if (typeof module[symbol] !== 'function') fail('installed_package_api_missing')
    hashes.push({ package: root === studioRoot ? manifests[0].name : manifests[1].name, file, sha256: sha(bytes) })
  }
  const rules = await import(pathToFileURL(join(studioRoot, 'vendor/apps/studio-local/design-rules.mjs')).href)
  if (rules.getDesignRules()?.rendererLimits?.actualRenderingRequiredForVisualAcceptance !== true) fail('installed_design_rules_missing')
  return { imported: true, files: hashes, runtimeRegistrationVerified: false, preDefaultPathsVerified: false, expectedPreRoots: { presentation: prepared.paths.presentation, visualAssets: prepared.paths.visualAssets, reportPackages: prepared.paths.reportPackages, clientProfiles: prepared.paths.clientProfiles }, actualHostRun: false, actualModelRun: false }
}
