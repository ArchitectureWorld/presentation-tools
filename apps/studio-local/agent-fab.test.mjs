import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function element(overrides = {}) {
  return {
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '',
    classList: { toggle() {} },
    focus() {},
    ...overrides,
  };
}

async function loadBrowserApp() {
  const appSource = await readFile(new URL('./public/app.js', import.meta.url), 'utf8');
  const listeners = new Map();
  const elements = new Map([
    ['#toast', element({ hidden: true })],
    ['#project-title', element()],
    ['#revision-number', element()],
    ['#outline-stage', element()],
    ['#draft-stage', element()],
    ['#scope-label', element()],
    ['#annotation-count', element()],
    ['#annotation-target', element()],
    ['#review-history', element()],
    ['#agent-status', element()],
    ['#agent-feed', element()],
    ['#agent-modal', element({ hidden: true })],
    ['#annotation-input', element()],
    ['#agent-input', element()],
  ]);

  const initialState = {
    project: { id: 'project_test', title: '测试项目', currentRevision: 0 },
    ui: { stage: 'outline', activePageId: null },
    outline: [],
    pages: [],
    annotations: [],
    reviewRounds: [],
    reviewSubmissions: [],
    proposals: [],
  };

  const document = {
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

  const context = {
    document,
    fetch: async path => ({
      ok: true,
      async json() {
        return path === '/api/health'
          ? { ok: true, version: 'v0.1.0', agentConfigured: false }
          : structuredClone(initialState);
      },
    }),
    setTimeout() {},
    confirm() { return true; },
    FileReader: class {},
    console,
    structuredClone,
  };

  vm.runInNewContext(appSource, context, { filename: 'app.js' });
  await new Promise(resolve => setImmediate(resolve));

  return { listeners, elements };
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
});
