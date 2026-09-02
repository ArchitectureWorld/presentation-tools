const test = require('node:test')
const assert = require('node:assert/strict')
const { createMockStudioAdapter } = require('../src/mock-studio-adapter.js')

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    snapshot() { return new Map(values) },
  }
}

test('adapter notifies subscribers and persists every mutation', () => {
  const storage = createMemoryStorage()
  const adapter = createMockStudioAdapter({ storage, seedComments: false })
  const stages = []
  const unsubscribe = adapter.subscribe(state => stages.push(state.stage))

  adapter.setStage('draft')
  adapter.setPage('page-03')
  adapter.selectTarget({ id: 'draft-page-03-title', type: 'text-block', label: '页面标题' })
  adapter.addComment({ text: '压缩标题。' })
  unsubscribe()
  adapter.setPage('page-04')

  assert.deepEqual(stages, ['draft', 'draft', 'draft', 'draft'])
  const persisted = JSON.parse(storage.getItem('report-studio.prototype.state'))
  assert.equal(persisted.stage, 'draft')
  assert.equal(persisted.activePageByStage.draft, 'page-04')
  assert.equal(persisted.commentsByScope['draft:page-03'][0].text, '压缩标题。')
})

test('adapter restores a persisted snapshot', () => {
  const storage = createMemoryStorage()
  let first = createMockStudioAdapter({ storage, seedComments: false })
  first.setStage('layout')
  first.setPage('page-05')
  first.addComment({ text: '路线图需要增加验收节点。' })

  const restored = createMockStudioAdapter({ storage, seedComments: true })
  const state = restored.getState()
  assert.equal(state.stage, 'layout')
  assert.equal(state.activePageByStage.layout, 'page-05')
  assert.equal(state.commentsByScope['layout:page-05'][0].text, '路线图需要增加验收节点。')
})

test('adapter adds and removes page assets without changing another page', () => {
  const adapter = createMockStudioAdapter({ storage: createMemoryStorage(), seedComments: false })
  const page03Before = adapter.getState().pages.find(page => page.id === 'page-03').assets.length
  const result = adapter.addAsset('page-04', {
    type: 'image',
    title: '用户上传的技术示意图',
    meta: '图片 · PNG',
    dataUrl: 'data:image/svg+xml;base64,abc',
  })
  assert.equal(adapter.getState().pages.find(page => page.id === 'page-04').assets.at(-1).id, result.id)
  assert.equal(adapter.getState().pages.find(page => page.id === 'page-03').assets.length, page03Before)

  adapter.removeAsset('page-04', result.id)
  assert.equal(adapter.getState().pages.find(page => page.id === 'page-04').assets.some(asset => asset.id === result.id), false)
})

test('adapter submits and completes only the active scope round', () => {
  const adapter = createMockStudioAdapter({ storage: createMemoryStorage(), seedComments: false })
  adapter.setStage('draft')
  adapter.setPage('page-04')
  adapter.addComment({ text: '拆分正文要点。' })
  const submitted = adapter.submitCurrentRound({ now: '2026-09-01T10:00:00.000Z' })
  assert.equal(submitted.payload.scopeKey, 'draft:page-04')
  assert.equal(adapter.getCurrentComments()[0].status, 'submitted')

  adapter.completeRound(submitted.round.id, {
    summary: '已生成正文拆分建议。',
    changes: ['正文拆为三条并列要点'],
  }, { now: '2026-09-01T10:00:02.000Z' })

  assert.equal(adapter.getCurrentComments()[0].status, 'responded')
  assert.equal(adapter.getCurrentAgentMessages()[0].summary, '已生成正文拆分建议。')
})

test('reset discards persisted state and returns a fresh demo state', () => {
  const storage = createMemoryStorage()
  const adapter = createMockStudioAdapter({ storage, seedComments: false })
  adapter.setStage('draft')
  adapter.addComment({ text: '临时批注。' })
  adapter.reset({ seedComments: false })

  assert.equal(adapter.getState().stage, 'outline')
  assert.equal(Object.keys(adapter.getState().commentsByScope).length, 0)
  assert.ok(storage.getItem('report-studio.prototype.state'))
})


test('adapter submits a selected historical round without creating another round', () => {
  const adapter = createMockStudioAdapter({ storage: createMemoryStorage(), seedComments: false })
  adapter.setStage('draft')
  adapter.setPage('page-04')
  adapter.addComment({ text: '第一轮批注。' })
  const first = adapter.submitRound(null, { now: '2026-09-01T10:00:00.000Z' })
  adapter.completeRound(first.round.id, { summary: '返回。', changes: [] }, { now: '2026-09-01T10:00:02.000Z' })
  adapter.addComment({ text: '补充到第一轮。', roundId: first.round.id })
  const second = adapter.submitRound(first.round.id, { now: '2026-09-01T10:05:00.000Z' })

  assert.equal(second.round.id, first.round.id)
  assert.equal(adapter.getCurrentRounds().length, 1)
  assert.equal(second.payload.submissionNumber, 2)
})
