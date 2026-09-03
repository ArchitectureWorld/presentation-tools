import test from 'node:test'
import assert from 'node:assert/strict'
import { projectAgentContext } from './agent-context.mjs'

test('agent context projection omits binary archives, migration backups and unrelated page bodies', () => {
  const result = projectAgentContext({
    project: { id: 'project_1', title: '项目', currentRevision: 2 },
    pages: [{ id: 'page_a', heading: '当前', body: '保留', assets: [{ dataUrl: 'data:image/png;base64,secret' }] }, { id: 'page_b', body: '不应泄露' }],
    extensionPayload: { standardArchive: { files: [{ dataBase64: 'secret' }] } },
    migration: { backup: { state: 'secret' } },
  }, { pageId: 'page_a' })
  const text = JSON.stringify(result)
  assert.equal(result.page.id, 'page_a')
  for (const forbidden of ['dataBase64', 'dataUrl', 'standardArchive', 'backup', '不应泄露', 'secret']) assert.equal(text.includes(forbidden), false)
})
