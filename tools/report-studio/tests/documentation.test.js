const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

test('README documents direct use, local server, tests, build, and browser verification', () => {
  const readme = read('README.md')
  for (const phrase of [
    'report-studio-prototype.html',
    'npm test',
    'npm run build',
    'node scripts/verify-browser.js',
    '添加批注',
    '提给Agent',
    '编辑内容',
    '保存修改',
  ]) assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('DSH integration notes preserve existing contracts and define adapter replacement', () => {
  const integration = read('integration/dsh-client-integration.md')
  assert.match(integration, /不改动 `contracts\/v0\.6`/)
  assert.match(integration, /MockStudioAdapter/)
  assert.match(integration, /DshStudioAdapter/)
  assert.match(integration, /conversation\.session\.header\.actions/)
  assert.match(integration, /outline:root/)
  assert.match(integration, /draft:<pageId>/)
  assert.match(integration, /layout:<pageId>/)
})
