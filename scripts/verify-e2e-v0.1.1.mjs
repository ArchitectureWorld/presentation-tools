import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioServer } from '../apps/studio-local/server.mjs'
import { validateProjectDirectoryWithAjv } from '../contracts/presentation-standard-project/src/index.mjs'

const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const pluginPackage = JSON.parse(await readFile(new URL('../packages/studio-dsh-plugin/package.json', import.meta.url), 'utf8'))
assert.equal(rootPackage.version, '0.1.1')
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
      commands: [{ type: 'outline.rename', nodeId, title: '01 项目目标与实施边界' }],
      submissionId: submission.id,
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
  assert.equal(review.submission.status, 'proposal_created')
  assert.ok(review.bridgeResult.proposalId)
  assert.equal(review.state.outline[0].title, '01 项目目标')

  const accepted = await post(baseUrl, `/api/proposal/${review.bridgeResult.proposalId}/accept`)
  assert.equal(accepted.state.outline[0].title, '01 项目目标与实施边界')
  assert.equal(accepted.state.proposals[0].status, 'accepted')
  const acceptedRevision = accepted.state.project.currentRevision

  await app.stop()
  app = await createStudioServer({ dataDir, port: 0, agentBridge: bridge })
  await app.start()
  baseUrl = `http://127.0.0.1:${app.port}`
  const recovered = await fetch(`${baseUrl}/api/state`).then(response => response.json())
  assert.equal(recovered.project.currentRevision, acceptedRevision)
  assert.equal(recovered.outline[0].title, '01 项目目标与实施边界')
  assert.equal(recovered.proposals[0].status, 'accepted')

  const exported = await post(baseUrl, '/api/standard/export')
  assert.equal(exported.revision, acceptedRevision)
  assert.equal(exported.validation.valid, true)
  const exportValidation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
  assert.equal(exportValidation.valid, true, JSON.stringify(exportValidation.errors, null, 2))

  console.log('Report Studio v0.1.1 end-to-end verification PASS')
  console.log(`migrationBackup=${migration.backupPath}`)
  console.log(`acceptedRevision=${acceptedRevision}`)
  console.log(`standardExport=${exported.projectRoot}`)
} finally {
  await app?.stop().catch(() => {})
  await rm(dataDir, { recursive: true, force: true })
}
