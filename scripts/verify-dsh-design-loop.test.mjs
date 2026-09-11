import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { realpath, mkdtemp, mkdir, readFile, writeFile, cp, rm, symlink, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { readWorkspaceSnapshot } from '../apps/studio-local/workspace-live-link.mjs'
import { createStudioDshRuntime } from '../packages/studio-dsh-plugin/lib/runtime.js'
import { createRepository } from '../apps/studio-local/repository.mjs'
import { createLayoutService } from '../apps/studio-local/layout-service.mjs'
import { createLayoutPage, addLiveLayoutElement } from '../packages/studio-layout-core/index.mjs'
import { createStudioId } from '../packages/studio-contracts/index.mjs'
const api = await import('./verify-dsh-design-loop.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e })
const hash = x => createHash('sha256').update(x).digest('hex')
const json = async (p, x) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(x)) }
async function fixture(t) {
  // The runner may expose an 8.3 alias (RUNNER~1). Canonicalize only OUR fixture parent.
  const fixtureParent = await realpath(tmpdir())
  const root = await mkdtemp(join(fixtureParent, 'dsh-design-loop-unit-'))
  t.after(async () => { assert.equal(dirname(root), fixtureParent); await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) })
  const fixtureRoot = join(root, 'fixture'); await mkdir(fixtureRoot)
  const workspace = join(fixtureRoot, 'workspace')
  await cp(new URL('../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief', import.meta.url), workspace, { recursive: true })
  const blobs = {}
  const current = await readWorkspaceSnapshot(workspace, { putBlob: async (stream, metadata) => {
    const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks); const sha256 = hash(bytes); const path = join(fixtureRoot, sha256)
    await writeFile(path, bytes); blobs[sha256] = path
    return { sha256, sizeBytes: bytes.length, mimeType: metadata.mimeType }
  } })
  assert.equal(current.status, 'connected')
  const snapshot = current.snapshot
  const names = ['preplanning_agent', 'preplanning_governance', 'preplanning_presentation', 'preplanning_synthetic_boundary_fingerprints']
  const preStorages = {}
  for (const name of names) { preStorages[name] = join(fixtureRoot, `${name}.json`); await json(preStorages[name], { unit: { name, version: 1 }, global: {}, tables: {} }) }
  await json(preStorages.preplanning_agent, { tables: { bindings: { 'test-session': { sessionId: 'test-session', projectId: 'test-pre' } } } })
  await json(preStorages.preplanning_governance, { tables: { workflow_runs: Object.fromEntries(Array.from({ length: 57 }, (_, i) => [String(i), { status: 'confirmed', attempt: 1 }])) } })
  const studioSeed = join(fixtureRoot, 'studio.json')
  const operational = { annotations: [], reviewRounds: [], reviewSubmissions: [], reviewRuns: [], proposals: [], revisions: [], project: { updatedAt: '2026-09-06T00:00:00.000Z' } }
  operational.reviewRounds.push({ id: createStudioId('reviewRound'), projectId: snapshot.project.id, scopeKey: `draft:${snapshot.pages[0].id}`, stage: 'draft', pageId: snapshot.pages[0].id, status: 'open', createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z' })
  await json(studioSeed, { snapshot, operational, revision: 0 })
  const manualLayoutSeed = join(fixtureRoot, 'layout.json')
  const page = snapshot.pages[1]
  let layout = createLayoutPage({ projectId: snapshot.project.id, pageId: page.id, baseDraftRevision: 0 })
  layout = addLiveLayoutElement(layout, { type: 'text', sourceRef: { kind: 'content-block', contentBlockId: page.contentBlocks[0].contentBlockId }, frame: { x: 31, y: 47, width: 412, height: 99, rotation: 0 }, style: { fontSize: 29 }, zIndex: 0 })
  await json(manualLayoutSeed, layout)
  const report = { identities: { studioProjectId: snapshot.project.id, preProjectId: 'test-pre', sessionId: 'test-session' }, paths: { workspace, studioSeed, preStorages, manualLayoutSeed, blobs: {} }, provenance: { readOnly: true, sourceStudioRevision: 111, sourcePreRevision: 59, historicalSnapshots: [], historicalContentImported: false, historicalDesignScopeGranted: false }, integrity: { sourcesUnchanged: true, outputAssetsVerified: true }, hostInstalled: false }
  report.paths.blobs = blobs
  const fixtureReportPath = join(fixtureRoot, 'fixture-report.json'); await json(fixtureReportPath, report)
  const settingsSourcePath = join(root, 'source-settings.json'); const credentialsSourcePath = join(root, 'source-auth.json')
  const provider = { api: 'openai-completions', baseURL: 'http://127.0.0.1:8046', apiKeyEnv: 'TEST_KEY', models: [{ id: 'original-model', name: 'Original' }] }
  await json(settingsSourcePath, { 'llm-pi-ai': { providers: { selected: provider, unrelated: { secret: 'do-not-copy' } } }, 'agent-default-model': { provider: 'selected', model: 'original-model' }, private: 'do-not-copy' })
  await json(credentialsSourcePath, { version: 1, refs: { TEST_KEY: 'synthetic-secret', OTHER: 'do-not-copy' }, records: { unrelated: { secret: 'do-not-copy' } } })
  const packages = []
  for (const role of ['studio', 'pre']) { const path = join(root, `${role}.tgz`); await writeFile(path, role); packages.push({ role, path, sha256: hash(role) }) }
  const dshBin = join(root, 'bin.js'); await writeFile(dshBin, '// synthetic nonexecuted boundary')
  return { root, report, layout, operational, input: { containmentRoot: root, home: join(root, 'home'), fixtureReportPath, fixtureReportSha256: hash(await readFile(fixtureReportPath)), settingsSourcePath, credentialsSourcePath, packages, dshBin, parseDocument: JSON.parse, environment: { PATH: 'system-path', SystemRoot: 'system-root', USERPROFILE: 'never-copy', HOME: 'never-copy', OPENAI_API_KEY: 'never-copy', NODE_OPTIONS: '--require bad', PRE_DESIGN_PRESENTATION_PROJECT_ROOT: 'never-copy', HTTP_PROXY: 'never-copy' } } }
}
function required(name) { assert.equal(typeof api[name], 'function', `${name} API must exist`); return api[name] }

test('rejects existing, outside, ancestor and junction destinations before copying private route', async t => {
  const f = await fixture(t); const prepare = required('prepareIsolation')
  await mkdir(join(f.root, 'existing')); await symlink(join(f.root, 'fixture'), join(f.root, 'alias'), 'junction')
  for (const home of [f.root, dirname(f.root), join(f.root, 'existing'), join(f.root, 'alias', 'nested'), join(f.root, 'fixture', 'nested')]) await assert.rejects(prepare({ ...f.input, home }), /contain|exist|overlap|symlink|reparse/)
  await assert.rejects(access(f.input.home))
})
test('package mismatch and changed report reject before destination creation', async t => {
  const f = await fixture(t); const prepare = required('prepareIsolation')
  await assert.rejects(prepare({ ...f.input, packages: f.input.packages.map(p => ({ ...p, sha256: '0'.repeat(64) })) }), /sha256/)
  await assert.rejects(prepare({ ...f.input, fixtureReportSha256: '0'.repeat(64) }), /sha256/)
  await assert.rejects(access(f.input.home))
})
test('required report and package SHA cannot be omitted before preparation or install', async t => {
  const f = await fixture(t)
  for (const omitted of ['report', 'studio', 'pre']) {
    const input = { ...f.input, packages: f.input.packages.map(p => ({ ...p })) }
    if (omitted === 'report') delete input.fixtureReportSha256
    else delete input.packages.find(p => p.role === omitted).sha256
    let privateReads = 0; input.parseDocument = text => { privateReads++; return JSON.parse(text) }
    await assert.rejects(api.prepareIsolation(input), /required_sha256/)
    assert.equal(privateReads, 0)
    await assert.rejects(access(f.input.home))
  }
  const prepared = await api.prepareIsolation(f.input)
  for (const omitted of ['report', 'studio', 'pre']) {
    const changed = structuredClone(prepared)
    if (omitted === 'report') delete changed.fixtureReportSha256
    else delete changed.packages.find(p => p.role === omitted).sha256
    let installs = 0
    await assert.rejects(api.installIsolatedPlugins({ prepared: changed, run: async () => { installs++ } }), /required_sha256/)
    assert.equal(installs, 0)
  }
})
test('copies only exact route and referenced credential, whitelists env, defaults no model', async t => {
  const f = await fixture(t); const prepared = await required('prepareIsolation')(f.input)
  const settings = JSON.parse(await readFile(prepared.paths.settings, 'utf8'))
  assert.deepEqual(Object.keys(settings), ['llm-pi-ai', 'agent-default-model'])
  assert.deepEqual(Object.keys(settings['llm-pi-ai'].providers), ['selected'])
  assert.deepEqual(settings['llm-pi-ai'].providers.selected.models, [{ id: 'original-model', name: 'Original' }])
  assert.deepEqual(JSON.parse(await readFile(prepared.paths.credentials, 'utf8')), { version: 1, refs: { TEST_KEY: 'synthetic-secret' }, records: {} })
  assert.deepEqual(Object.keys(prepared.env).sort(), ['CI', 'DSH_HOME', 'NO_COLOR', 'PATH', 'SystemRoot'].sort())
  assert.equal(prepared.actualModelRun, false)
  assert.equal(JSON.stringify(prepared).includes('synthetic-secret'), false)
  await assert.rejects(required('dispatchModelPrompt')({ prepared, text: 'test' }), /explicit/)
  const patch = JSON.parse(await readFile(prepared.paths.patch, 'utf8'))
  assert.equal(patch.find(r => r.id === 'storage-json').config.root, join(f.input.home, 'storages'))
})
test('rejects credential records fallback, missing ref and embedded secret provider fields', async t => {
  const f = await fixture(t); const prepare = required('prepareIsolation')
  await json(f.input.credentialsSourcePath, { version: 1, refs: {}, records: { TEST_KEY: 'synthetic-secret' } })
  await assert.rejects(prepare(f.input), /credential_ref/)
  await assert.rejects(access(f.input.home))
  await json(f.input.credentialsSourcePath, { version: 1, refs: { TEST_KEY: 'synthetic-secret' }, records: {} })
  const settings = JSON.parse(await readFile(f.input.settingsSourcePath)); settings['llm-pi-ai'].providers.selected.apiKey = 'embedded-secret'
  await json(f.input.settingsSourcePath, settings)
  await assert.rejects(prepare(f.input), /unsupported_provider_field/)
})
test('seeds actual repository and layout store; first real watcher preserves operational state and genuine revision zero', async t => {
  const f = await fixture(t); const prepared = await required('prepareIsolation')(f.input)
  const seeded = await required('seedIsolatedRepository')(prepared)
  assert.match(seeded.fingerprint, /^[a-f0-9]{64}$/)
  const runtime = createStudioDshRuntime({ dataRoot: prepared.paths.studio, sessions: { get: () => ({ header: { cwd: f.report.paths.workspace } }) } })
  try {
    const repository = await runtime.repositoryFor('test-session')
    const state = repository.getState()
    assert.equal(state.revisions[0].number, 0)
    assert.equal(state.revisions[0].detail.fingerprint, seeded.fingerprint)
    assert.deepEqual(state.reviewRounds, f.operational.reviewRounds)
    assert.equal(state.project.currentRevision, seeded.revision)
    assert.equal((await runtime.workspaceStatus('test-session')).appliedFingerprint, seeded.fingerprint)
    const stored = await createLayoutService({ repository, layoutRoot: join(f.report.paths.workspace, 'layouts') }).get({ pageId: f.layout.pageId })
    assert.deepEqual(stored.layout.elements[0].frame, f.layout.elements[0].frame)
    assert.deepEqual(stored.layout.elements[0].style, f.layout.elements[0].style)
    assert.equal(stored.stale, false)
  } finally { await runtime.close() }
})
test('history reader follows beforeSeq and attachment readback verifies native attachmentId and PNG hash', async () => {
  const read = required('readNativeHistory'); const requested = []
  const rpc = async (method, payload) => { requested.push(payload); return payload.beforeSeq === undefined ? { events: [{ event: { seq: 3 } }, { event: { seq: 4 } }], hasMore: true } : { events: [{ event: { seq: 0 } }, { event: { seq: 1 } }], hasMore: false } }
  const result = await read({ rpc, sessionId: 'session' })
  assert.deepEqual(result.events.map(r => r.event.seq), [0, 1, 3, 4]); assert.equal(requested[1].beforeSeq, 3)
  await assert.rejects(read({ rpc: async () => ({ events: [], hasMore: true }), sessionId: 'session' }), /pagination/)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh0sAAAAASUVORK5CYII=', 'base64')
  const attachmentRpc = async () => ({ attachment: { attachmentId: 'attachment-one', mediaType: 'image/png', bytes: png.length, width: 1, height: 1 }, data: png.toString('base64') })
  const image = await required('readNativeAttachment')({ rpc: attachmentRpc, sessionId: 'session', attachmentId: 'attachment-one', expectedSha256: hash(png) })
  assert.equal(image.sha256, hash(png))
  await assert.rejects(api.readNativeAttachment({ rpc: attachmentRpc, sessionId: 'session', attachmentId: 'wrong', expectedSha256: hash(png) }), /attachment/)
})
test('partial and text-only traces cannot pass visual acceptance', () => {
  const verify = required('verifyDesignTrace')
  assert.equal(verify({ effectiveInput: ['text'] }).status, 'visual_not_executed')
  assert.equal(verify({ effectiveInput: ['text', 'image'], history: { events: [], hasMore: false } }).status, 'not_verified')
})

test('isolated install uses node argv and sealed environment, never shell text or model dispatch', async t => {
  const f = await fixture(t); const prepared = await required('prepareIsolation')(f.input)
  const calls = []; const run = async spec => { calls.push(spec); return { stdout: '', stderr: '', code: 0 } }
  const result = await required('installIsolatedPlugins')({ prepared, run })
  assert.equal(result.installed, true); assert.equal(calls.length, 2)
  for (const spec of calls) {
    assert.equal(spec.command, process.execPath); assert.equal(spec.cwd, prepared.home)
    assert.equal(spec.windowsHide, true); assert.equal(spec.shell, false)
    assert.deepEqual(spec.args.slice(1, 6), ['plugin', '--profile', 'web', 'add', '--workspace-root'])
    assert.equal(spec.env.USERPROFILE, undefined); assert.equal(spec.env.NODE_OPTIONS, undefined)
  }
  await writeFile(f.input.packages[0].path, 'tampered')
  await assert.rejects(api.installIsolatedPlugins({ prepared, run }), /sha256/)
})
test('composed config requires exact isolated path overrides and both plugin registrations', async t => {
  const f = await fixture(t); const prepared = await required('prepareIsolation')(f.input)
  const rows = JSON.parse(await readFile(prepared.paths.patch, 'utf8'))
  rows.find(r => r.id === 'report-studio-dsh').name = '@architectureworld/report-studio-dsh'
  rows.push({ id: 'preplanning-agent', name: '@architectureworld/dsh-preplanning-agent' })
  assert.equal(required('assertIsolatedConfig')({ prepared, rows }).isolated, true)
  rows.find(r => r.id === 'storage-json').config.root = dirname(prepared.home)
  assert.throws(() => api.assertIsolatedConfig({ prepared, rows }), /config_path/)
})
test('native rpc emits real envelope, session create verifies requested id and cwd by list', async () => {
  const calls = []
  const rpc = required('nativeRpc')({ baseUrl: 'http://127.0.0.1:54321', fetchImpl: async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ result: { ok: true, value: { accepted: true } } }) } } })
  assert.deepEqual(await rpc('session.prompt', { content: [] }), { accepted: true })
  assert.equal(calls[0].type, 'client-request'); assert.equal(calls[0].method, 'session.prompt')
  assert.throws(() => api.nativeRpc({ baseUrl: 'http://127.0.0.1:3080' }), /loopback/)
  await assert.rejects(required('createNativeSession')({ rpc: async method => method === 'session.create' ? { sessionId: 'wrong' } : {}, sessionId: 'requested', cwd: resolve(tmpdir()) }), /session_identity/)
})
function traceFixtureRecords() {
  const layoutBytes = Buffer.from('{"syntheticLayout":2}'); const a = 'a'.repeat(64), b = hash(layoutBytes), fp = 'd'.repeat(64)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh0sAAAAASUVORK5CYII=', 'base64'); const pngSha = hash(png)
  const candidates = [1, 2].map(i => ({ candidateId: `candidate-${i}`, candidateSha: i === 1 ? a : b, sessionId: 'session', projectId: 'project', pageId: 'page', runId: 'run', preview: { sha256: pngSha, fingerprint: fp }, status: i === 2 ? 'applied' : 'previewed' }))
  const events = []; let seq = 0
  const tool = (name, args, value, image) => { const callId = `call-${seq}`; events.push({ event: { type: 'tool/call', seq: seq++, time: seq, data: { callId, name, arguments: JSON.stringify(args) } } }); const content = [{ type: 'text', text: JSON.stringify(value) }]; if (image) content.push({ type: 'image', attachment: { attachmentId: image, mediaType: 'image/png' } }); events.push({ event: { type: 'tool/result', seq: seq++, time: seq, data: { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: callId, isError: false, content }] } } } }); }
  for (const c of candidates) {
    tool('studio_prepare_layout_candidate', { runId: 'run', pageId: 'page', designIntent: 'Synthetic refinement' }, { candidateId: c.candidateId, candidateSha: c.candidateSha })
    tool('studio_render_layout_preview', { candidateId: c.candidateId, candidateSha: c.candidateSha }, { preview: c.preview }, `image-${c.candidateId}`)
    tool('studio_submit_layout_review', { candidateId: c.candidateId, candidateSha: c.candidateSha, previewFingerprint: fp, observations: 'Synthetic observed alignment issue and revision request.' }, { id: `proposal-${c.candidateId}`, status: c === candidates[1] ? 'accepted' : 'pending' })
  }
  const workflows = Array.from({ length: 57 }, (_, id) => ({ id: String(id), status: 'confirmed', attempt: 1 }))
  return { savedLayoutBytes: layoutBytes, effectiveInput: ['text', 'image'], history: { events, hasMore: false }, sessionId: 'session', projectId: 'project', pageId: 'page', runId: 'run', candidates, proposals: [{ id: 'proposal-candidate-2', candidateId: 'candidate-2', candidateSha: b, previewFingerprint: fp, sessionId: 'session', projectId: 'project', pageId: 'page', status: 'accepted' }], savedLayoutRef: { sha256: b, pageId: 'page', projectId: 'project' }, attachmentReadbacks: candidates.map(c => ({ bytes: png, attachment: { attachmentId: `image-${c.candidateId}`, mediaType: 'image/png' }, sha256: pngSha })), preservation: { sourceBefore: [{ path: 'source', sha256: a }], sourceAfter: [{ path: 'source', sha256: a }], protectedBefore: [{ pageId: 'protected', sha256: a }], protectedAfter: [{ pageId: 'protected', sha256: a }], workflowsBefore: workflows, workflowsAfter: structuredClone(workflows), sourceHistoryBefore: [{ path: 'history', sha256: b }], sourceHistoryAfter: [{ path: 'history', sha256: b }] } }
}
function traceFixture() {
  return { ...traceFixtureRecords(), expectedPreservation: { sourcePaths: ['source'], protectedPageIds: ['protected'], sourceHistoryPaths: ['history'], workflowRunIds: Array.from({ length: 57 }, (_, i) => String(i)) } }
}
test('coherent synthetic native chain verifies structural evidence only; malformed/partial chains fail closed', () => {
  const verify = required('verifyDesignTrace'); const input = traceFixture()
  assert.equal(verify(input).status, 'evidence_chain_verified')
  assert.equal(verify(input).visualQuality, 'not_verified')
  for (const mutate of [x => { x.history.events.splice(4, 2) }, x => { x.candidates[1].candidateSha = x.candidates[0].candidateSha }, x => { x.savedLayoutRef.sha256 = 'e'.repeat(64) }, x => { x.attachmentReadbacks = [] }, x => { x.history.hasMore = true }, x => { x.preservation.sourceAfter[0].sha256 = 'f'.repeat(64) }, x => { x.preservation.workflowsAfter[0].attempt = 2 }, x => { x.attachmentReadbacks[0].bytes = Buffer.from('not-png') }, x => { x.savedLayoutBytes = Buffer.from('wrong') }, x => { x.preservation.workflowsBefore = []; x.preservation.workflowsAfter = [] }]) {
    const changed = structuredClone(input); mutate(changed); assert.equal(verify(changed).status, 'not_verified')
  }
})
test('preservation evidence requires real unique identities, hashes and explicit expected coverage', () => {
  const baseline = traceFixture()
  baseline.expectedPreservation = { sourcePaths: ['source'], protectedPageIds: ['protected'], sourceHistoryPaths: ['history'], workflowRunIds: Array.from({ length: 57 }, (_, i) => String(i)) }
  assert.equal(api.verifyDesignTrace(baseline).status, 'evidence_chain_verified')
  const mutations = [
    x => { for (const key of ['source', 'protected', 'sourceHistory']) x.preservation[`${key}Before`] = x.preservation[`${key}After`] = [{}] },
    x => { delete x.expectedPreservation },
    x => { x.expectedPreservation.sourcePaths.push('missing-source') },
    x => { x.expectedPreservation.protectedPageIds.push('missing-page') },
    x => { x.expectedPreservation.sourceHistoryPaths.push('missing-history') },
    x => { x.expectedPreservation.sourcePaths = ['source', 'source'] },
    x => { x.preservation.sourceBefore.push(x.preservation.sourceBefore[0]); x.preservation.sourceAfter.push(x.preservation.sourceAfter[0]) },
    x => { x.preservation.sourceBefore[0].sha256 = x.preservation.sourceAfter[0].sha256 = 'not-a-sha' },
    x => { x.preservation.protectedBefore[0].pageId = x.preservation.protectedAfter[0].pageId = ' ' },
    x => { x.preservation.workflowsBefore = x.preservation.workflowsAfter = Array.from({ length: 57 }, () => ({ status: 'confirmed' })) },
    x => { x.preservation.workflowsBefore[1].id = x.preservation.workflowsAfter[1].id = '0' },
    x => { x.expectedPreservation.workflowRunIds[1] = 'foreign-run' },
  ]
  for (const mutate of mutations) { const input = structuredClone(baseline); mutate(input); assert.equal(api.verifyDesignTrace(input).status, 'not_verified') }
})

