import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioDshRuntime } from './lib/runtime.js'

test('native DSH runtime binds isolated Report Studio projects to session ids and creates proposals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-studio-dsh-runtime-'))
  try {
    const runtime = createStudioDshRuntime({ dataRoot: root })
    let state = await runtime.executeAction('session-a', { type: 'outline.add', parentId: null, title: 'DSH 原生接入', baseRevision: 0 })
    const nodeId = state.outline[0].id
    state = await runtime.executeAction('session-a', { type: 'draft.ensurePage', outlineNodeId: nodeId, baseRevision: state.project.currentRevision })
    await (await runtime.repositoryFor('session-a')).transactContent({ baseRevision: state.project.currentRevision, source: 'human' }, current => {
      current.project.extensionPayload = { standardArchive: { files: [{ objectRef: { sha256: 'a'.repeat(64), sizeBytes: 1, mimeType: 'image/png' }, sentinel: 'never expose this archive' }] } }
      return current
    })
    state = await runtime.executeAction('session-a', { type: 'annotation.add', scopeKey: 'outline:root', reviewRoundId: null, target: { type: 'outline-node', id: nodeId, label: 'DSH 原生接入' }, instruction: '将标题改为原生 DSH 工作台' })
    const submitted = await runtime.submitReview('session-a', { scopeKey: 'outline:root', reviewRoundId: null })
    assert.match(submitted.dshPrompt.text, /studio_get_context/)
    assert.match(submitted.dshPrompt.text, new RegExp(submitted.submission.id))
    const context = await runtime.getContext('session-a', submitted.submission.id)
    assert.equal(context.submission.id, submitted.submission.id)
    assert.equal(context.project.currentRevision, undefined)
    assert.equal('standardArchive' in context.project, false)
    assert.equal('pages' in context, false)
    assert.equal('outline' in context, false)
    assert.equal(context.page.id, state.pages[0].id)
    assert.equal(JSON.stringify(context).includes('standardArchive'), false)
    const applied = await runtime.applyCommands('session-a', {
      submissionId: submitted.submission.id,
      idempotencyKey: submitted.submission.idempotencyKey,
      message: '已形成标题修改建议',
      commands: [{ type: 'outline.rename', nodeId, title: '原生 DSH 工作台' }],
    })
    assert.equal(applied.status, 'pending')
    const repeated = await runtime.applyCommands('session-a', {
      submissionId: submitted.submission.id,
      idempotencyKey: submitted.submission.idempotencyKey,
      message: '已形成标题修改建议',
      commands: [{ type: 'outline.rename', nodeId, title: '原生 DSH 工作台' }],
    })
    assert.equal(repeated.proposalId, applied.proposalId)
    const sessionA = await runtime.getState('session-a')
    assert.equal(sessionA.proposals.length, 1)
    const sessionB = await runtime.getState('session-b')
    assert.equal(sessionB.outline.length, 0)
    assert.notEqual(sessionA.project.id, sessionB.project.id)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native DSH context rejects a submission after ProjectHead advances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-studio-dsh-stale-'))
  try {
    const runtime = createStudioDshRuntime({ dataRoot: root })
    let state = await runtime.executeAction('stale-session', { type: 'outline.add', parentId: null, title: '基线', baseRevision: 0 })
    state = await runtime.executeAction('stale-session', { type: 'annotation.add', scopeKey: 'outline:root', instruction: '检查基线' })
    const submitted = await runtime.submitReview('stale-session', { scopeKey: 'outline:root' })
    await runtime.executeAction('stale-session', { type: 'project.rename', title: '新版本', baseRevision: state.project.currentRevision })
    await assert.rejects(runtime.getContext('stale-session', submitted.submission.id), error => error.code === 'stale_review_submission')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
