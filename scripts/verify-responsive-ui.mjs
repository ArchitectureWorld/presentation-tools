#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { createStudioServer } from '../apps/studio-local/server.mjs';

const viewports = [
  { width: 720, height: 900, name: '0720x0900' },
  { width: 820, height: 900, name: '0820x0900' },
  { width: 1024, height: 768, name: '1024x0768' },
  { width: 1366, height: 768, name: '1366x0768' },
  { width: 1600, height: 900, name: '1600x0900' },
  { width: 1920, height: 1080, name: '1920x1080' },
];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function findBrowser() {
  const configured = process.env.CHROMIUM_PATH;
  const windowsCandidates = process.platform === 'win32'
    ? [
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
    : [];
  const candidates = [
    configured,
    ...windowsCandidates,
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error('未找到 Chromium/Chrome，请设置 CHROMIUM_PATH');
}

async function waitForJson(url, timeoutMs = 12000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Chromium DevTools 未就绪：${lastError?.message || url}`);
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const runtimeErrors = [];
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`));
      else request.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') runtimeErrors.push(message.params.entry);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') runtimeErrors.push(message.params);
  };

  async function send(method, params = {}) {
    await ready;
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(`浏览器执行失败：${result.exceptionDetails.text}`);
    return result.result.value;
  }

  return { send, evaluate, runtimeErrors, close: () => socket.close() };
}

