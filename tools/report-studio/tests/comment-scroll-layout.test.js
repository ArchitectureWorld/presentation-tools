const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'prototype/index.html'), 'utf8')
const css = fs.readFileSync(path.join(root, 'prototype/styles.css'), 'utf8')
const app = fs.readFileSync(path.join(root, 'prototype/app.js'), 'utf8')
const browserVerifier = fs.readFileSync(path.join(root, 'scripts/verify-browser.js'), 'utf8')

test('comment batches use a dedicated independently scrollable middle region', () => {
  assert.match(html, /class="comment-scroll-region"/)
  assert.match(html, /id="comment-list"[^>]*role="region"[^>]*tabindex="0"/)
  assert.match(html, /aria-label="批注批次列表，可上下滚动"/)

  assert.match(css, /grid-template-rows:\s*72px\s+auto\s+minmax\(0,\s*1fr\)/)
  assert.match(css, /\.workspace-shell\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s)
  assert.match(css, /\.comment-panel\s*\{[^}]*height:\s*100%[^}]*max-height:\s*100%/s)
  assert.match(css, /\.comment-scroll-region\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s)
  assert.match(css, /\.comment-list\s*\{[^}]*height:\s*100%[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain[^}]*scrollbar-gutter:\s*stable/s)
  assert.match(css, /\.comment-list\s*\{[^}]*grid-auto-rows:\s*max-content/s)
})

test('the independent batch scroller has an obvious persistent scrollbar treatment', () => {
  assert.match(css, /scrollbar-color:/)
  assert.match(css, /\.comment-list::\-webkit-scrollbar\s*\{/)
  assert.match(css, /\.comment-list::\-webkit-scrollbar-thumb\s*\{/)
  assert.match(css, /\.comment-scroll-region::before/)
  assert.match(css, /\.comment-scroll-region::after/)
})

test('comment-list scroll position is retained per scope when batches rerender', () => {
  assert.match(app, /commentScrollTopByScope/)
  assert.match(app, /rememberCommentScroll/)
  assert.match(app, /restoreCommentScroll/)
  assert.match(app, /el\.commentList\.addEventListener\('scroll'/)
})

test('browser verification proves the batch list scrolls while header and composer stay fixed', () => {
  assert.doesNotMatch(browserVerifier, /--hide-scrollbars/)
  assert.match(browserVerifier, /scrollHeight\s*>\s*commentList\.clientHeight/)
  assert.match(browserVerifier, /composerRectBefore/)
  assert.match(browserVerifier, /composerRectAfter/)
  assert.match(browserVerifier, /draft-stage-comment-scroll\.png/)
  assert.match(browserVerifier, /scopeScrollPositionRestored/)
})
