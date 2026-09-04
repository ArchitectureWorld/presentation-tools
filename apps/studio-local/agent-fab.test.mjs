import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function element(overrides = {}) {
  const attributes = new Map();
  return {
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '',
    inert: false,
    classList: { toggle() {} },
    focusCount: 0,
    focus() { this.focusCount += 1; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    ...overrides,
  };
}

async function loadBrowserApp({ fetchImpl } = {}) {
  const appSource = await readFile(new URL('./public/app.js', import.meta.url), 'utf8');
  const listeners = new Map();
  let activeElement = null;
  const elements = new Map([
    ['#app', element()],
    ['#toast', element({ hidden: true })],
    ['#project-title', element()],
    ['#save-status', element()],
    ['#page-strip', element({ hidden: true })],
    ['#revision-number', element()],
    ['#outline-stage', element()],
    ['#draft-stage', element()],
    ['#scope-label', element()],
    ['#annotation-count', element()],
    ['#annotation-target', element()],
    ['#composer-title', element()],
    ['#clear-composer-round', element({ hidden: true })],
    ['#review-history', element()],
    ['#agent-status', element()],
    ['#agent-context-project', element()],
    ['#agent-context-page', element()],
    ['#agent-context-stage', element()],
    ['#agent-feed', element()],
    ['#agent-modal', element({ hidden: true })],
    ['#agent-fab', element()],
    ['#agent-close', element()],
    ['#annotation-input', element()],
    ['#agent-input', element()],
    ['#agent-send', element()],
  ]);

  for (const node of elements.values()) {
    const focus = node.focus.bind(node);
    node.focus = function focusElement() {
      focus();
      activeElement = node;
    };
  }
  elements.get('#agent-modal').querySelectorAll = () => [elements.get('#agent-close'), elements.get('#agent-input'), elements.get('#agent-send')];

  const initialState = {
    project: { id: 'project_test', title: '测试项目', currentRevision: 0 },
    ui: { stage: 'outline', activePageId: null },
    outline: [],
    pages: [],
    annotations: [],
    reviewRounds: [],
    reviewSubmissions: [{
      id: 'submission_1',
      reviewRoundId: 'round_1',
      number: 1,
      baseRevision: 0,
      status: 'dispatch_failed',
      dispatchAttempts: 1,
      createdAt: '2026-09-04T00:00:00.000Z',
    }],
    reviewRuns: [{
      reviewRunId: 'run_1',
      reviewSubmissionId: 'submission_1',
      dispatchAttempt: 1,
      integrationState: 'dispatch_failed',
      lastError: 'DSH Session 暂时离线',
      createdAt: '2026-09-04T00:00:01.000Z',
    }],
    proposals: [],
  };

  const document = {
    get activeElement() { return activeElement; },
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
  };

  const window = {
    setTimeout() {},
    clearTimeout() {},
    requestAnimationFrame(callback) { callback(); },
    confirm() { return true; },
  };

  const context = {
    document,
    window,
    fetch: fetchImpl ?? (async path => ({
      ok: true,
      async json() {
        return path === '/api/health'
          ? { ok: true, version: 'v0.1.0', agentConfigured: false }
          : structuredClone(initialState);
      },
    })),
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    confirm: window.confirm,
    FileReader: class {},
    console,
    structuredClone,
  };

  vm.runInNewContext(appSource, context, { filename: 'app.js' });
  await new Promise(resolve => setImmediate(resolve));

  return { appSource, listeners, elements, document };
}

test('clicking the span inside agent-fab opens the Agent modal', async () => {
  const { listeners, elements } = await loadBrowserApp();
  const agentButton = { id: 'agent-fab' };
  const innerSpan = {
    id: '',
    closest(selector) {
      return selector === '#agent-fab' ? agentButton : null;
    },
  };

  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: innerSpan });
  }

  assert.equal(elements.get('#agent-modal').hidden, false);
  assert.equal(elements.get('#agent-fab').getAttribute('aria-expanded'), 'true');
});

test('Escape closes the accessible Agent modal and returns focus to its FAB trigger', async () => {
  const { listeners, elements } = await loadBrowserApp();
  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { id: '', closest: selector => selector === '#agent-fab' ? { id: 'agent-fab' } : null } });
  }
  for (const listener of listeners.get('keydown') ?? []) await listener({ key: 'Escape' });
  assert.equal(elements.get('#agent-modal').hidden, true);
  assert.equal(elements.get('#agent-fab').getAttribute('aria-expanded'), 'false');
  assert.equal(elements.get('#agent-fab').focusCount, 1);
});

