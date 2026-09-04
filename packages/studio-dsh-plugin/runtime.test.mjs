import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioDshRuntime } from './lib/runtime.js'
import { createStudioId } from '../studio-contracts/index.mjs'

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
    const pageId = state.pages[0].id
    state = await runtime.executeAction('session-a', { type: 'annotation.add', scopeKey: `draft:${pageId}`, reviewRoundId: null, target: { type: 'page', id: pageId, label: 'DSH 原生接入' }, instruction: '补充原生 DSH 工作台说明' })
    const submitted = await runtime.submitReview('session-a', { scopeKey: `draft:${pageId}`, reviewRoundId: null })
    assert.match(submitted.dshPrompt.text, /studio_get_context/)
    assert.match(submitted.dshPrompt.text, new RegExp(submitted.submission.id))
    const context = await runtime.getContext('session-a', submitted.submission.id)
    assert.equal(context.submission.reviewSubmissionId, submitted.submission.id)
    assert.equal(context.project.currentRevision, undefined)
    assert.equal('standardArchive' in context.project, false)
    assert.equal('pages' in context, false)
    assert.equal('outline' in context, false)
    assert.equal(context.page.id, state.pages[0].id)
    assert.equal(JSON.stringify(context).includes('standardArchive'), false)
    assert.equal(context.taskScope.allowedCommands.includes('outline.delete'), false)
    const annotationId = submitted.submission.annotationSnapshots[0].annotationId
    const commands = [{ commandId: createStudioId('command'), type: 'draft.update', scopeKey: submitted.submission.scopeKey, baseRevision: submitted.submission.baseRevision, riskLevel: 'ordinary_reversible', sourceAnnotationIds: [annotationId], pageId, patch: { body: '原生 DSH 工作台' } }]
    const applied = await runtime.applyCommands('session-a', {
      submissionId: submitted.submission.id,
      projectId: submitted.submission.projectId,
      baseRevision: submitted.submission.baseRevision,
      scopeKey: submitted.submission.scopeKey,
      idempotencyKey: submitted.submission.idempotencyKey,
      message: '已形成标题修改建议',
      commands,
    })
    assert.equal(applied.status, 'pending')
    const repeated = await runtime.applyCommands('session-a', {
      submissionId: submitted.submission.id,
      projectId: submitted.submission.projectId,
      baseRevision: submitted.submission.baseRevision,
      scopeKey: submitted.submission.scopeKey,
      idempotencyKey: submitted.submission.idempotencyKey,
      message: '已形成标题修改建议',
      commands,
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

test('native DSH rejects a mixed valid and invalid ChangeSet without persisting a Proposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-studio-dsh-atomic-'))
  try {
    const runtime = createStudioDshRuntime({ dataRoot: root })
    let state = await runtime.executeAction('atomic-session', { type: 'outline.add', parentId: null, title: '原标题', baseRevision: 0 })
    const nodeId = state.outline[0].id
    state = await runtime.executeAction('atomic-session', { type: 'annotation.add', scopeKey: 'outline:root', instruction: '修改标题' })
    const submitted = await runtime.submitReview('atomic-session', { scopeKey: 'outline:root' })
    const common = {
      scopeKey: submitted.submission.scopeKey,
      baseRevision: submitted.submission.baseRevision,
      riskLevel: 'ordinary_reversible',
      sourceAnnotationIds: [submitted.submission.annotationSnapshots[0].annotationId],
    }
    const input = {
      submissionId: submitted.submission.id,
      projectId: submitted.submission.projectId,
      baseRevision: submitted.submission.baseRevision,
      scopeKey: submitted.submission.scopeKey,
      message: '混合命令',
      commands: [
        { ...common, commandId: createStudioId('command'), type: 'outline.rename', nodeId, title: '有效标题' },
        { ...common, commandId: createStudioId('command'), type: 'outline.rename', nodeId: createStudioId('outlineNode'), title: '越权标题' },
      ],
    }
    await assert.rejects(runtime.applyCommands('atomic-session', input), error => error.code === 'invalid_command')
    state = await runtime.getState('atomic-session')
    assert.equal(state.proposals.length, 0)
    assert.equal(state.outline[0].title, '原标题')
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
