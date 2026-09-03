import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioServer } from '../apps/studio-local/server.mjs'

const dataDir = await mkdtemp(join(tmpdir(), 'report-studio-v0.1.1-verify-'))
let app

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  assert.equal(response.ok, true, `${path}: ${JSON.stringify(payload)}`)
  return payload
}

try {
  app = await createStudioServer({ dataDir, port: 0 })
  await app.start()
  let baseUrl = `http://127.0.0.1:${app.port}`
  const health = await fetch(`${baseUrl}/api/health`).then(response => response.json())
  assert.equal(health.ok, true)
  assert.equal(health.version, 'v0.1.1')

  let state = await fetch(`${baseUrl}/api/state`).then(response => response.json())
  const contentAction = async action => {
    state = await post(baseUrl, '/api/action', { ...action, baseRevision: state.project.currentRevision })
    return state
  }
  await contentAction({ type: 'project.rename', title: 'v0.1.1 验收项目' })
  await contentAction({ type: 'outline.add', parentId: null, title: '01 项目背景' })
  const nodeId = state.outline[0].id
  await contentAction({ type: 'draft.ensurePage', outlineNodeId: nodeId })
  const pageId = state.pages[0].id
  await contentAction({
    type: 'draft.update',
    pageId,
    patch: {
      heading: '项目背景与目标',
      body: '这是可直接编辑的草案正文。',
      bullets: ['现状', '目标'],
      script: '这一页用于说明项目为什么要做。',
      assets: [],
    },
  })
  const revisionAfterDraft = state.project.currentRevision
  state = await post(baseUrl, '/api/action', {
    type: 'annotation.add',
    scopeKey: `draft:${pageId}`,
    target: { type: 'page', id: pageId, label: '项目背景与目标' },
    instruction: '标题再聚焦一些',
  })
  assert.equal(state.project.currentRevision, revisionAfterDraft)
  const first = await post(baseUrl, '/api/review/submit', { scopeKey: `draft:${pageId}` })
  assert.equal(first.submission.number, 1)

  await app.stop()
  app = await createStudioServer({ dataDir, port: 0 })
  await app.start()
  baseUrl = `http://127.0.0.1:${app.port}`
  const recovered = await fetch(`${baseUrl}/api/state`).then(response => response.json())
  assert.equal(recovered.pages[0].body, '这是可直接编辑的草案正文。')
  assert.equal(recovered.reviewSubmissions.length, 1)

  console.log('Report Studio v0.1.1 verification PASS')
  console.log(`revision=${recovered.project.currentRevision}`)
  console.log(`outline_nodes=${recovered.outline.length}`)
  console.log(`draft_pages=${recovered.pages.length}`)
  console.log(`review_submissions=${recovered.reviewSubmissions.length}`)
} finally {
  await app?.stop().catch(() => {})
  await rm(dataDir, { recursive: true, force: true })
}
