import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function browserApp() {
  return readFile(new URL('./public/app.js', import.meta.url), 'utf8')
}

test('browser contract stages a dirty DraftEditBuffer before protected navigation and mutations', async () => {
  const app = await browserApp()
  for (const token of [
    'DraftEditBuffer',
    'flushDraftBuffer',
    'scheduleDraftAutosave',
    'beforeunload',
    'data-retry-draft-buffer',
    'data-discard-draft-buffer',
    "'切换页面'",
    "'结构操作'",
    "'刷新 Proposal'",
  ]) {
    assert.ok(app.includes(token), `missing dirty draft guard: ${token}`)
  }
})

test('opening an existing draft uses operational View actions instead of draft.ensurePage', async () => {
  const app = await browserApp()
  assert.match(app, /existingPage[\s\S]{0,500}type:\s*'ui\.setPage'/)
  assert.match(app, /existingPage[\s\S]{0,800}type:\s*'ui\.setStage'/)
})
