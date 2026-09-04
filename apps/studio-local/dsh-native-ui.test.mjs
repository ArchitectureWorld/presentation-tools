import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const root = new URL('./public/', import.meta.url)

test('production browser loads the native DSH Session bridge before the application', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8')
  const nativeIndex = html.indexOf('./dsh-native-runtime.js')
  const appIndex = html.indexOf('./app.js')
  assert.ok(nativeIndex >= 0)
  assert.ok(appIndex > nativeIndex)
})

test('native browser bridge binds API and prompts to the current DSH Session', async () => {
  const runtime = await readFile(new URL('dsh-native-runtime.js', root), 'utf8')
  for (const token of [
    "window.location.pathname.startsWith('/report-studio')",
    "type: 'report-studio.prompt'",
    'report-studio.prompt-result',
    'window.parent !== window ? window.parent : window.opener',
    'DSH 原生 Session 已连接',
    "apiPath('/api/state')",
    '/dispatch',
    "reportDispatch(payload.submission?.id, 'dispatch_failed'",
  ]) assert.ok(runtime.includes(token), `missing ${token}`)
})

test('production assets resolve from root and the DSH subpath', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8')
  assert.match(html, /href="\.\/styles\.css"/)
  assert.match(html, /src="\.\/app\.js"/)
  assert.doesNotMatch(html, /href="\/styles\.css"/)
  assert.doesNotMatch(html, /src="\/app\.js"/)
})

test('every top-level Studio page is labelled as a standalone fallback with a return to DSH', async () => {
  const runtime = await readFile(new URL('dsh-native-runtime.js', root), 'utf8')
  const notice = { hidden: true }
  const classes = new Set()
  const window = {
    location: { pathname: '/', search: '', origin: 'http://127.0.0.1:4173' },
  }
  window.parent = window
  vm.runInNewContext(runtime, {
    window,
    URLSearchParams,
    MutationObserver: class {},
    document: {
      documentElement: { classList: { add(value) { classes.add(value) } } },
      querySelector(selector) { return selector === '#report-studio-standalone-notice' ? notice : null },
    },
  }, { filename: 'dsh-native-runtime.js' })
  assert.equal(notice.hidden, false)
  assert.equal(classes.has('report-studio-standalone'), true)

  const html = await readFile(new URL('index.html', root), 'utf8')
  assert.match(html, /id="report-studio-return-dsh" href="\/"/)
})
