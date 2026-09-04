import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createStudioDshRuntime } from './lib/runtime.js'
import { createStudioId } from '../studio-contracts/index.mjs'
import { readWorkspaceSnapshot, resolveWorkspaceRoot } from '../../apps/studio-local/workspace-live-link.mjs'

const fixtureRoot = resolve(new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/u, '$1'))

async function makeWorkspace(prefix) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), prefix))
  await cp(fixtureRoot, workspaceRoot, { recursive: true })
  return workspaceRoot
}

function controlledWatcherHarness() {
  const records = []
  return {
    records,
    factory(options) {
      const record = { options, closed: false, current: { status: 'watcher_disconnected', workspaceRoot: options.workspaceRoot } }
      records.push(record)
      const scan = async () => {
        record.current = await readWorkspaceSnapshot(options.workspaceRoot, { putBlob: options.putBlob })
        if (record.current.status === 'connected') await options.onCandidate(record.current)
        await options.onStatus(record.current)
        return structuredClone(record.current)
      }
      return {
        start: scan,
        rescan: scan,
        status: () => structuredClone(record.current),
        async close() { record.closed = true },
      }
    },
  }
}

test('native DSH runtime keys one Repository and Watcher by the current Session Workspace', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'report-studio-workspace-runtime-'))
  const workspaceA = await makeWorkspace('report-studio-workspace-a-')
  const workspaceB = await makeWorkspace('report-studio-workspace-b-')
  const workspaceWithoutProject = await mkdtemp(join(tmpdir(), 'report-studio-workspace-empty-'))
  const sessionsById = new Map([
    ['workspace-session-a', { header: { cwd: workspaceA } }],
    ['workspace-session-b', { header: { cwd: workspaceA } }],
  ])
  const watchers = controlledWatcherHarness()
  const runtime = createStudioDshRuntime({
    dataRoot,
    sessions: { get: sessionId => sessionsById.get(sessionId) },
    workspaceWatcherFactory: watchers.factory,
    workspaceRootResolver: resolveWorkspaceRoot,
  })
  try {
    const opened = await runtime.openWorkspace('workspace-session-a')
    assert.equal(opened.status, 'connected')
    const repositoryA = await runtime.repositoryFor('workspace-session-a')
    assert.equal(repositoryA.getState().project.currentRevision, 0)
    assert.equal(repositoryA.getState().pages.length, 2)

    await runtime.openWorkspace('workspace-session-b')
    assert.equal(await runtime.repositoryFor('workspace-session-b'), repositoryA)
    assert.equal(watchers.records.length, 1)

    const projectPath = join(workspaceB, 'project.json')
    const project = JSON.parse(await readFile(projectPath, 'utf8'))
    project.name = '第二 Workspace 项目'
    await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
    sessionsById.set('workspace-session-a', { header: { cwd: workspaceB } })
    await runtime.openWorkspace('workspace-session-a')
    const repositoryB = await runtime.repositoryFor('workspace-session-a')
    assert.notEqual(repositoryB, repositoryA)
    assert.equal(repositoryB.getState().project.title, '第二 Workspace 项目')
    assert.equal(watchers.records.length, 2)
    assert.equal(watchers.records[0].closed, false, 'session-b still owns Workspace A')

    sessionsById.set('workspace-session-b', { header: { cwd: workspaceB } })
    await runtime.openWorkspace('workspace-session-b')
    assert.equal(await runtime.repositoryFor('workspace-session-b'), repositoryB)
    assert.equal(watchers.records[0].closed, true)

    sessionsById.set('workspace-session-a', { header: { cwd: workspaceWithoutProject } })
    const missing = await runtime.openWorkspace('workspace-session-a')
    assert.equal(missing.status, 'workspace_project_missing')
    const emptyRepository = await runtime.repositoryFor('workspace-session-a')
    assert.notEqual(emptyRepository, repositoryB)
    assert.equal(emptyRepository.getState().outline.length, 0)
  } finally {
    await runtime.close?.()
    assert.ok(watchers.records.every(record => record.closed))
    await rm(workspaceA, { recursive: true, force: true })
    await rm(workspaceB, { recursive: true, force: true })
    await rm(workspaceWithoutProject, { recursive: true, force: true })
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('native DSH runtime stages an upstream candidate until the browser explicitly applies it', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'report-studio-workspace-conflict-'))
  const workspaceRoot = await makeWorkspace('report-studio-workspace-dirty-')
  const watchers = controlledWatcherHarness()
  const runtime = createStudioDshRuntime({
    dataRoot,
    sessions: { get: () => ({ header: { cwd: workspaceRoot } }) },
    workspaceWatcherFactory: watchers.factory,
    workspaceRootResolver: resolveWorkspaceRoot,
  })
  try {
    await runtime.openWorkspace('dirty-session')
    const before = await runtime.getState('dirty-session')
    const outlinePath = join(workspaceRoot, 'outline.json')
    const outline = JSON.parse(await readFile(outlinePath, 'utf8'))
    outline.nodes[0].title = '上游待确认标题'
    await writeFile(outlinePath, `${JSON.stringify(outline, null, 2)}\n`, 'utf8')

    const pending = await runtime.reloadWorkspace('dirty-session', { dirty: true })
    assert.equal(pending.status, 'local_dirty_conflict')
    assert.equal((await runtime.getState('dirty-session')).project.currentRevision, before.project.currentRevision)

    const applied = await runtime.applyWorkspaceCandidate('dirty-session', { discardLocalChanges: true })
    assert.equal(applied.status, 'connected')
    const after = await runtime.getState('dirty-session')
    assert.equal(after.project.currentRevision, before.project.currentRevision + 1)
    assert.equal(after.project.extensionPayload.standardArchive.documents['outline.json'].nodes[0].title, '上游待确认标题')
  } finally {
    await runtime.close?.()
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(dataRoot, { recursive: true, force: true })
  }
})

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
    assert.equal(submitted.reviewRun.reviewSubmissionId, submitted.submission.id)
    assert.equal(submitted.reviewRun.sessionId, 'session-a')
    assert.equal(submitted.reviewRun.dispatchAttempt, 1)
    assert.equal(submitted.reviewRun.integrationState, 'pending_dispatch')
    await runtime.updateDispatch('session-a', submitted.submission.id, { status: 'dispatched', reviewRunId: submitted.reviewRun.reviewRunId })
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
    assert.equal(sessionA.reviewRuns[0].integrationState, 'proposal_created')
    assert.equal(sessionA.reviewRuns[0].resultProposalId, applied.proposalId)
    const sessionB = await runtime.getState('session-b')
    assert.equal(sessionB.outline.length, 0)
    assert.notEqual(sessionA.project.id, sessionB.project.id)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native DSH review prompt gives providers a closed executable draft.update contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-studio-dsh-prompt-contract-'))
  try {
    const runtime = createStudioDshRuntime({ dataRoot: root })
    let state = await runtime.executeAction('prompt-contract-session', { type: 'outline.add', parentId: null, title: '原始标题', baseRevision: 0 })
    state = await runtime.executeAction('prompt-contract-session', { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id, baseRevision: state.project.currentRevision })
    const pageId = state.pages[0].id
    await runtime.executeAction('prompt-contract-session', {
      type: 'annotation.add',
      scopeKey: `draft:${pageId}`,
      target: { type: 'page', id: pageId, label: '原始标题' },
      instruction: '把标题改为验收标题',
    })

    const submitted = await runtime.submitReview('prompt-contract-session', { scopeKey: `draft:${pageId}` })
    const prompt = submitted.dshPrompt.text

    assert.match(prompt, /顶层对象只允许 submissionId、projectId、baseRevision、scopeKey、idempotencyKey、message、commands/)
    assert.match(prompt, /draft\.update 命令只允许 commandId、type、scopeKey、baseRevision、riskLevel、sourceAnnotationIds、pageId、patch/)
    assert.match(prompt, /patch 只能且必须包含 heading、body、script 其中一个字段/)
    assert.match(prompt, /不得在 draft\.update 命令中添加 title/)
    assert.match(prompt, /不得搜索源码、写入临时文件或绕过 studio_apply_commands/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native DSH retry reuses the immutable Submission and creates the next ReviewRun attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-studio-dsh-retry-'))
  try {
    const runtime = createStudioDshRuntime({ dataRoot: root })
    await runtime.executeAction('retry-session', { type: 'annotation.add', scopeKey: 'outline:root', instruction: '重试投递' })
    const submitted = await runtime.submitReview('retry-session', { scopeKey: 'outline:root' })
    await runtime.updateDispatch('retry-session', submitted.submission.id, {
      status: 'dispatch_failed', reviewRunId: submitted.reviewRun.reviewRunId, error: 'native unavailable',
    })
    const retried = await runtime.retrySubmission('retry-session', submitted.submission.id)
    assert.equal(retried.submission.id, submitted.submission.id)
    assert.equal(retried.submission.idempotencyKey, submitted.submission.idempotencyKey)
    assert.equal(retried.reviewRun.dispatchAttempt, 2)
    assert.equal(retried.reviewRun.reviewSubmissionId, submitted.submission.id)
    assert.equal(retried.reviewRun.integrationState, 'pending_dispatch')
    const state = await runtime.getState('retry-session')
    assert.deepEqual(state.reviewRuns.map(run => run.integrationState), ['dispatch_failed', 'pending_dispatch'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native DSH can resume a persisted pending attempt through legal failure and retry edges', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-studio-dsh-resume-'))
  try {
    const runtime = createStudioDshRuntime({ dataRoot: root })
    await runtime.executeAction('resume-session', { type: 'annotation.add', scopeKey: 'outline:root', instruction: '恢复投递' })
    const submitted = await runtime.submitReview('resume-session', { scopeKey: 'outline:root' })
    const resumed = await runtime.retrySubmission('resume-session', submitted.submission.id)
    assert.equal(resumed.submission.id, submitted.submission.id)
    assert.equal(resumed.reviewRun.dispatchAttempt, 2)
    const state = await runtime.getState('resume-session')
    assert.deepEqual(state.reviewRuns.map(run => run.integrationState), ['dispatch_failed', 'pending_dispatch'])
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
