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
    let state = await runtime.executeAction('session-a', { type: 'outline.add', parentId: null, title: 'DSH 原生接入' })
    const nodeId = state.outline[0].id
    state = await runtime.executeAction('session-a', { type: 'annotation.add', scopeKey: 'outline:root', reviewRoundId: null, target: { type: 'outline-node', id: nodeId, label: 'DSH 原生接入' }, instruction: '将标题改为原生 DSH 工作台' })
    const submitted = await runtime.submitReview('session-a', { scopeKey: 'outline:root', reviewRoundId: null })
    assert.match(submitted.dshPrompt.text, /studio_get_context/)
    assert.match(submitted.dshPrompt.text, new RegExp(submitted.submission.id))
    const applied = await runtime.applyCommands('session-a', {
      submissionId: submitted.submission.id,
      message: '已形成标题修改建议',
      commands: [{ type: 'outline.rename', nodeId, title: '原生 DSH 工作台' }],
    })
    assert.equal(applied.status, 'pending')
    const sessionA = await runtime.getState('session-a')
    assert.equal(sessionA.proposals.length, 1)
    const sessionB = await runtime.getState('session-b')
    assert.equal(sessionB.outline.length, 0)
    assert.notEqual(sessionA.project.id, sessionB.project.id)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
