const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'prototype/app.js'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'prototype/styles.css'), 'utf8')
const verifier = fs.readFileSync(path.join(root, 'scripts/verify-browser.js'), 'utf8')

test('comment editing uses an inline editor instead of blocked browser prompts', () => {
  assert.doesNotMatch(app, /window\.prompt\(['"]编辑批注/)
  assert.match(app, /data-edit-comment-input=/)
  assert.match(app, /data-save-comment-edit=/)
  assert.match(app, /data-cancel-comment-edit=/)
})

test('inline comment editor supports save, cancel, and keyboard completion', () => {
  assert.match(app, /handleStartCommentEdit/)
  assert.match(app, /handleSaveCommentEdit/)
  assert.match(app, /handleCancelCommentEdit/)
  assert.match(app, /data-edit-comment-input[\s\S]*event\.key === 'Enter'/)
  assert.match(app, /event\.key === 'Escape'/)
  assert.match(app, /adapter\.editComment\(commentId, \{ text \}\)/)
})

test('inline comment editor has dedicated visible styling', () => {
  assert.match(styles, /\.comment-inline-editor\s*\{/)
  assert.match(styles, /\.comment-inline-editor textarea\s*\{/)
  assert.match(styles, /\.comment-inline-actions\s*\{/)
})

test('browser verifier exercises editing a completed historical comment', () => {
  assert.match(verifier, /data-edit-comment-input/)
  assert.match(verifier, /data-save-comment-edit/)
  assert.match(verifier, /completedCommentEdited/)
  assert.match(verifier, /draft-stage-comment-edit\.png/)
})