test('seed refuses source mutation after preparation and runnable imported work', async t => {
  const f = await fixture(t); const prepared = await required('prepareIsolation')(f.input)
  const source = f.report.paths.preStorages.preplanning_governance
  await json(source, { tables: { workflow_runs: { bad: { status: 'running' } } } })
  await assert.rejects(api.seedIsolatedRepository(prepared), /sha256|runnable/)
})
test('seed detects even non-runnable snapshot edits made after preparation', async t => {
  const f = await fixture(t); const prepared = await required('prepareIsolation')(f.input)
  const seed = JSON.parse(await readFile(f.report.paths.studioSeed)); seed.operational.project.updatedAt = '2026-09-07T00:00:00.000Z'
  await json(f.report.paths.studioSeed, seed)
  await assert.rejects(api.seedIsolatedRepository(prepared), /sha256/)
})
test('seed refuses partial completed workflow sets even when the report is freshly hashed', async t => {
  const f = await fixture(t)
  await json(f.report.paths.preStorages.preplanning_governance, { tables: { workflow_runs: { only: { status: 'confirmed' } } } })
  const prepared = await required('prepareIsolation')(f.input)
  await assert.rejects(api.seedIsolatedRepository(prepared), /completed_workflow_count/)
})
test('reserved loopback launch keeps only its child and stop never searches other processes', async t => {
  const f = await fixture(t); const prepared = await required('prepareIsolation')(f.input)
  const reserve = required('reserveLoopbackPort'); const reservation = await reserve()
  assert.notEqual(reservation.port, 3080)
  await reservation.release()
  const { EventEmitter } = await import('node:events'); const child = new EventEmitter(); child.pid = 12345; child.exitCode = null
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
  let kills = 0; child.kill = () => { kills++; child.exitCode = 0; child.emit('exit', 0) }
  let invocation
  const host = await required('launchIsolatedHost')({ prepared, spawnImpl: (...args) => { invocation = args; return child } })
  assert.equal(invocation[0], process.execPath); assert.equal(invocation[2].cwd, prepared.home)
  assert.equal(invocation[2].windowsHide, true); assert.equal(invocation[2].env.HOME, undefined)
  assert.equal(host.pid, 12345); assert.equal(host.actualModelRun, false)
  await host.stop(); assert.equal(kills, 1)
})
test('Host route verification checks native health and production bridge; completion poll does not treat queue acceptance as done', async () => {
  const verify = required('verifyNativeHost')
  const health = { agentMode: 'dsh-native', agentConfigured: true, migrationStatus: 'ready', securityMode: 'local-single-user-only', listenHost: '127.0.0.1', networkSharedSecurity: false }
  const fetchImpl = async url => ({ ok: true, json: async () => health, text: async () => url.includes('dsh-native-runtime.js') ? 'report-studio.prompt' : url.includes('/report-studio/?') ? 'report-studio-standalone-notice' : '<!doctype html>' })
  assert.equal((await verify({ baseUrl: 'http://127.0.0.1:54321', sessionId: 'session', fetchImpl })).nativeHostVerified, true)
  health.listenHost = '0.0.0.0'
  await assert.rejects(verify({ baseUrl: 'http://127.0.0.1:54321', sessionId: 'session', fetchImpl }), /native_health/)
  const result = await required('pollNativeCompletion')({ rpc: async method => method === 'session.history' ? { events: [], hasMore: false } : { items: [{ sessionId: 'session', running: false }] }, sessionId: 'session', afterSeq: -1, timeoutMs: 0 })
  assert.equal(result.status, 'not_completed')
})
test('poll validates finite budgets and zero budget starts no RPC', async () => {
  let calls = 0; const rpc = async method => { calls++; return method === 'session.history' ? { events: [], hasMore: false } : { items: [] } }
  for (const options of [{ timeoutMs: NaN }, { timeoutMs: Infinity }, { intervalMs: NaN }, { intervalMs: Infinity }, { intervalMs: -1 }]) {
    await assert.rejects(api.pollNativeCompletion({ rpc, sessionId: 's', afterSeq: -1, timeoutMs: 0, ...options }), /bounded_poll/)
  }
  const result = await api.pollNativeCompletion({ rpc, sessionId: 's', afterSeq: -1, timeoutMs: 0 })
  assert.equal(calls, 0); assert.equal(result.status, 'not_completed'); assert.equal(result.history.hasMore, true)
})
test('one deadline bounds slow history pages and returns collected partial evidence', async () => {
  const options = []; let calls = 0
  const rpc = async (method, _payload, budget) => {
    assert.equal(method, 'session.history'); options.push(budget); calls++
    if (calls === 1) return { events: [{ event: { seq: 10 } }], hasMore: true }
    return new Promise((done, reject) => {
      const timer = setTimeout(() => done({ events: [{ event: { seq: 9 } }], hasMore: false }), 300)
      budget?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(budget.signal.reason) }, { once: true })
    })
  }
  const started = Date.now()
  const result = await api.pollNativeCompletion({ rpc, sessionId: 's', afterSeq: -1, timeoutMs: 50, intervalMs: 5 })
  assert.ok(Date.now() - started < 250, 'shared budget must end before the slow second page')
  assert.equal(calls, 2); assert.equal(options[0].deadline, options[1].deadline)
  assert.ok(options[1].signal.aborted)
  assert.equal(result.status, 'not_completed'); assert.equal(result.history.hasMore, true); assert.equal(result.history.partial, true)
  assert.deepEqual(result.history.events.map(r => r.event.seq), [10])
})
test('native RPC budget covers response body and propagates parent deadline cancellation', async () => {
  let signal
  const rpc = api.nativeRpc({ baseUrl: 'http://127.0.0.1:54321', timeoutMs: 1000, fetchImpl: async (_url, options) => {
    signal = options.signal
    return { ok: true, json: async () => new Promise((done, reject) => {
      const timer = setTimeout(() => done({ result: { ok: true, value: {} } }), 300)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    }) }
  } })
  const started = Date.now()
  await assert.rejects(rpc('session.list', {}, { deadline: Date.now() + 40 }), /deadline/)
  assert.ok(Date.now() - started < 250); assert.ok(signal.aborted)
})
test('installed package contract refuses external roots before import', async t => {
  const f = await fixture(t); const prepared = await required('prepareIsolation')(f.input)
  await assert.rejects(required('verifyInstalledPackageContract')({ prepared, studioRoot: f.root, preRoot: f.root }), /installed_package_containment/)
  const studioRoot = join(prepared.home, 'synthetic-studio'); const preRoot = join(prepared.home, 'synthetic-pre')
  await json(join(studioRoot, 'package.json'), { name: '@architectureworld/report-studio-dsh', type: 'module', dependencies: { 'playwright-core': '1.63.0' } })
  await json(join(preRoot, 'package.json'), { name: '@architectureworld/dsh-preplanning-agent', type: 'module' })
  for (const [root, path, name] of [[studioRoot, 'lib/index.js', 'apply'], [studioRoot, 'lib/design-tools.js', 'registerDesignTools'], [studioRoot, 'lib/runtime.js', 'createStudioDshRuntime'], [studioRoot, 'lib/isolated-worker.js', 'createDshReviewWorker'], [studioRoot, 'vendor/apps/studio-local/layout-preview.mjs', 'createLayoutPreviewRenderer'], [preRoot, 'lib/index.js', 'apply']]) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), `export function ${name}() { throw new Error('must not execute plugin') }`)
  }
  await writeFile(join(studioRoot, 'vendor/apps/studio-local/design-rules.mjs'), 'export function getDesignRules(){ return {rendererLimits:{actualRenderingRequiredForVisualAcceptance:true}} }')
  const result = await api.verifyInstalledPackageContract({ prepared, studioRoot, preRoot })
  assert.equal(result.imported, true); assert.equal(result.preDefaultPathsVerified, false); assert.equal(result.actualModelRun, false)
})
test('bounded child command rejects failures without exposing private output', async () => {
  await assert.rejects(required('runNodeCommand')({ command: process.execPath, args: ['-e', "process.stderr.write('synthetic-private-value'); process.exit(7)"], cwd: resolve(tmpdir()), env: {}, timeoutMs: 3000 }), e => e.message === 'isolated_child_exit_7' && !e.message.includes('synthetic-private-value'))
})
test('child stdout delivered after exit is retained until close', async () => {
  const { EventEmitter } = await import('node:events')
  const spawnImpl = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}
    setImmediate(() => { child.stdout.emit('data', Buffer.from('HEAD')); child.emit('exit', 0); child.stdout.emit('data', Buffer.from('x'.repeat(300000) + 'TAIL')); child.emit('close', 0) })
    return child
  }
  const result = await api.runNodeCommand({ command: process.execPath, args: [], cwd: resolve(tmpdir()), env: {}, timeoutMs: 3000 }, { spawnImpl })
  assert.equal(result.stdout.length, 300008)
  assert.ok(result.stdout.startsWith('HEAD')); assert.ok(result.stdout.endsWith('TAIL'))
  const actual = await api.runNodeCommand({ command: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(300000) + 'TAIL')"], cwd: resolve(tmpdir()), env: {}, timeoutMs: 3000 })
  assert.equal(actual.stdout.length, 300004); assert.ok(actual.stdout.endsWith('TAIL'))
})
