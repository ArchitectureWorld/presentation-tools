const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

test('prototype shell exposes the three fixed stages and keeps Agent submission inside comment batches', () => {
  const html = read('prototype/index.html')
  assert.match(html, /大纲阶段/)
  assert.match(html, /草案阶段/)
  assert.match(html, /排版阶段/)
  assert.doesNotMatch(html, /id="submit-round"/)
  assert.match(html, /id="add-comment"/)
  assert.doesNotMatch(html, /重新提给Agent/)
  assert.match(html, /添加批注/)
  assert.match(html, /id="agent-fab"/)
  assert.match(html, /id="agent-modal"/)
  assert.match(html, /id="agent-chat-input"/)
})

test('prototype loads only local scripts and styles', () => {
  const html = read('prototype/index.html')
  assert.doesNotMatch(html, /https?:\/\//)
  assert.match(html, /\.\.\/src\/studio-model\.js/)
  assert.match(html, /\.\.\/src\/mock-studio-adapter\.js/)
  assert.match(html, /\.\/styles\.css/)
  assert.match(html, /\.\/app\.js/)
})

test('prototype application includes scoped comment, selection, asset, and Agent handlers', () => {
  const app = read('prototype/app.js')
  for (const token of [
    'handleAddComment',
    'handleSubmitRound',
    'data-submit-round-id',
    'data-continue-round',
    'data-edit-comment',
    'data-toggle-comment-complete',
    'handleTextSelection',
    'openAssetPreview',
    'handleAssetUpload',
    'handleGenerateAsset',
    'data-marker-comment-id',
    'handleAgentChatSubmit',
    'openAgentChat',
    'closeAgentChat',
    'agentChatMessages',
  ]) assert.match(app, new RegExp(token))
})