async function clickCenter(cdp, selector) {
  const rect = await cdp.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  assert.ok(rect && rect.width > 0 && rect.height > 0, `无法点击 ${selector}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await delay(120);
}

async function waitFor(cdp, expression, description, timeoutMs = 7000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await cdp.evaluate(`Boolean(${expression})`)) return;
    await delay(80);
  }
  throw new Error(`等待超时：${description}`);
}

async function seed(baseUrl) {
  let latest = await fetch(`${baseUrl}/api/state`).then(response => response.json());
  const post = async body => fetch(`${baseUrl}/api/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, baseRevision: latest.project.currentRevision }),
  }).then(async response => {
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message || value.error || `HTTP ${response.status}`);
    latest = value;
    return latest;
  });

  let state = await post({ type: 'project.rename', title: 'Report Studio v0.1.1 响应式验收' });
  state = await post({ type: 'outline.add', parentId: null, title: '项目背景与目标' });
  const rootId = state.outline[0].id;
  state = await post({ type: 'outline.add', parentId: rootId, title: '建设背景与现状' });
  const childId = state.outline[0].children[0].id;
  state = await post({ type: 'draft.ensurePage', outlineNodeId: childId });
  const pageId = state.pages[0].id;
  state = await post({
    type: 'draft.update',
    pageId,
    patch: {
      heading: '建设目标与实施边界',
      body: '本页用于验证深色原型视觉、草案编辑结构以及不同窗口尺寸下的自适应能力。',
      bullets: ['明确第一阶段建设目标', '大纲与草案优先投入使用', '正式排版延期到 v0.2.0'],
      script: '先说明目标，再解释范围，最后明确第二阶段排版计划。',
      assets: [],
    },
  });
  await post({
    type: 'annotation.add',
    scopeKey: `draft:${pageId}`,
    target: { type: 'page', id: pageId, label: '建设目标与实施边界' },
    instruction: '标题还可以进一步压缩，突出第一阶段可直接使用。',
  });
  await post({ type: 'ui.setStage', stage: 'outline' });
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'report-studio-responsive-data-'));
  const browserProfile = await mkdtemp(join(tmpdir(), 'report-studio-responsive-browser-'));
  const screenshotDir = process.env.REPORT_STUDIO_UI_SCREENSHOT_DIR || join(tmpdir(), 'report-studio-responsive-screenshots');
  await mkdir(screenshotDir, { recursive: true });

  const app = await createStudioServer({ dataDir, port: 0 });
  await app.start();
  const baseUrl = `http://127.0.0.1:${app.port}`;
  await seed(baseUrl);

  const debuggingPort = await getFreePort();
  const browser = spawn(findBrowser(), [
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
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${browserProfile}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const browserExit = new Promise(resolve => browser.once('exit', resolve));

  let cdp;
  try {
    await waitForJson(`http://127.0.0.1:${debuggingPort}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${debuggingPort}/json/list`);
    const pageTarget = targets.find(target => target.type === 'page');
    assert.ok(pageTarget, '缺少 Chromium 页面目标');
    cdp = createCdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    const publicDir = new URL('../apps/studio-local/public/', import.meta.url);
    const [htmlSource, cssSource, nativeSource, appSource, seededState, seededHealth] = await Promise.all([
      readFile(new URL('index.html', publicDir), 'utf8'),
      readFile(new URL('styles.css', publicDir), 'utf8'),
      readFile(new URL('dsh-native-runtime.js', publicDir), 'utf8'),
      readFile(new URL('app.js', publicDir), 'utf8'),
      fetch(`${baseUrl}/api/state`).then(response => response.json()),
      fetch(`${baseUrl}/api/health`).then(response => response.json()),
    ]);
    const fetchStub = `
      <script>
        (() => {
          let state = ${JSON.stringify(seededState)};
          const health = ${JSON.stringify(seededHealth)};
          const clone = value => JSON.parse(JSON.stringify(value));
          window.fetch = async (path, options = {}) => {
            let value;
            if (path === '/api/health') value = health;
            else if (path === '/api/state') value = clone(state);
            else if (path === '/api/action') {
              const action = JSON.parse(options.body || '{}');
              if (action.type === 'ui.setStage') state.ui.stage = action.stage;
              if (action.type === 'ui.setPage') state.ui.activePageId = action.pageId;
              value = clone(state);
            } else if (path === '/api/agent/chat') {
              return { ok: false, status: 503, async json() { return { error: 'DSH Bridge 未配置' }; } };
            } else value = clone(state);
            return { ok: true, status: 200, async json() { return clone(value); } };
          };
        })();
      <\/script>`;
    const inlineScript = source => source.replaceAll('</script>', '<\/script>');
    const inlineDocument = htmlSource
      .replace(/<link rel="stylesheet" href="(?:\.\/|\/)styles\.css">/, `<style>${cssSource}</style>`)
      .replace(/<script src="(?:\.\/|\/)dsh-native-runtime\.js"><\/script>/, `<script>${inlineScript(nativeSource)}<\/script>`)
      .replace(/<script type="module" src="(?:\.\/|\/)app\.js"><\/script>/, `${fetchStub}<script type="module">${inlineScript(appSource)}<\/script>`);
    const frameTree = await cdp.send('Page.getFrameTree');
    await cdp.send('Page.setDocumentContent', {
      frameId: frameTree.frameTree.frame.id,
      html: inlineDocument,
    });
    await waitFor(cdp, `document.readyState === 'complete' && document.querySelector('#project-title')`, 'Report Studio 加载');
    await waitFor(cdp, `document.querySelector('#project-title').value.includes('响应式验收')`, '项目数据加载');

    const results = [];
    for (const viewport of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(180);

      await cdp.evaluate(`document.querySelector('[data-stage="outline"]').click()`);
      await waitFor(cdp, `document.querySelector('[data-stage="outline"]').classList.contains('active')`, '大纲阶段切换');

      const outlineMetrics = await cdp.evaluate(`(() => {
        const body = document.body;
        const shell = document.querySelector('.workspace-shell').getBoundingClientRect();
        const stage = document.querySelector('.stage-workspace').getBoundingClientRect();
        const panel = document.querySelector('.comment-panel').getBoundingClientRect();
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollWidth: Math.max(document.documentElement.scrollWidth, body.scrollWidth),
          shellWidth: shell.width,
          stageWidth: stage.width,
          panelWidth: panel.width,
          topbarHeight: topbar.height,
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          background: getComputedStyle(body).backgroundImage,
        };
      })()`);

      assert.ok(outlineMetrics.scrollWidth <= viewport.width + 1, `${viewport.name} 出现水平溢出：${outlineMetrics.scrollWidth}`);
      assert.ok(outlineMetrics.stageWidth > 300, `${viewport.name} 主工作区过窄`);
      assert.ok(outlineMetrics.panelWidth >= 275, `${viewport.name} 批注栏过窄`);
      assert.equal(outlineMetrics.colorScheme, 'dark');
      assert.match(outlineMetrics.background, /gradient/i);

      const outlineShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      await writeFile(join(screenshotDir, `${viewport.name}-outline.png`), Buffer.from(outlineShot.data, 'base64'));

      await cdp.evaluate(`document.querySelector('[data-stage="draft"]').click()`);
      await waitFor(cdp, `document.querySelector('[data-stage="draft"]').classList.contains('active')`, '草案阶段切换');
      await waitFor(cdp, `!document.querySelector('#page-strip').hidden`, '草案页面导航');

      const draftMetrics = await cdp.evaluate(`(() => ({
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        pageStripVisible: !document.querySelector('#page-strip').hidden,
        draftVisible: !document.querySelector('#draft-stage').hidden,
        assetCardVisible: document.querySelector('.asset-card').getBoundingClientRect().width > 0,
      }))()`);
      assert.ok(draftMetrics.scrollWidth <= viewport.width + 1, `${viewport.name} 草案阶段出现水平溢出`);
      assert.equal(draftMetrics.pageStripVisible, true);
      assert.equal(draftMetrics.draftVisible, true);
      assert.equal(draftMetrics.assetCardVisible, true);

      const draftShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      await writeFile(join(screenshotDir, `${viewport.name}-draft.png`), Buffer.from(draftShot.data, 'base64'));

      await clickCenter(cdp, '#agent-fab .agent-orb-image');
      await waitFor(cdp, `!document.querySelector('#agent-modal').hidden`, 'Agent 弹窗打开');
      const agentState = await cdp.evaluate(`(() => ({
        status: document.querySelector('#agent-status').textContent.trim(),
        modalWidth: document.querySelector('.agent-chat-card').getBoundingClientRect().width,
        modalHeight: document.querySelector('.agent-chat-card').getBoundingClientRect().height,
      }))()`);
      assert.equal(agentState.status, 'DSH Bridge 未配置 · 可正常人工编辑');
      assert.ok(agentState.modalWidth <= viewport.width - 10, `${viewport.name} Agent 弹窗超出窗口宽度`);
      assert.ok(agentState.modalHeight <= viewport.height - 10, `${viewport.name} Agent 弹窗超出窗口高度`);

      const agentShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      await writeFile(join(screenshotDir, `${viewport.name}-agent.png`), Buffer.from(agentShot.data, 'base64'));

      await clickCenter(cdp, '#agent-close');
      await waitFor(cdp, `document.querySelector('#agent-modal').hidden`, 'Agent 弹窗关闭');
      results.push({ viewport: viewport.name, outlineMetrics, draftMetrics, agentState });
    }

    assert.deepEqual(cdp.runtimeErrors, [], `浏览器控制台错误：${JSON.stringify(cdp.runtimeErrors)}`);
    console.log('Report Studio responsive UI verification PASS');
    console.log(`viewports=${viewports.map(item => item.name).join(',')}`);
    console.log(`screenshots=${screenshotDir}`);
    for (const result of results) {
      console.log(`${result.viewport}: stage=${Math.round(result.outlineMetrics.stageWidth)} panel=${Math.round(result.outlineMetrics.panelWidth)} modal=${Math.round(result.agentState.modalWidth)}x${Math.round(result.agentState.modalHeight)}`);
    }
  } finally {
    cdp?.close();
    browser.kill('SIGTERM');
    await Promise.race([browserExit, delay(2500)]);
    if (browser.exitCode === null) {
      browser.kill('SIGKILL');
      await Promise.race([browserExit, delay(1000)]);
    }
    await app.stop();
    await rm(dataDir, { recursive: true, force: true });
    await rm(browserProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
