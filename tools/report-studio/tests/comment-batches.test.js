const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Core = require('../src/studio-model.js')

function makeDraftState() {
  let state = Core.createInitialState()
  state = Core.setStage(state, 'draft')
  state = Core.setPage(state, 'page-04')
  return state
}

test('comment batch expansion state is stored per scope', () => {
  let state = makeDraftState()
  state = Core.addComment(state, { text: '第一轮批注。', createdAt: '2026-09-01T08:00:00.000Z' }).state
  const submitted = Core.submitRound(state, { now: '2026-09-01T08:10:00.000Z' })

  assert.equal(Core.isRoundExpanded(submitted.state, 'draft:page-04', submitted.round), true)

  const collapsed = Core.setRoundExpanded(submitted.state, 'draft:page-04', submitted.round.id, false)
  assert.equal(Core.isRoundExpanded(collapsed, 'draft:page-04', submitted.round), false)
  assert.equal(collapsed.batchExpansionByScope['layout:page-04'], undefined)
})

test('submitting a new round expands it and collapses older completed rounds in the same scope', () => {
  let state = makeDraftState()
  state = Core.addComment(state, { text: '第一轮批注。', createdAt: '2026-09-01T08:00:00.000Z' }).state
  const firstSubmit = Core.submitRound(state, { now: '2026-09-01T08:10:00.000Z' })
  const firstComplete = Core.completeRound(firstSubmit.state, firstSubmit.round.id, {
    summary: '第一轮完成。',
    changes: [],
  }, { now: '2026-09-01T08:11:00.000Z' })

  state = Core.addComment(firstComplete.state, { text: '第二轮批注。', createdAt: '2026-09-01T09:00:00.000Z' }).state
  const secondSubmit = Core.submitRound(state, { now: '2026-09-01T09:10:00.000Z' })

  assert.equal(Core.isRoundExpanded(secondSubmit.state, 'draft:page-04', firstComplete.round), false)
  assert.equal(Core.isRoundExpanded(secondSubmit.state, 'draft:page-04', secondSubmit.round), true)
})

test('comment batch UI renders current comments and historical rounds as separate accordion groups', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../prototype/app.js'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../prototype/styles.css'), 'utf8')

  assert.match(app, /renderStagedBatch/)
  assert.match(app, /renderRoundBatch/)
  assert.match(app, /data-toggle-round/)
  assert.match(app, /第\$\{roundNumber\}轮/)
  assert.match(app, /formatBatchTime/)
  assert.match(app, /已完成 \${counts\.completed}/)
  assert.match(app, /未完成 \${counts\.unfinished}/)
  assert.match(app, /data-submit-round-id/)
  assert.match(app, /data-continue-round/)
  assert.doesNotMatch(app, /重新提给Agent/)
  assert.match(styles, /\.comment-batch/)
  assert.match(styles, /\.comment-batch-header/)
  assert.match(styles, /\.comment-batch-body/)
})

test('annotation marker focus expands its historical round before locating the comment', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../prototype/app.js'), 'utf8')

  assert.match(app, /comment\.submittedRoundId/)
  assert.match(app, /adapter\.setRoundExpanded\(comment\.scopeKey, comment\.submittedRoundId, true\)/)
})
