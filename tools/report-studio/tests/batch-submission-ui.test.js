const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'prototype/index.html'), 'utf8')
const app = fs.readFileSync(path.join(root, 'prototype/app.js'), 'utf8')

test('Agent submission is rendered inside batches rather than as a global panel button', () => {
  assert.doesNotMatch(html, /id="submit-round"/)
  assert.match(app, /data-submit-batch/)
  assert.match(app, /handleSubmitBatch/)
})

test('all actionable batch submission buttons use the exact label 提给Agent', () => {
  assert.match(app, />提给Agent</)
  assert.doesNotMatch(app, /重新提给Agent|再次提给Agent|重新提交/)
})

test('batch headers show completed and unfinished counts and historical batches can be edited', () => {
  assert.match(app, /已完成[^`]*未完成/)
  assert.match(app, /data-continue-batch/)
  assert.match(app, /data-edit-comment/)
  assert.match(app, /data-toggle-comment-complete/)
})