test('Agent modal traps Tab at both ends and makes the background inert until close', async () => {
  const { listeners, elements, document } = await loadBrowserApp();
  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { id: '', closest: selector => selector === '#agent-fab' ? { id: 'agent-fab' } : null } });
  }

  assert.equal(elements.get('#app').inert, true);
  assert.equal(elements.get('#app').getAttribute('aria-hidden'), 'true');
  assert.equal(elements.get('#agent-fab').inert, true);
  assert.equal(elements.get('#agent-fab').getAttribute('aria-hidden'), 'true');

  const keydown = listeners.get('keydown')?.[0];
  elements.get('#agent-send').focus();
  let prevented = 0;
  await keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented += 1; } });
  assert.equal(document.activeElement, elements.get('#agent-close'));

  elements.get('#agent-close').focus();
  await keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented += 1; } });
  assert.equal(document.activeElement, elements.get('#agent-send'));
  assert.equal(prevented, 2);

  await keydown({ key: 'Escape', preventDefault() { prevented += 1; } });
  assert.equal(elements.get('#app').inert, false);
  assert.equal(elements.get('#app').getAttribute('aria-hidden'), null);
  assert.equal(elements.get('#agent-fab').inert, false);
  assert.equal(elements.get('#agent-fab').getAttribute('aria-hidden'), null);
});

test('native iframe keeps the FAB visible and sizes the Agent dialog to about 80 percent', async () => {
  const css = await readFile(new URL('./public/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.report-studio-dsh-native\s+#agent-fab[\s\S]{0,160}display:\s*none\s*!important/);
  const card = css.match(/\.agent-chat-card\s*\{([^}]+)\}/)?.[1] ?? '';
  const width = Number(card.match(/(?:^|\n)\s*width:\s*(\d+)vw/)?.[1]);
  const height = Number(card.match(/(?:^|\n)\s*height:\s*(\d+)dvh/)?.[1]);
  assert.ok(width >= 75 && width <= 85, `unexpected modal width ${width}vw`);
  assert.ok(height >= 75 && height <= 85, `unexpected modal height ${height}dvh`);
});

test('Agent feed exposes project context plus ReviewRun error and retry state', async () => {
  const { listeners, elements } = await loadBrowserApp();
  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { id: '', closest: selector => selector === '#agent-fab' ? { id: 'agent-fab' } : null } });
  }
  assert.equal(elements.get('#agent-context-project').textContent, '测试项目');
  assert.match(elements.get('#agent-feed').innerHTML, /测试项目/);
  assert.match(elements.get('#agent-feed').innerHTML, /第 1 次投递/);
  assert.match(elements.get('#agent-feed').innerHTML, /投递失败/);
  assert.match(elements.get('#agent-feed').innerHTML, /DSH Session 暂时离线/);
  assert.match(elements.get('#agent-feed').innerHTML, /可重试/);
});

test('queued chat status is DOM-only, never impersonates an Agent reply, and clears on reopen', async () => {
  const requests = [];
  const statePayload = {
    project: { id: 'project_chat', title: '聊天项目', currentRevision: 2 },
    ui: { stage: 'draft', activePageId: null },
    outline: [], pages: [], annotations: [], reviewRounds: [], reviewSubmissions: [], reviewRuns: [], proposals: [],
  };
  const { appSource, listeners, elements } = await loadBrowserApp({
    async fetchImpl(path, options = {}) {
      requests.push({ path, options });
      const payload = path === '/api/health'
        ? { ok: true, version: 'v0.1.1', agentConfigured: true }
        : path === '/api/agent/chat'
          ? { message: '已发送到当前 DSH Session', sessionRef: 'session-current' }
          : statePayload;
      return { ok: true, status: 200, async json() { return structuredClone(payload); } };
    },
  });
  assert.doesNotMatch(appSource, /agentFeedEvents|agentChatHistory/);
  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { id: '', closest: selector => selector === '#agent-fab' ? { id: 'agent-fab' } : null } });
  }
  elements.get('#agent-input').value = '请总结当前草案';
  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { id: 'agent-send', closest() { return null; } } });
  }
  const chatRequest = requests.find(request => request.path === '/api/agent/chat');
  assert.equal(JSON.parse(chatRequest.options.body).text, '请总结当前草案');
  assert.match(elements.get('#agent-feed').innerHTML, /请总结当前草案/);
  assert.match(elements.get('#agent-feed').innerHTML, /系统 · 已排队/);
  assert.match(elements.get('#agent-feed').innerHTML, /完整对话请在 DSH 原生时间线查看/);
  assert.doesNotMatch(elements.get('#agent-feed').innerHTML, /<strong>Agent<\/strong>/);

  for (const listener of listeners.get('keydown') ?? []) await listener({ key: 'Escape', preventDefault() {} });
  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { id: '', closest: selector => selector === '#agent-fab' ? { id: 'agent-fab' } : null } });
  }
  assert.doesNotMatch(elements.get('#agent-feed').innerHTML, /请总结当前草案|系统 · 已排队/);
});
