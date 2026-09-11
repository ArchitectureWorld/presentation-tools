import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createStudioId } from '../../packages/studio-contracts/index.mjs'
import { createStudioServer } from './server.mjs'
import { previewBrowserCandidates } from './layout-preview.mjs'

const original = Object.freeze({
  heading: '原始标题',
  body: '前文😀待修改后文',
  bullets: ['保留第一条', '条目😀待修改末尾', '保留第三条'],
  script: '讲解稿保持不变',
})
const anchor = Object.freeze({ start: 4, end: 7, quote: '待修改' })
const replacement = '已准确修改'
const diagnosticsRoot = fileURLToPath(new URL(`../../.tmp/point-annotation-browser-${Date.now()}-${process.pid}/`, import.meta.url))

async function browserExecutable() {
  for (const candidate of previewBrowserCandidates(process.platform, process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE)) {
    try { await access(candidate); return candidate } catch {}
  }
  assert.fail('Real browser is required; configure STUDIO_PREVIEW_BROWSER_EXECUTABLE')
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const payload = await response.json()
  assert.equal(response.status, 200, JSON.stringify(payload))
  return payload
}

async function selectQuoteUsingKeyboard(input) {
  await input.click()
  await input.press('ControlOrMeta+Home')
  // ArrowRight follows displayed characters; the emoji occupies two UTF-16 units.
  for (let index = 0; index < 3; index++) await input.press('ArrowRight')
  for (let index = 0; index < 3; index++) await input.press('Shift+ArrowRight')
  assert.deepEqual(await input.evaluate(node => ({
    start: node.selectionStart, end: node.selectionEnd,
    quote: node.value.slice(node.selectionStart, node.selectionEnd),
  })), anchor)
}

function assertPageContent(actual, expected, stableIds) {
  for (const field of ['heading', 'body', 'bullets', 'script']) assert.deepEqual(actual[field], expected[field], field)
  assert.deepEqual(actual.contentBlocks.find(block => block.type === 'list').items.map(item => item.listItemId), stableIds)
}

