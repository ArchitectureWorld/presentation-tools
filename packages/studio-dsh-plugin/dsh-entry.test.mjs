import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const publicFile = name => new URL(`../../apps/studio-local/public/${name}`, import.meta.url)

function createNode(initial = {}) {
  return {
    hidden: true,
    textContent: '',
    classList: {
      values: new Set(),
      add(...values) { for (const value of values) this.values.add(value) },
      contains(value) { return this.values.has(value) },
    },
    ...initial,
  }
}

async function runNativeRuntime({ embedded }) {
  const source = await readFile(publicFile('dsh-native-runtime.js'), 'utf8')
  const notice = createNode()
  const returnLink = createNode({ href: '/' })
  const agentStatus = createNode()
  const documentElement = createNode()
  const nodes = new Map([
    ['#report-studio-standalone-notice', notice],
    ['#report-studio-return-dsh', returnLink],
    ['#agent-status', agentStatus],
  ])
  const document = {
    documentElement,
    activeElement: null,
    body: { appendChild() {} },
    querySelector(selector) { return nodes.get(selector) ?? null },
    createElement() { return createNode({ style: {}, addEventListener() {} }) },
  }
  const parent = embedded ? { postMessage() {} } : null
  const window = {
    location: { pathname: '/report-studio/', search: '?sessionId=current-session', origin: 'http://127.0.0.1:3080' },
    fetch: async () => ({ ok: true, clone() { return this }, async json() { return { proposals: [] } } }),
    opener: null,
    setTimeout,
    clearTimeout,
    addEventListener() {},
  }
  window.parent = parent ?? window
  const MutationObserver = class { observe() {} }
  vm.runInNewContext(source, { window, document, URL, URLSearchParams, Response, MutationObserver, Date, Math })
  return { notice, returnLink, documentElement }
}

test('top-level /report-studio shows a non-blocking return-to-DSH notice', async () => {
  const html = await readFile(publicFile('index.html'), 'utf8')
  assert.match(html, /id="report-studio-standalone-notice"/)
  assert.match(html, /当前为 Report Studio 独立工作台。模型、推理等级和 Agent 会话由 DSH 主界面管理。/)
  assert.match(html, /id="report-studio-return-dsh"[^>]*href="\/"/)

  const { notice, returnLink, documentElement } = await runNativeRuntime({ embedded: false })
  assert.equal(notice.hidden, false)
  assert.equal(returnLink.href, '/')
  assert.equal(documentElement.classList.contains('report-studio-standalone'), true)
})

test('embedded Report Studio keeps the standalone notice hidden and demotes its duplicate Agent UI', async () => {
  const { notice, documentElement } = await runNativeRuntime({ embedded: true })
  assert.equal(notice.hidden, true)
  assert.equal(documentElement.classList.contains('report-studio-dsh-embedded'), true)
})

test('Report Studio does not define a model or reasoning selector', async () => {
  const html = await readFile(publicFile('index.html'), 'utf8')
  assert.doesNotMatch(html, /<select[^>]+(?:model|reasoning|推理|模型)/i)
  assert.doesNotMatch(html, /id="(?:model|reasoning)[^"]*"/i)
})
