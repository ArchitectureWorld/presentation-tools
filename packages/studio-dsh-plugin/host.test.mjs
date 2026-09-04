import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import { apply, inject, name } from './lib/index.js'

const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0])

test('native DSH host plugin loads, registers tools and serves a session-bound health route', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'report-studio-dsh-host-'))
  try {
    const tools = []
    const promptSections = []
    let route
    const ctx = {
      tools: {
        register(definition) {
          tools.push(definition)
          return () => undefined
        },
      },
      systemPrompt: {
        section(definition) {
          promptSections.push(definition)
          return () => undefined
        },
      },
      webServer: {
        host: '127.0.0.1',
        register(definition) {
          route = definition
          return () => undefined
        },
      },
      effect(factory) {
        return factory()
      },
    }

    apply(ctx, { dataDir })

    assert.equal(name, 'report-studio-dsh')
    assert.deepEqual(inject, ['tools', 'webServer', 'systemPrompt'])
    assert.deepEqual(tools.map(tool => tool.name), ['studio_get_context', 'studio_apply_commands'])
    assert.equal(tools[0].parameters.type, 'object')
    assert.deepEqual(tools[0].parameters.required, ['submissionId'])
    assert.deepEqual(tools[0].output.schema, {})
    assert.deepEqual(tools[1].parameters.required, ['submissionId', 'projectId', 'baseRevision', 'scopeKey', 'message', 'commands'])
    assert.equal(tools[1].parameters.additionalProperties, false)
    assert.ok(Array.isArray(tools[1].parameters.properties.commands.items.oneOf))
    assert.ok(tools[1].parameters.properties.commands.items.oneOf.every(branch => branch.additionalProperties === false))
    assert.equal(JSON.stringify(tools[1].parameters).includes('outline.delete'), false)
    assert.equal(promptSections[0].name, 'report-studio-v0.1.1')
    assert.equal(route.kind, 'prefix')
    assert.equal(route.path, '/report-studio')

    await assert.rejects(tools[0].execute({}, { agent: { id: 'session-host-test' } }), error => error.code === 'invalid_command')

    const headers = new Map()
    let body = ''
    const response = {
      statusCode: 0,
      setHeader(key, value) {
        headers.set(String(key).toLowerCase(), String(value))
      },
      end(value = '') {
        body += Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
      },
    }
    await route.handler({
      method: 'GET',
      url: '/report-studio/api/health?sessionId=session-host-test',
    }, response)

    assert.equal(response.statusCode, 200)
    assert.equal(headers.get('content-type'), 'application/json; charset=utf-8')
    const health = JSON.parse(body)
    assert.equal(health.agentMode, 'dsh-native')
    assert.equal(health.agentConfigured, true)
    assert.equal(health.sessionId, 'session-host-test')
    assert.equal(health.securityMode, 'local-single-user-only')
    assert.equal(health.listenHost, '127.0.0.1')
    assert.equal(health.networkSharedSecurity, false)

    const action = async value => {
      body = ''
      await route.handler(Object.assign(Readable.from([Buffer.from(JSON.stringify(value))]), { method: 'POST', url: '/report-studio/api/action?sessionId=session-host-test', headers: { 'content-type': 'application/json' } }), response)
      return JSON.parse(body)
    }
    let state = await action({ type: 'outline.add', parentId: null, title: 'DSH 图片', baseRevision: 0 })
    state = await action({ type: 'draft.ensurePage', outlineNodeId: state.outline[0].id, baseRevision: state.project.currentRevision })
    body = ''
    await route.handler(Object.assign(Readable.from([png]), { method: 'POST', url: `/report-studio/api/assets/ingest?pageId=${state.pages[0].id}&sessionId=session-host-test`, headers: { 'content-type': 'image/png', 'x-file-name': 'dsh.png' } }), response)
    assert.equal(response.statusCode, 200, body)
    const asset = JSON.parse(body)
    let previewBody = Buffer.alloc(0)
    const previewResponse = new Writable({ write(chunk, _encoding, callback) { previewBody = Buffer.concat([previewBody, Buffer.from(chunk)]); callback() } })
    previewResponse.statusCode = 0
    previewResponse.headers = new Map()
    previewResponse.setHeader = (key, value) => previewResponse.headers.set(String(key).toLowerCase(), String(value))
    previewResponse.writeHead = (status, headers) => { previewResponse.statusCode = status; for (const [key, value] of Object.entries(headers)) previewResponse.setHeader(key, value) }
    await route.handler({ method: 'GET', url: `/report-studio/api/assets/${asset.assetId}/content?sessionId=session-host-test` }, previewResponse)
    await once(previewResponse, 'finish')
    assert.equal(previewResponse.statusCode, 200)
    assert.deepEqual(previewBody, png)
    body = ''
    await route.handler({ method: 'GET', url: `/report-studio/api/assets/${asset.assetId}/content?sessionId=other-session` }, response)
    assert.equal(response.statusCode, 404)

    state = await action({ type: 'annotation.add', scopeKey: 'outline:root', instruction: '验证 dispatch guard' })
    body = ''
    await route.handler(Object.assign(Readable.from([Buffer.from(JSON.stringify({ scopeKey: 'outline:root', stage: 'outline' }))]), {
      method: 'POST', url: '/report-studio/api/review/submit?sessionId=session-host-test', headers: { 'content-type': 'application/json' },
    }), response)
    assert.equal(response.statusCode, 200, body)
    const submitted = JSON.parse(body)
    const execBoundContext = await tools[0].execute({
      submissionId: submitted.submission.id,
      sessionId: 'other-session',
    }, { agent: { id: 'session-host-test' } })
    assert.equal(execBoundContext.submission.reviewSubmissionId, submitted.submission.id)
    assert.equal(execBoundContext.project.id, state.project.id)
    const dispatch = async status => {
      body = ''
      await route.handler(Object.assign(Readable.from([Buffer.from(JSON.stringify({ status, reviewRunId: submitted.reviewRun.reviewRunId }))]), {
        method: 'POST', url: `/report-studio/api/review/${submitted.submission.id}/dispatch?sessionId=session-host-test`, headers: { 'content-type': 'application/json' },
      }), response)
      return { statusCode: response.statusCode, payload: JSON.parse(body) }
    }
    assert.equal((await dispatch('dispatched')).statusCode, 200)
    const duplicate = await dispatch('dispatched')
    assert.equal(duplicate.statusCode, 200)
    body = ''
    await route.handler({ method: 'GET', url: '/report-studio/api/state?sessionId=session-host-test' }, response)
    assert.equal(JSON.parse(body).reviewRuns.length, 1)
    const regression = await dispatch('dispatch_failed')
    assert.equal(regression.statusCode, 409)
    assert.equal(regression.payload.error.code, 'invalid_submission_transition')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }

})

test('native DSH host refuses a network-shared web server without a trusted identity hook', () => {
  const ctx = {
    tools: { register() {} },
    systemPrompt: { section() {} },
    webServer: { host: '0.0.0.0', register() {} },
    effect(factory) { return factory() },
  }
  assert.throws(
    () => apply(ctx),
    /local-single-user-only.*127\.0\.0\.1/i,
  )
})
