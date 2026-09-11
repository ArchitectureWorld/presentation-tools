import assert from 'node:assert/strict'
import { test } from 'node:test'
import { executeLayoutApi, layoutApiErrorPayload, matchLayoutApiPath } from './layout-api.mjs'

test('layout API path parser supports read, ensure, mutate and reconcile', () => {
  assert.deepEqual(matchLayoutApiPath('/api/layout/pages/page_001'), { pageId: 'page_001', operation: 'read' })
  assert.deepEqual(matchLayoutApiPath('/api/layout/pages/page_001/ensure'), { pageId: 'page_001', operation: 'ensure' })
  assert.deepEqual(matchLayoutApiPath('/report-studio/api/layout/pages/page_001/mutate', '/report-studio/api'), { pageId: 'page_001', operation: 'mutate' })
  assert.equal(matchLayoutApiPath('/api/layout/other'), null)
})

test('layout API delegates with both project and layout CAS values', async () => {
  const calls = []
  const service = {
    async get(value) { calls.push(['get', value]); return { ok: true } },
    async ensure(value) { calls.push(['ensure', value]); return { ok: true } },
    async mutate(value) { calls.push(['mutate', value]); return { ok: true } },
  }
  await executeLayoutApi({ service, method: 'GET', match: { pageId: 'page_001', operation: 'read' } })
  await executeLayoutApi({ service, method: 'POST', match: { pageId: 'page_001', operation: 'ensure' }, body: { baseRevision: 5 } })
  await executeLayoutApi({ service, method: 'POST', match: { pageId: 'page_001', operation: 'mutate' }, body: { baseRevision: 6, expectedLayoutRevision: 2, operation: { type: 'frame' } } })
  assert.deepEqual(calls, [
    ['get', { pageId: 'page_001', reconcile: false }],
    ['ensure', { pageId: 'page_001', baseRevision: 5, source: 'human-layout' }],
    ['mutate', { pageId: 'page_001', baseRevision: 6, expectedLayoutRevision: 2, operation: { type: 'frame' }, source: 'human-layout' }],
  ])
})

test('layout API rejects malformed revisions and returns structured errors', async () => {
  await assert.rejects(
    executeLayoutApi({ service: { get() {}, ensure() {}, mutate() {} }, method: 'POST', match: { pageId: 'page_001', operation: 'ensure' }, body: { baseRevision: '1' } }),
    error => error.code === 'layout_api_invalid_request' && error.status === 400,
  )
  const response = layoutApiErrorPayload(new Error('private details'))
  assert.equal(response.status, 500)
  assert.equal(response.payload.error.code, 'layout_internal_error')
  assert.doesNotMatch(JSON.stringify(response), /private details/u)
})
