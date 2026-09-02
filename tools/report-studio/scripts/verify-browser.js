#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const artifactPath = path.join(root, 'report-studio-prototype.html')
const screenshotDir = path.join(root, 'screenshots')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForJson(url, timeoutMs = 12000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch (error) {
      lastError = error
    }
    await delay(120)
  }
  throw new Error(`Chromium DevTools did not become ready: ${lastError?.message || url}`)
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  const runtimeErrors = []
  let nextId = 1

  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })

  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(message.error)}`))
      else entry.resolve(message.result)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails)
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') runtimeErrors.push(message.params.entry)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') runtimeErrors.push(message.params)
  }

  async function send(method, params = {}) {
    await ready
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject, method })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async function evaluate(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text}`)
    return result.result.value
  }

  return {
    send,
    evaluate,
    runtimeErrors,
    close() { socket.close() },
  }
}

async function main() {
  assert.ok(fs.existsSync(artifactPath), 'Run npm run build before browser verification')
  fs.mkdirSync(screenshotDir, { recursive: true })

  const port = await getFreePort()
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-studio-chromium-'))
  const logPath = path.join(os.tmpdir(), `report-studio-chromium-${port}.log`)
  const logFd = fs.openSync(logPath, 'w')
  const browser = spawn('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--safebrowsing-disable-auto-update',
    '--mute-audio',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })

  let cdp
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`)
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`)
    const pageTarget = targets.find(target => target.type === 'page')
    assert.ok(pageTarget, 'Chromium page target is missing')
    cdp = createCdpClient(pageTarget.webSocketDebuggerUrl)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    await cdp.evaluate(`(() => {
      const RealDate = Date;
      const fixedIso = '2026-09-01T10:08:00.000Z';
      class FixedDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [fixedIso])); }
        static now() { return new RealDate(fixedIso).valueOf(); }
      }
      window.Date = FixedDate;
    })()`)

    const frameTree = await cdp.send('Page.getFrameTree')
    const html = fs.readFileSync(artifactPath, 'utf8')
    await cdp.send('Page.setDocumentContent', {
      frameId: frameTree.frameTree.frame.id,
      html,
    })

    async function waitFor(expression, description, timeoutMs = 6000) {
      const started = Date.now()
      while (Date.now() - started < timeoutMs) {
        if (await cdp.evaluate(`Boolean(${expression})`)) return
        await delay(80)
      }
      throw new Error(`Timed out waiting for ${description}`)
    }

    async function click(selector) {
      const clicked = await cdp.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return false;
        node.click();
        return true;
      })()`)
      assert.equal(clicked, true, `Unable to click ${selector}`)
      await delay(100)
    }

    async function setValue(selector, value) {
      const changed = await cdp.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return false;
        node.value = ${JSON.stringify(value)};
        node.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`)
      assert.equal(changed, true, `Unable to set ${selector}`)
    }

    async function capture(fileName) {
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      })
      fs.writeFileSync(path.join(screenshotDir, fileName), Buffer.from(shot.data, 'base64'))
    }

    async function stageSnapshot(stage, fileName) {
      await click(`[data-stage="${stage}"]`)
      await waitFor(`document.querySelector('.stage-tab.active')?.dataset.stage === ${JSON.stringify(stage)}`, `${stage} stage`)
      const snapshot = await cdp.evaluate(`(() => {
        const visible = node => Boolean(node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
        const submitButtons = [...document.querySelectorAll('[data-submit-batch]')];
        const batchHeaders = [...document.querySelectorAll('.comment-batch-header')].map(node => node.textContent.replace(/\\s+/g, ' ').trim());
        return {
          stage: document.querySelector('.stage-tab.active')?.dataset.stage,
          scope: document.getElementById('comment-scope-title')?.textContent,
          globalSubmitExists: Boolean(document.querySelector('#submit-round')),
          submitTexts: submitButtons.map(node => node.textContent.trim()),
          visibleSubmitCount: submitButtons.filter(visible).length,
          addText: document.getElementById('add-comment')?.textContent.trim(),
          addVisible: visible(document.getElementById('add-comment')),
          batchCount: document.querySelectorAll('.comment-batch').length,
          batchHeaders,
        };
      })()`)
      assert.equal(snapshot.stage, stage)
      assert.equal(snapshot.globalSubmitExists, false)
      assert.equal(snapshot.addText, '＋ 添加批注')
      assert.equal(snapshot.addVisible, true)
      assert.ok(snapshot.batchCount >= 1)
      assert.ok(snapshot.visibleSubmitCount >= 1, `${stage} should expose a batch-level Agent action`)
      assert.ok(snapshot.submitTexts.every(text => text === '提给Agent'))
      assert.ok(snapshot.batchHeaders.some(text => text.includes('已完成') && text.includes('未完成')))
      await capture(fileName)
      return snapshot
    }

    await waitFor(`document.querySelector('#stage-workspace .stage-panel')`, 'prototype render')

    const draftSnapshot = await stageSnapshot('draft', 'draft-stage.png')
    const outlineSnapshot = await stageSnapshot('outline', 'outline-stage.png')
    const layoutSnapshot = await stageSnapshot('layout', 'layout-stage.png')

    await click('[data-stage="draft"]')
    await click('[data-page-id="page-04"]')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 680,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await delay(160)
    const scrollBefore = await cdp.evaluate(`(() => {
      const commentList = document.getElementById('comment-list');
      const panelHeader = document.querySelector('.comment-panel-header');
      const composer = document.querySelector('.comment-composer');
      const composerRectBefore = composer.getBoundingClientRect();
      const headerRectBefore = panelHeader.getBoundingClientRect();
      return {
        isOverflowing: commentList.scrollHeight > commentList.clientHeight,
        scrollHeight: commentList.scrollHeight,
        clientHeight: commentList.clientHeight,
        composerRectBefore: { top: composerRectBefore.top, bottom: composerRectBefore.bottom },
        headerRectBefore: { top: headerRectBefore.top, bottom: headerRectBefore.bottom },
      };
    })()`)
    assert.equal(scrollBefore.isOverflowing, true, 'Comment batch list should overflow in the compact verification viewport')
    const composerRectBefore = scrollBefore.composerRectBefore
    const headerRectBefore = scrollBefore.headerRectBefore
    await cdp.evaluate(`(() => {
      const commentList = document.getElementById('comment-list');
      commentList.scrollTop = Math.min(180, commentList.scrollHeight - commentList.clientHeight);
      commentList.dispatchEvent(new Event('scroll'));
    })()`)
    await waitFor(`document.getElementById('comment-list').scrollTop > 0`, 'independent comment batch scrolling')
    const scrollAfter = await cdp.evaluate(`(() => {
      const commentList = document.getElementById('comment-list');
      const composerRectAfter = document.querySelector('.comment-composer').getBoundingClientRect();
      const headerRectAfter = document.querySelector('.comment-panel-header').getBoundingClientRect();
      return {
        scrollTop: commentList.scrollTop,
        canScrollUp: document.querySelector('[data-comment-scroll-region]').classList.contains('can-scroll-up'),
        composerRectAfter: { top: composerRectAfter.top, bottom: composerRectAfter.bottom },
        headerRectAfter: { top: headerRectAfter.top, bottom: headerRectAfter.bottom },
      };
    })()`)
    const composerRectAfter = scrollAfter.composerRectAfter
    assert.ok(scrollAfter.scrollTop > 0)
    assert.equal(scrollAfter.canScrollUp, true)
    assert.equal(Math.round(composerRectAfter.top), Math.round(composerRectBefore.top))
    assert.equal(Math.round(composerRectAfter.bottom), Math.round(composerRectBefore.bottom))
    assert.equal(Math.round(scrollAfter.headerRectAfter.top), Math.round(headerRectBefore.top))
    assert.equal(Math.round(scrollAfter.headerRectAfter.bottom), Math.round(headerRectBefore.bottom))
    await capture('draft-stage-comment-scroll.png')

    const scopedScrollTop = scrollAfter.scrollTop
    await click('[data-stage="outline"]')
    await click('[data-stage="draft"]')
    await click('[data-page-id="page-04"]')
    await waitFor(`Math.abs(document.getElementById('comment-list').scrollTop - ${scopedScrollTop}) < 2`, 'comment scroll position restored for draft page scope')
    const restoredScrollTop = await cdp.evaluate(`document.getElementById('comment-list').scrollTop`)
    assert.ok(Math.abs(restoredScrollTop - scopedScrollTop) < 2)
    await cdp.evaluate(`document.getElementById('comment-list').scrollTop = 0`)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await delay(160)

    await click('[data-stage="draft"]')
    await click('[data-page-id="page-04"]')

    await click('[data-stage="layout"]')
    await click('[data-page-id="page-04"]')
    const layoutGeometryBeforeContentEdit = await cdp.evaluate(`(() => {
      const pick = id => {
        const node = document.querySelector('[data-layout-element-id="' + id + '"]');
        return node ? {
          left: node.style.left,
          top: node.style.top,
          width: node.style.width,
          height: node.style.height,
          text: node.textContent.replace(/\s+/g, ' ').trim(),
        } : null;
      };
      return {
        title: pick('layout-page-04-title'),
        body: pick('layout-page-04-body'),
      };
    })()`)
    assert.ok(layoutGeometryBeforeContentEdit.title)
    assert.ok(layoutGeometryBeforeContentEdit.body)

    await click('[data-stage="draft"]')
    await click('[data-page-id="page-04"]')
    await click('[data-edit-page-content]')
    await waitFor(`document.querySelector('[data-draft-editor]')`, 'manual page-content editor')
    const contentEditorState = await cdp.evaluate(`(() => ({
      editButton: Boolean(document.querySelector('[data-edit-page-content]')),
      saveButton: Boolean(document.querySelector('[data-save-page-content]')),
      cancelButton: Boolean(document.querySelector('[data-cancel-page-content]')),
      annotatableTextCount: document.querySelectorAll('.content-column .annotatable-text').length,
      headline: document.querySelector('[data-draft-field="headline"]')?.value,
    }))()`)
    assert.equal(contentEditorState.editButton, false)
    assert.equal(contentEditorState.saveButton, true)
    assert.equal(contentEditorState.cancelButton, true)
    assert.equal(contentEditorState.annotatableTextCount, 0)
    assert.equal(contentEditorState.headline, '构建统一、开放、可持续演进的智慧园区技术底座')
    await capture('draft-stage-content-edit.png')

    const editedHeadline = '统一数据底座，支撑园区持续演进与业务扩展'
    const editedBody = '统一承接设备、业务系统与空间模型，并向上提供可复用能力。'
    const editedBullet = '减少重复建设并打通跨系统数据。'
    const editedMetricValue = '30+'
    const editedMetricLabel = '可扩展业务场景'
    const editedScript = '先解释统一数据底座的价值，再说明它如何支撑业务扩展。'
    await setValue('[data-draft-field="headline"]', editedHeadline)
    await setValue('[data-draft-field="body"]', editedBody)
    await setValue('[data-draft-bullet-index="0"]', editedBullet)
    await setValue('[data-draft-metric-index="2"][data-draft-metric-part="value"]', editedMetricValue)
    await setValue('[data-draft-metric-index="2"][data-draft-metric-part="label"]', editedMetricLabel)
    await setValue('[data-draft-script-index="0"][data-draft-script-part="text"]', editedScript)

    await click('[data-stage="layout"]')
    assert.equal(await cdp.evaluate(`document.querySelector('.stage-tab.active')?.dataset.stage`), 'draft')
    assert.match(await cdp.evaluate(`document.getElementById('toast').textContent`), /请先保存或取消/)

    await click('[data-save-page-content]')
    await waitFor(`!document.querySelector('[data-draft-editor]')`, 'manual page-content save')
    await waitFor(`document.querySelector('[data-target-id="draft-page-04-title"] h2')?.textContent === ${JSON.stringify(editedHeadline)}`, 'saved draft headline')
    assert.equal(await cdp.evaluate(`document.querySelector('[data-target-id="draft-page-04-body"] p')?.textContent`), editedBody)
    assert.equal(await cdp.evaluate(`document.querySelector('[data-target-id="draft-page-04-bullet-1"]')?.textContent.trim()`), editedBullet)
    assert.equal(await cdp.evaluate(`document.querySelector('.metrics-row .metric-card:nth-child(3) strong')?.textContent`), editedMetricValue)
    assert.equal(await cdp.evaluate(`document.querySelector('.script-row span:last-child')?.textContent.trim()`), editedScript)
    await capture('draft-stage-content-saved.png')

    await click('[data-page-id="page-02"]')
    await click('[data-page-id="page-04"]')
    assert.equal(await cdp.evaluate(`document.querySelector('[data-target-id="draft-page-04-title"] h2')?.textContent`), editedHeadline)
    const pageContentManualEdit = true

    await click('[data-stage="layout"]')
    await click('[data-page-id="page-04"]')
    const layoutAfterContentEdit = await cdp.evaluate(`(() => {
      const pick = id => {
        const node = document.querySelector('[data-layout-element-id="' + id + '"]');
        return node ? {
          left: node.style.left,
          top: node.style.top,
          width: node.style.width,
          height: node.style.height,
          text: node.textContent.replace(/\s+/g, ' ').trim(),
        } : null;
      };
      return {
        title: pick('layout-page-04-title'),
        body: pick('layout-page-04-body'),
      };
    })()`)
    assert.equal(layoutAfterContentEdit.title.text, editedHeadline)
    assert.equal(layoutAfterContentEdit.body.text, editedBody)
    assert.deepEqual(
      { ...layoutAfterContentEdit.title, text: undefined },
      { ...layoutGeometryBeforeContentEdit.title, text: undefined },
    )
    assert.deepEqual(
      { ...layoutAfterContentEdit.body, text: undefined },
      { ...layoutGeometryBeforeContentEdit.body, text: undefined },
    )
    const layoutTextSynchronized = true

    await click('[data-stage="draft"]')
    await click('[data-page-id="page-04"]')

    const mixedProgressRoundId = await cdp.evaluate(`(() => {
      const batch = [...document.querySelectorAll('.comment-batch[data-round-id]')]
        .find(node => node.textContent.includes('已完成 1') && node.textContent.includes('未完成 1'));
      return batch?.dataset.roundId || null;
    })()`)
    assert.ok(mixedProgressRoundId, 'Expected a historical batch showing 已完成 1 and 未完成 1')

    const historicalBatchCollapsed = await cdp.evaluate(`document.querySelector('[data-round-id="${mixedProgressRoundId}"]')?.dataset.batchExpanded === 'false'`)
    assert.equal(historicalBatchCollapsed, true)

    const historicalReference = await cdp.evaluate(`(() => {
      const marker = document.querySelector('[data-target-id="draft-page-04-title"] [data-marker-comment-id]');
      return marker ? { commentId: marker.dataset.markerCommentId } : null;
    })()`)
    assert.ok(historicalReference, 'Expected a title annotation marker')
    await click(`[data-marker-comment-id="${historicalReference.commentId}"]`)
    await waitFor(`document.getElementById('comment-${historicalReference.commentId}')`, 'historical comment revealed from marker')
    const markerExpandedHistoricalBatch = await cdp.evaluate(`document.querySelector('[data-round-id="${mixedProgressRoundId}"]')?.dataset.batchExpanded === 'true'`)
    assert.equal(markerExpandedHistoricalBatch, true)

    await click('[data-target-id="draft-page-04-title"]')
    const beforeCount = Number(await cdp.evaluate(`document.getElementById('comment-count').textContent`))
    await setValue('#comment-input', '将标题改为一句更明确的页面结论。')
    await click('#add-comment')
    await waitFor(`Number(document.getElementById('comment-count').textContent) === ${beforeCount + 1}`, 'single comment addition')

    const currentSubmitSelector = '.comment-batch-current [data-submit-batch="current"]'
    assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(currentSubmitSelector)})?.textContent.trim()`), '提给Agent')
    await click(currentSubmitSelector)
    await waitFor(`document.querySelector('.comment-batch[data-round-id] .batch-status-processing')`, 'batch Agent processing state')
    await waitFor(`document.querySelector('.comment-batch[data-round-id] .agent-card')`, 'Agent completion', 6000)

    const latestRoundId = await cdp.evaluate(`document.querySelector('.comment-batch[data-round-id]')?.dataset.roundId`)
    assert.ok(latestRoundId)
    const latestCompleteButton = `[data-round-id="${latestRoundId}"] [data-toggle-comment-complete]`
    await click(latestCompleteButton)
    await waitFor(`document.querySelector('[data-round-id="${latestRoundId}"]')?.textContent.includes('已完成 1')`, 'completed counter update')

    const completedComment = await cdp.evaluate(`(() => {
      const batch = document.querySelector('[data-round-id="${latestRoundId}"]');
      const editButton = batch?.querySelector('[data-edit-comment]');
      const card = editButton?.closest('[data-comment-id]');
      return card ? {
        commentId: card.dataset.commentId,
        text: card.querySelector('p')?.textContent || '',
      } : null;
    })()`)
    assert.ok(completedComment, 'Expected the completed comment to remain editable')
    await click(`[data-edit-comment="${completedComment.commentId}"]`)
    const inlineEditSelector = `[data-edit-comment-input="${completedComment.commentId}"]`
    await waitFor(`document.querySelector(${JSON.stringify(inlineEditSelector)})`, 'inline comment editor')
    assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(inlineEditSelector)}).value`), completedComment.text)
    const editedCommentText = `${completedComment.text}（已编辑）`
    await setValue(inlineEditSelector, editedCommentText)
    await capture('draft-stage-comment-edit.png')
    await click(`[data-save-comment-edit="${completedComment.commentId}"]`)
    await waitFor(`!document.querySelector(${JSON.stringify(inlineEditSelector)})`, 'inline comment editor closed after save')
    await waitFor(`document.getElementById('comment-${completedComment.commentId}')?.textContent.includes(${JSON.stringify(editedCommentText)})`, 'edited comment text persisted')
    await waitFor(`document.getElementById('comment-${completedComment.commentId}')?.querySelector('.status-staged')`, 'edited comment returned to unfinished state')
    assert.equal(await cdp.evaluate(`document.querySelector('[data-round-id="${latestRoundId}"] [data-submit-batch]')?.textContent.trim()`), '提给Agent')

    const roundCountBeforeHistoricalSubmit = Number(await cdp.evaluate(`document.querySelectorAll('.comment-batch[data-round-id]').length`))
    const historicalBatchSelector = `[data-round-id="${mixedProgressRoundId}"]`
    if (await cdp.evaluate(`document.querySelector(${JSON.stringify(historicalBatchSelector)})?.dataset.batchExpanded === 'false'`)) {
      await click(`${historicalBatchSelector} [data-toggle-round]`)
    }
    await click(`${historicalBatchSelector} [data-continue-batch]`)
    assert.match(await cdp.evaluate(`document.getElementById('composer-title').textContent`), /加入第\d+轮/)
    await setValue('#comment-input', '补充到历史批次的新要求。')
    await click('#add-comment')
    await waitFor(`document.querySelector(${JSON.stringify(historicalBatchSelector)})?.textContent.includes('未完成 2')`, 'historical batch progress update')
    assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(`${historicalBatchSelector} [data-submit-batch]`)})?.textContent.trim()`), '提给Agent')
    await click(`${historicalBatchSelector} [data-submit-batch]`)
    await waitFor(`document.querySelector(${JSON.stringify(historicalBatchSelector)})?.querySelector('.batch-status-processing')`, 'historical batch processing')
    await waitFor(`document.querySelector(${JSON.stringify(historicalBatchSelector)})?.textContent.includes('第2次提交')`, 'second submission returned', 6000)
    const roundCountAfterHistoricalSubmit = Number(await cdp.evaluate(`document.querySelectorAll('.comment-batch[data-round-id]').length`))
    assert.equal(roundCountAfterHistoricalSubmit, roundCountBeforeHistoricalSubmit)

    const draftCount = Number(await cdp.evaluate(`document.getElementById('comment-count').textContent`))
    await click('[data-stage="outline"]')
    const outlineBefore = Number(await cdp.evaluate(`document.getElementById('comment-count').textContent`))
    await setValue('#comment-input', '整份大纲还需要增加结尾总结章节。')
    await click('#add-comment')
    await waitFor(`Number(document.getElementById('comment-count').textContent) === ${outlineBefore + 1}`, 'outline comment addition')
    await click('[data-stage="draft"]')
    assert.equal(Number(await cdp.evaluate(`document.getElementById('comment-count').textContent`)), draftCount)

    await click('[data-page-id="page-02"]')
    assert.equal(await cdp.evaluate(`document.getElementById('comment-scope-title').textContent`), '批注 · 第02页')
    assert.equal(Number(await cdp.evaluate(`document.getElementById('comment-count').textContent`)), 0)
    await click('[data-page-id="page-04"]')
    assert.equal(Number(await cdp.evaluate(`document.getElementById('comment-count').textContent`)), draftCount)

    await click('[data-preview-asset]')
    await waitFor(`document.getElementById('asset-modal').hidden === false`, 'asset preview modal')
    await click('[data-close-modal]')

    assert.deepEqual(cdp.runtimeErrors, [], `Browser runtime errors: ${JSON.stringify(cdp.runtimeErrors)}`)

    const result = {
      artifact: path.basename(artifactPath),
      stages: [outlineSnapshot, draftSnapshot, layoutSnapshot],
      interactions: {
        singleCommentAdded: true,
        batchScopedSubmit: true,
        unifiedAgentLabel: true,
        completedAndUnfinishedCounters: true,
        historicalBatchContinued: true,
        historicalBatchSecondSubmission: true,
        sameRoundRetained: true,
        pageScopeIsolation: true,
        assetPreviewOpened: true,
        historicalBatchCollapsed,
        markerExpandedHistoricalBatch,
        independentCommentScroll: true,
        fixedCommentHeaderAndComposer: true,
        scopeScrollPositionRestored: true,
        completedCommentEdited: true,
        pageContentManualEdit,
        layoutTextSynchronized,
      },
      screenshots: ['outline-stage.png', 'draft-stage.png', 'layout-stage.png', 'draft-stage-comment-scroll.png', 'draft-stage-comment-edit.png', 'draft-stage-content-edit.png', 'draft-stage-content-saved.png'],
    }
    console.log(JSON.stringify(result, null, 2))
  } finally {
    cdp?.close()
    try { process.kill(-browser.pid, 'SIGTERM') } catch (_) {}
    await delay(300)
    try { process.kill(-browser.pid, 'SIGKILL') } catch (_) {}
    fs.closeSync(logFd)
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
