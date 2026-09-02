const test = require('node:test')
const assert = require('node:assert/strict')
const Core = require('../src/studio-model.js')

function createSubmittedDraftRound() {
  let state = Core.createInitialState()
  state = Core.setStage(state, 'draft')
  state = Core.setPage(state, 'page-04')
  state = Core.addComment(state, { text: '压缩标题。', createdAt: '2026-09-01T08:00:00.000Z' }).state
  state = Core.addComment(state, { text: '拆分正文。', createdAt: '2026-09-01T08:01:00.000Z' }).state
  state = Core.addComment(state, { text: '替换主图。', createdAt: '2026-09-01T08:02:00.000Z' }).state
  const submitted = Core.submitRound(state, { now: '2026-09-01T08:05:00.000Z' })
  const completed = Core.completeRound(submitted.state, submitted.round.id, {
    summary: '已返回三项修改建议。',
    changes: ['标题', '正文', '主图'],
  }, { now: '2026-09-01T08:05:03.000Z' })
  return completed
}

test('batch statistics distinguish completed and unfinished comments', () => {
  let { state, round } = createSubmittedDraftRound()

  let stats = Core.getBatchStats(state, round.scopeKey, round.id)
  assert.deepEqual(stats, {
    total: 3,
    completed: 0,
    unfinished: 3,
    submittable: 3,
    processing: 0,
  })

  const firstComment = state.commentsByScope[round.scopeKey][0]
  const secondComment = state.commentsByScope[round.scopeKey][1]
  state = Core.setCommentCompleted(state, firstComment.id, true, { now: '2026-09-01T08:06:00.000Z' })
  state = Core.setCommentCompleted(state, secondComment.id, true, { now: '2026-09-01T08:06:01.000Z' })

  stats = Core.getBatchStats(state, round.scopeKey, round.id)
  assert.equal(stats.completed, 2)
  assert.equal(stats.unfinished, 1)
  assert.equal(stats.submittable, 1)
})

test('submitting a historical batch keeps the same round and sends only unfinished comments', () => {
  let { state, round } = createSubmittedDraftRound()
  const comments = state.commentsByScope[round.scopeKey]
  state = Core.setCommentCompleted(state, comments[0].id, true)
  state = Core.setCommentCompleted(state, comments[1].id, true)

  const resubmitted = Core.submitRound(state, {
    roundId: round.id,
    now: '2026-09-01T08:10:00.000Z',
  })

  assert.equal(resubmitted.round.id, round.id)
  assert.equal(resubmitted.payload.roundId, round.id)
  assert.equal(resubmitted.payload.submissionNumber, 2)
  assert.deepEqual(resubmitted.payload.comments.map(comment => comment.id), [comments[2].id])
  assert.equal(resubmitted.state.roundsByScope[round.scopeKey].length, 1)
  assert.equal(resubmitted.state.commentsByScope[round.scopeKey][0].status, 'completed')
  assert.equal(resubmitted.state.commentsByScope[round.scopeKey][2].status, 'submitted')
})

test('a historical batch accepts added and edited comments without creating a new batch', () => {
  let { state, round } = createSubmittedDraftRound()
  const original = state.commentsByScope[round.scopeKey][0]

  state = Core.addComment(state, {
    text: '补充说明接口边界。',
    roundId: round.id,
    createdAt: '2026-09-01T08:20:00.000Z',
  }).state
  const added = state.commentsByScope[round.scopeKey].at(-1)
  assert.equal(added.submittedRoundId, round.id)
  assert.ok(state.roundsByScope[round.scopeKey][0].commentIds.includes(added.id))

  state = Core.updateComment(state, original.id, '标题压缩为一句结论。', {
    now: '2026-09-01T08:21:00.000Z',
  })
  const edited = state.commentsByScope[round.scopeKey].find(comment => comment.id === original.id)
  assert.equal(edited.text, '标题压缩为一句结论。')
  assert.equal(edited.status, 'staged')

  const stats = Core.getBatchStats(state, round.scopeKey, round.id)
  assert.equal(stats.total, 4)
  assert.equal(stats.submittable, 4)
})
