const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'report-studio-prototype.html')

test('single-file builder inlines CSS and scripts without external dependencies', () => {
  fs.rmSync(output, { force: true })
  const result = spawnSync(process.execPath, ['scripts/build-single-file.js'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.ok(fs.existsSync(output))
  const html = fs.readFileSync(output, 'utf8')
  assert.match(html, /<style data-report-studio-inline>/)
  assert.match(html, /<script data-report-studio-core>/)
  assert.match(html, /<script data-report-studio-adapter>/)
  assert.match(html, /<script data-report-studio-app>/)
  assert.doesNotMatch(html, /<link[^>]+stylesheet/)
  assert.doesNotMatch(html, /<script[^>]+src=/)
  assert.doesNotMatch(html, /https?:\/\//)
  assert.doesNotMatch(html, /id="submit-round"/)
  assert.match(html, /data-submit-round-id/)
  assert.match(html, />提给Agent</)
  assert.doesNotMatch(html, /重新提给Agent/)
  assert.match(html, /id="add-comment"[^>]*>＋ 添加批注</)
})
