import test from 'node:test'
import assert from 'node:assert/strict'
import * as preview from './layout-preview.mjs'

test('Linux preview prefers the verified Chrome runtime before Edge fallback', () => {
  assert.equal(typeof preview.previewBrowserCandidates, 'function')
  assert.deepEqual(preview.previewBrowserCandidates('linux'), [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ])
})

test('an explicit browser remains the only candidate on all platforms', () => {
  assert.equal(typeof preview.previewBrowserCandidates, 'function')
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.deepEqual(preview.previewBrowserCandidates(platform, '/configured/browser'), ['/configured/browser'])
  }
})

test('Windows and macOS keep their existing browser priorities', () => {
  assert.equal(typeof preview.previewBrowserCandidates, 'function')
  assert.equal(preview.previewBrowserCandidates('win32')[0], 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
  assert.equal(preview.previewBrowserCandidates('darwin')[0], '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
})
