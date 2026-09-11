import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioServer } from '../apps/studio-local/server.mjs'
import { createDesignService } from '../apps/studio-local/design-service.mjs'
import { createLayoutPreviewRenderer } from '../apps/studio-local/layout-preview.mjs'
import { createLayoutPage, addLiveLayoutElement } from '../packages/studio-layout-core/index.mjs'
import { createStudioId } from '../packages/studio-contracts/index.mjs'
import { validateProjectDirectoryWithAjv } from '../contracts/presentation-standard-project/src/index.mjs'

const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const pluginPackage = JSON.parse(await readFile(new URL('../packages/studio-dsh-plugin/package.json', import.meta.url), 'utf8'))
assert.match(rootPackage.version, /^(?:0\.1\.1|0\.2\.0(?:-alpha\.\d+)?)$/u)
assert.equal(pluginPackage.version, '0.1.1')

const dataDir = await mkdtemp(join(tmpdir(), 'report-studio-v0.1.1-e2e-'))
const legacy = {
  schemaVersion: 'report-studio.v0.1.0',
  project: {
    id: 'legacy_project',
    title: '旧版策划汇报',
    currentRevision: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  outline: [],
  pages: [],
  annotations: [],
  reviewRounds: [],
  reviewSubmissions: [],
  proposals: [],
  revisions: [],
  ui: { stage: 'outline', activePageId: null },
}
const legacyBytes = `${JSON.stringify(legacy, null, 2)}\n`
await writeFile(join(dataDir, 'state.json'), legacyBytes)

let nodeId
const bridge = {
  configured: true,
  async submit({ submission }) {
    return {
      message: '已生成标题优化建议。',
      commands: [{
        commandId: createStudioId('command'),
        type: 'draft.update',
        scopeKey: submission.scopeKey,
        baseRevision: submission.baseRevision,
        riskLevel: 'ordinary_reversible',
        sourceAnnotationIds: submission.annotationSnapshots.map(annotation => annotation.annotationId),
        pageId: submission.pageId,
        patch: { heading: '项目目标与实施边界' },
      }],
      submissionId: submission.id,
      projectId: submission.projectId,
      baseRevision: submission.baseRevision,
      scopeKey: submission.scopeKey,
      idempotencyKey: submission.idempotencyKey,
      sessionRef: 'e2e-session',
    }
  },
  async chat() { return { message: 'ok', commands: [] } },
}

let app
async function post(baseUrl, path, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  assert.equal(response.ok, true, `${path} failed with HTTP ${response.status}: ${text}`)
  return JSON.parse(text)
}

try {
  app = await createStudioServer({ dataDir, port: 0, agentBridge: bridge })
  await app.start()
  let baseUrl = `http://127.0.0.1:${app.port}`

  const health = await fetch(`${baseUrl}/api/health`).then(response => response.json())
  assert.equal(health.version, 'v0.1.1')
  assert.equal(health.migrationStatus, 'migration_required')
  assert.equal(health.securityMode, 'local-single-user-only')
  assert.equal(health.listenHost, '127.0.0.1')
  assert.equal(health.networkSharedSecurity, false)

  const migration = await post(baseUrl, '/api/migration/apply')
  assert.equal(migration.status, 'ready')
  assert.equal(await readFile(migration.backupPath, 'utf8'), legacyBytes)
  assert.equal(await readFile(join(dataDir, 'state.json'), 'utf8'), legacyBytes)

  let state = migration.state
  const contentAction = async action => {
    state = await post(baseUrl, '/api/action', { ...action, baseRevision: state.project.currentRevision })
    return state
  }
  await contentAction({ type: 'project.rename', title: 'Report Studio v0.1.1 端到端验收' })
  await contentAction({ type: 'outline.add', parentId: null, title: '01 项目目标' })
  nodeId = state.outline[0].id
  await contentAction({ type: 'draft.ensurePage', outlineNodeId: nodeId })
  const pageId = state.pages[0].id
  await contentAction({
    type: 'draft.update',
    pageId,
    patch: {
      heading: '项目目标',
      body: '迁移后的项目已经进入可编辑状态。',
      bullets: ['旧数据已备份', 'Revision CAS 已生效'],
      script: '先说明迁移，再说明受控修改。',
      assets: [],
    },
  })

  state = await post(baseUrl, '/api/action', {
    type: 'annotation.add',
    scopeKey: `draft:${pageId}`,
    target: { type: 'page', id: pageId, label: '项目目标' },
    instruction: '标题补充实施边界。',
  })
  const review = await post(baseUrl, '/api/review/submit', { scopeKey: `draft:${pageId}` })
  assert.equal(review.submission.status, 'accepted')
  assert.equal(review.state.pages[0].heading, '项目目标与实施边界')
  assert.equal(review.state.reviewRuns.at(-1).integrationState, 'accepted')
  const acceptedRevision = review.state.project.currentRevision

  await app.stop()
  app = await createStudioServer({ dataDir, port: 0, agentBridge: bridge })
  await app.start()
  baseUrl = `http://127.0.0.1:${app.port}`
  const recovered = await fetch(`${baseUrl}/api/state`).then(response => response.json())
  assert.equal(recovered.project.currentRevision, acceptedRevision)
  assert.equal(recovered.pages[0].heading, '项目目标与实施边界')
  assert.equal(recovered.reviewSubmissions.at(-1).status, 'accepted')

  // Unformatted content is not a finished report. Keep the production export gate closed.
  const unformatted = await fetch(`${baseUrl}/api/standard/export`, {method:'POST',headers:{'content-type':'application/json'},body:'{}'})
  assert.equal(unformatted.status,409)
  assert.equal((await unformatted.json()).error.code,'standard_export_layout_blocked')

  // Exercise the real host design path before checking the HTTP export route.
  const design=createDesignService({repository:app.repository,layoutService:app.layoutService})
  const sessionId='e2e-design',run=await design.start({sessionId,pageIds:[pageId],allowApply:true,expiresAt:new Date(Date.now()+60_000).toISOString()})
  const context=await design.context({sessionId,pageId})
  let layout=createLayoutPage({projectId:context.projectId,pageId,baseDraftRevision:context.baseProjectRevision})
  const texts=context.sourceProjection.sources.filter(s=>['text','list-item'].includes(s.kind))
  assert.ok(texts.length>=3,'the rendered fixture must retain title, body and list content')
  for(const [index,source] of texts.entries())layout=addLiveLayoutElement(layout,{type:'text',sourceRef:source.sourceRef,frame:{x:80,y:60+index*140,width:1440,height:120,rotation:0},style:{fontSize:source.payload.role==='page_title'?44:28,textColor:'#222222'}})
  const candidate=await design.prepare({sessionId,runId:run.runId,pageId,baseProjectRevision:context.baseProjectRevision,baseLayoutRevision:context.baseLayoutRevision,baseLayoutSha:context.baseLayoutSha,sourceStateHash:context.sourceStateHash,layout,sourceMapping:{},designIntent:'technical E2E fixture: retain title/body/list; speaker notes remain in source',idempotencyKey:'e2e-checked-layout'})
  const frozen=await design.previewInput({sessionId,...candidate})
  const preview=await createLayoutPreviewRenderer().render({...frozen,candidateSha:candidate.candidateSha,readAsset:async ref=>Buffer.concat(await Array.fromAsync(await app.repository.openBlob(ref)))})
  assert.deepEqual(preview.checks.blockers,[])
  await design.recordPreview({sessionId,...candidate,preview})
  await design.submitReview({sessionId,...candidate,previewFingerprint:preview.fingerprint,observations:'Deterministic technical fixture: real DOM text and bounds checked, no claim of model critique.'})
  const designedRevision=app.repository.getState().project.currentRevision
  assert.equal(designedRevision,acceptedRevision+1)
  const exported = await post(baseUrl, '/api/standard/export')
  assert.equal(exported.revision, designedRevision)
  assert.equal(exported.validation.valid, true)
  const exportValidation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
  assert.equal(exportValidation.valid, true, JSON.stringify(exportValidation.errors, null, 2))

  console.log('Report Studio v0.1.1 inherited end-to-end verification PASS')
  console.log(`hostProduct=${rootPackage.version}`)
  console.log(`migrationBackup=${migration.backupPath}`)
  console.log(`acceptedRevision=${acceptedRevision}`)
  console.log(`checkedLayoutRevision=${designedRevision}`)
  console.log('unformattedExport=blocked realPreview=passed')
  console.log(`standardExport=${exported.projectRoot}`)
} finally {
  await app?.stop().catch(() => {})
  await rm(dataDir, { recursive: true, force: true })
}
