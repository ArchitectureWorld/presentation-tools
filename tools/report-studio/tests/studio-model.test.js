const test = require('node:test')
const assert = require('node:assert/strict')
const Core = require('../src/studio-model.js')

test('scopeKeyFor keeps outline and page stages isolated', () => {
  assert.equal(Core.scopeKeyFor('outline', 'page-04'), 'outline:root')
  assert.equal(Core.scopeKeyFor('draft', 'page-04'), 'draft:page-04')
  assert.equal(Core.scopeKeyFor('layout', 'page-04'), 'layout:page-04')
  assert.notEqual(Core.scopeKeyFor('draft', 'page-04'), Core.scopeKeyFor('layout', 'page-04'))
})

test('addComment stages one comment only in the active scope', () => {
  let state = Core.createInitialState()
  state = Core.setStage(state, 'draft')
  state = Core.setPage(state, 'page-04')
  state = Core.selectTarget(state, {
    id: 'draft-page-04-title',
    type: 'text-block',
    label: '页面标题',
    excerpt: '构建统一、开放、可持续演进的智慧园区技术底座',
  })

  const result = Core.addComment(state, { text: '标题需要再压缩。' })

  assert.equal(result.comment.status, 'staged')
  assert.equal(result.comment.scopeKey, 'draft:page-04')
  assert.equal(result.comment.target.id, 'draft-page-04-title')
  assert.equal(result.state.commentsByScope['draft:page-04'].length, 1)
  assert.equal(result.state.commentsByScope['layout:page-04']?.length ?? 0, 0)
  assert.equal(result.state.commentsByScope['outline:root']?.length ?? 0, 0)
})

test('addComment falls back to the current page or outline when no target is selected', () => {
  let state = Core.createInitialState()
  let result = Core.addComment(state, { text: '先调整章节顺序。' })
  assert.equal(result.comment.target.type, 'outline')
  assert.equal(result.comment.target.id, 'outline-root')

  state = Core.setStage(result.state, 'draft')
  state = Core.setPage(state, 'page-03')
  state = Core.selectTarget(state, null)
  result = Core.addComment(state, { text: '这一页信息量太大。' })
  assert.equal(result.comment.target.type, 'page')
  assert.equal(result.comment.target.id, 'page-03')
})

test('addComment rejects blank text without mutating state', () => {
  const state = Core.createInitialState()
  assert.throws(() => Core.addComment(state, { text: '   ' }), /批注不能为空/)
  assert.equal(Object.keys(state.commentsByScope).length, 0)
})

test('submitRound packages only staged comments in the current scope', () => {
  let state = Core.createInitialState()
  state = Core.setStage(state, 'draft')
  state = Core.setPage(state, 'page-04')
  state = Core.addComment(state, { text: '调整标题。' }).state
  state = Core.addComment(state, { text: '拆分三个并列要点。' }).state

  state = Core.setPage(state, 'page-03')
  state = Core.addComment(state, { text: '第03页独立批注。' }).state
  state = Core.setPage(state, 'page-04')

  const submitted = Core.submitRound(state, { now: '2026-09-01T10:00:00.000Z' })

  assert.equal(submitted.payload.schemaVersion, 'report-studio.prototype.v1')
  assert.equal(submitted.payload.stage, 'draft')
  assert.equal(submitted.payload.scopeKey, 'draft:page-04')
  assert.equal(submitted.payload.pageId, 'page-04')
  assert.equal(submitted.payload.comments.length, 2)
  assert.ok(submitted.payload.comments.every(comment => comment.text !== '第03页独立批注。'))
  assert.equal(submitted.round.status, 'processing')
  assert.ok(submitted.state.commentsByScope['draft:page-04'].every(comment => comment.status === 'submitted'))
  assert.equal(submitted.state.commentsByScope['draft:page-03'][0].status, 'staged')
})

test('submitRound rejects scopes without staged comments', () => {
  const state = Core.createInitialState()
  assert.throws(() => Core.submitRound(state), /没有待提交的批注/)
})

test('completeRound records an Agent response without merging another scope', () => {
  let state = Core.createInitialState()
  state = Core.setStage(state, 'layout')
  state = Core.setPage(state, 'page-04')
  state = Core.addComment(state, { text: '右侧主视觉收窄 8%。' }).state
  const submitted = Core.submitRound(state, { now: '2026-09-01T10:00:00.000Z' })

  const completed = Core.completeRound(submitted.state, submitted.round.id, {
    summary: '已生成版式调整建议。',
    changes: ['主视觉宽度减少 8%', '标题区留白增加'],
  }, { now: '2026-09-01T10:00:02.000Z' })

  assert.equal(completed.round.status, 'ready')
  assert.equal(completed.round.result.summary, '已生成版式调整建议。')
  assert.equal(completed.state.agentMessagesByScope['layout:page-04'].length, 1)
  assert.equal(completed.state.agentMessagesByScope['draft:page-04']?.length ?? 0, 0)
  assert.ok(completed.state.commentsByScope['layout:page-04'].every(comment => comment.status === 'responded'))
})

test('page selection is retained independently for draft and layout stages', () => {
  let state = Core.createInitialState()
  state = Core.setStage(state, 'draft')
  state = Core.setPage(state, 'page-03')
  state = Core.setStage(state, 'layout')
  state = Core.setPage(state, 'page-05')
  state = Core.setStage(state, 'draft')
  assert.equal(Core.getActivePageId(state), 'page-03')
  state = Core.setStage(state, 'layout')
  assert.equal(Core.getActivePageId(state), 'page-05')
})
