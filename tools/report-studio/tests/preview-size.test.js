const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

test('single-file preview embeds the Agent orb once and stays below 1 MB', () => {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const artifactPath = path.join(root, `dist/report-studio-prototype-v${version}.html`)
  const html = fs.readFileSync(artifactPath, 'utf8')
  const imageEmbeds = html.match(/data:image\//g) || []
  assert.equal(imageEmbeds.length, 1)
  assert.ok(fs.statSync(artifactPath).size < 1_000_000)
})

test('Agent orb is reused through CSS rather than duplicated in markup and JavaScript', () => {
  const index = read('prototype/index.html')
  const app = read('prototype/app.js')
  const css = read('prototype/styles.css')
  assert.doesNotMatch(index, /data:image\//)
  assert.doesNotMatch(app, /data:image\//)
  assert.equal((css.match(/data:image\//g) || []).length, 1)
  assert.match(index, /class="agent-orb-image"/)
  assert.match(app, /class=\"agent-orb-image\"/)
})