for (const kind of ['body', 'title', 'list-item']) {
  test(`real browser ${kind} annotation persists its precise target and only applies the requested content`, { timeout: 60_000 }, async t => {
    const dataDir = await mkdtemp(join(tmpdir(), 'studio-point-annotation-'))
    await mkdir(diagnosticsRoot, { recursive: true })
    let submittedContext
    let submitCount = 0
    let expectedTarget
    let expectedContent
    const bridge = {
      configured: true,
      async submit({ submission, context }) {
        submitCount++
        submittedContext = context
        assert.equal(submission.annotationSnapshots.length, 1)
        const annotation = submission.annotationSnapshots[0]
        assert.deepEqual(annotation.target, expectedTarget)
        const command = {
          commandId: createStudioId('command'),
          pageId: expectedTarget.pageId,
          scopeKey: submission.scopeKey,
          baseRevision: submission.baseRevision,
          riskLevel: 'ordinary_reversible',
          sourceAnnotationIds: [annotation.annotationId],
          ...(kind === 'list-item'
            ? { type: 'draft.list.update', listItemId: expectedTarget.id, content: expectedContent.bullets[1] }
            : { type: 'draft.update', patch: kind === 'title' ? { heading: expectedContent.heading } : { body: expectedContent.body } }),
        }
        return {
          submissionId: submission.id, projectId: submission.projectId,
          baseRevision: submission.baseRevision, scopeKey: submission.scopeKey,
          idempotencyKey: submission.idempotencyKey, message: '已完成精确修改', commands: [command],
          annotationResults: [{ annotationId: annotation.annotationId, annotationVersion: annotation.annotationVersion,
            status: 'completed', reason: '仅执行指定目标的修改', commandIds: [command.commandId] }],
        }
      },
    }
    let app
    let browser
    let page
    try {
      app = await createStudioServer({ dataDir, port: 0, host: '127.0.0.1', agentBridge: bridge })
      await app.start()
      const base = `http://127.0.0.1:${app.port}`
      let state = await post(base, '/api/action', { type: 'outline.add', parentId: null, title: original.heading, baseRevision: 0 })
      state = await post(base, '/api/action', { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id, baseRevision: state.project.currentRevision })
      state = await post(base, '/api/action', { type: 'draft.update', pageId: state.pages[0].id, baseRevision: state.project.currentRevision, patch: original })
      const baseline = structuredClone(state.pages[0])
      const baselineRevision = state.project.currentRevision
      const bodyBlock = baseline.contentBlocks.find(block => block.type === 'text' && block.role === 'body')
      const listBlock = baseline.contentBlocks.find(block => block.type === 'list')
      const stableIds = listBlock.items.map(item => item.listItemId)
      expectedContent = structuredClone(original)
      const selectedText = kind === 'body' ? original.body : original.bullets[1]
      const editedText = selectedText.slice(0, anchor.start) + replacement + selectedText.slice(anchor.end)
      if (kind === 'title') expectedContent.heading = '标题已更新'
      else if (kind === 'body') expectedContent.body = editedText
      else expectedContent.bullets[1] = editedText

      browser = await chromium.launch({ executablePath: await browserExecutable(), headless: true })
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      // All application requests stay inside this temporary server; no DSH or model endpoint is reachable.
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort())
      await page.goto(base)
      await page.locator('#draft-body').waitFor()
      const control = kind === 'title' ? '#draft-heading' : kind === 'body' ? '#draft-body' : `[data-list-item-id="${stableIds[1]}"]`
      const button = kind === 'list-item' ? `[data-comment-list-item="${stableIds[1]}"]` : `[data-comment-draft-field="${kind}"]`
      if (kind !== 'title') await selectQuoteUsingKeyboard(page.locator(control))
      await page.locator(button).click()
      const targetLabel = kind === 'title' ? '页面标题' : kind === 'body' ? '正文段落 · “待修改”' : '正文要点：条目😀待修改末尾 · “待修改”'
      expectedTarget = {
        type: kind === 'title' ? 'draft-title' : kind === 'body' ? 'draft-text' : 'draft-list-item',
        id: kind === 'title' ? baseline.titleBlockId : kind === 'body' ? bodyBlock.contentBlockId : stableIds[1],
        pageId: baseline.id,
        blockId: kind === 'title' ? baseline.titleBlockId : kind === 'body' ? bodyBlock.contentBlockId : listBlock.contentBlockId,
        label: targetLabel,
        ...(kind === 'title' ? {} : { selection: anchor }),
      }
      await page.locator('#annotation-input').fill('只修改当前定位内容，其余内容保持原样')
      await page.screenshot({ path: join(diagnosticsRoot, `${kind}-selected.png`), fullPage: true })
      const [savedResponse] = await Promise.all([
        page.waitForResponse(response => response.url() === `${base}/api/action` && response.request().postDataJSON()?.type === 'annotation.add'),
        page.locator('#add-annotation').click(),
      ])
      const saved = await savedResponse.json()
      assert.equal(savedResponse.status(), 200, JSON.stringify(saved))
      assert.equal(saved.annotations.length, 1)
      assert.deepEqual(saved.annotations[0].target, expectedTarget)
      assertPageContent(saved.pages[0], original, stableIds)
      await page.reload()
      await page.locator('[data-annotation-id]').waitFor()
      assert.equal(await page.locator('.comment-target').innerText(), targetLabel)
      const [reviewResponse] = await Promise.all([
        page.waitForResponse(response => response.url() === `${base}/api/review/submit`),
        page.locator('#submit-review').click(),
      ])
      const reviewed = await reviewResponse.json()
      assert.equal(reviewResponse.status(), 200, JSON.stringify(reviewed))
      assert.equal(submitCount, 1)
      assert.deepEqual(submittedContext.annotations[0].target, expectedTarget)
      assert.equal(reviewed.state.project.currentRevision, baselineRevision + 1)
      assert.equal(reviewed.submission.status, 'accepted')
      assert.equal(reviewed.state.annotations[0].resolution, 'resolved')
      assert.equal(reviewed.state.proposals.length, 0)
      assertPageContent(reviewed.state.pages[0], expectedContent, stableIds)
      await page.reload()
      await page.locator('#draft-body').waitFor()
      assert.equal(await page.locator('#draft-body').inputValue(), expectedContent.body)
      assert.equal(await page.locator('#draft-heading').inputValue(), expectedContent.heading)
      assert.deepEqual(await page.locator('[data-list-item-id]').evaluateAll(inputs => inputs.map(input => input.value)), expectedContent.bullets)
      assert.equal(await page.locator('[data-script-block-id]').inputValue(), original.script)
      await page.screenshot({ path: join(diagnosticsRoot, `${kind}-saved.png`), fullPage: true })

      await browser.close(); browser = null
      await app.stop(); app = null
      app = await createStudioServer({ dataDir, port: 0, agentBridge: null })
      const restored = app.repository.getState()
      assertPageContent(restored.pages[0], expectedContent, stableIds)
      assert.deepEqual(restored.annotations[0].target, expectedTarget)
      assert.equal(restored.annotations[0].resolution, 'resolved')
      t.diagnostic(`Real browser, deterministic bridge, temporary repository; screenshots: ${diagnosticsRoot}`)
    } catch (error) {
      await page?.screenshot({ path: join(diagnosticsRoot, `${kind}-failure.png`), fullPage: true }).catch(() => {})
      throw error
    } finally {
      await browser?.close()
      await app?.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
}
