const test = require('node:test')
const assert = require('node:assert/strict')
const Core = require('../src/studio-model.js')

function makeDraftState() {
  let state = Core.createInitialState()
  state = Core.setStage(state, 'draft')
  state = Core.setPage(state, 'page-04')
  return state
}

test('completed and unfinished counts are derived independently for each round', () => {
  let state = makeDraftState()
  state = Core.addComment(state, { text: '第一条。' }).state
  state = Core.addComment(state, { text: '第二条。' }).state
  const submitted = Core.submitRound(state, { now: '2026-09-01T08:00:00.000Z' })
  const completed = Core.completeRound(submitted.state, submitted.round.id, {
    summary: 'Agent 已返回。',
    changes: [],
  }, { now: '2026-09-01T08:00:02.000Z' })

  assert.deepEqual(Core.getRoundCommentCounts(completed.state, submitted.round.id), {
    completed: 0,
    unfinished: 2,
    total: 2,
  })

  state = Core.setCommentResolved(completed.state, submitted.round.commentIds[0], true)
  assert.deepEqual(Core.getRoundCommentCounts(state, submitted.round.id), {
    completed: 1,
    unfinished: 1,
    total: 2,
  })
})

test('a historical round accepts additional comments and keeps them in that round', () => {
  let state = makeDraftState()
  state = Core.addComment(state, { text: '第一轮原始批注。' }).state
  const submitted = Core.submitRound(state, { now: '2026-09-01T08:00:00.000Z' })
  state = Core.completeRound(submitted.state, submitted.round.id, {
    summary: 'Agent 已返回。',
    changes: [],
  }, { now: '2026-09-01T08:00:02.000Z' }).state

  const added = Core.addComment(state, {
    text: '补充到第一轮的批注。',
    roundId: submitted.round.id,
    createdAt: '2026-09-01T08:05:00.000Z',
  })

  assert.equal(added.comment.submittedRoundId, submitted.round.id)
  assert.equal(added.comment.status, 'staged')
  const round = added.state.roundsByScope['draft:page-04'][0]
  assert.deepEqual(round.commentIds, [submitted.round.commentIds[0], added.comment.id])
  assert.equal(round.status, 'ready')
})

test('submitting a historical round reuses the same round and submits only unfinished comments', () => {
  let state = makeDraftState()
  state = Core.addComment(state, { text: '已经完成的批注。' }).state
  state = Core.addComment(state, { text: '仍需修改的批注。' }).state
  const first = Core.submitRound(state, { now: '2026-09-01T08:00:00.000Z' })
  state = Core.completeRound(first.state, first.round.id, {
    summary: '第一次返回。',
    changes: [],
  }, { now: '2026-09-01T08:00:02.000Z' }).state
  state = Core.setCommentResolved(state, first.round.commentIds[0], true)
  state = Core.updateComment(state, first.round.commentIds[1], { text: '仍需修改，并补充数据依据。' })

  const second = Core.submitRound(state, {
    roundId: first.round.id,
    now: '2026-09-01T08:10:00.000Z',
  })

  assert.equal(second.round.id, first.round.id)
  assert.equal(second.state.roundsByScope['draft:page-04'].length, 1)
  assert.equal(second.payload.roundId, first.round.id)
  assert.equal(second.payload.submissionNumber, 2)
  assert.equal(second.payload.comments.length, 1)
  assert.equal(second.payload.comments[0].id, first.round.commentIds[1])
  assert.equal(second.round.submissionHistory.length, 2)
  assert.equal(second.round.status, 'processing')
})

test('editing a resolved historical comment reopens it for the same round', () => {
  let state = makeDraftState()
  state = Core.addComment(state, { text: '原始批注。' }).state
  const submitted = Core.submitRound(state, { now: '2026-09-01T08:00:00.000Z' })
  state = Core.completeRound(submitted.state, submitted.round.id, {
    summary: 'Agent 已返回。',
    changes: [],
  }, { now: '2026-09-01T08:00:02.000Z' }).state
  state = Core.setCommentResolved(state, submitted.round.commentIds[0], true)

  const edited = Core.updateComment(state, submitted.round.commentIds[0], {
    text: '原始批注，补充修改要求。',
    updatedAt: '2026-09-01T08:05:00.000Z',
  })

  const comment = edited.commentsByScope['draft:page-04'][0]
  assert.equal(comment.status, 'staged')
  assert.equal(comment.submittedRoundId, submitted.round.id)
  assert.equal(edited.roundsByScope['draft:page-04'][0].status, 'ready')
})

test('processing rounds reject additional comments, edits, and duplicate submissions', () => {
  let state = makeDraftState()
  state = Core.addComment(state, { text: '处理中批注。' }).state
  const submitted = Core.submitRound(state, { now: '2026-09-01T08:00:00.000Z' })

  assert.throws(() => Core.addComment(submitted.state, {
    text: '处理中补充。',
    roundId: submitted.round.id,
  }), /处理中/)
  assert.throws(() => Core.updateComment(submitted.state, submitted.round.commentIds[0], {
    text: '处理中编辑。',
  }), /处理中/)
  assert.throws(() => Core.submitRound(submitted.state, {
    roundId: submitted.round.id,
  }), /处理中/)
})
