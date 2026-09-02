const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const app = fs.readFileSync(path.resolve(__dirname, '../prototype/app.js'), 'utf8')

test('Agent completion summary is bound to the submitted payload page, not later navigation state', () => {
  assert.match(app, /submitted\.payload\.pageId/)
  assert.doesNotMatch(app, /window\.setTimeout\(\(\) => \{\s*const page = getActivePage\(\)/)
})

test('export-state click handler is registered only once', () => {
  const matches = app.match(/el\.exportState\.addEventListener\('click', exportState\)/g) || []
  assert.equal(matches.length, 1)
})
