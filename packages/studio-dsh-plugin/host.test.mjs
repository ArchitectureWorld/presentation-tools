import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import { apply, inject, name } from './lib/index.js'

const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0])

for (const availability of ['absent', 'present', 'delayed', 'incompatible']) {
  test(`optional Pre bridge ${availability} keeps host bootable and binds only inside injection`, async () => {
    const cleanups = []
    let onInject
    let bindings = 0
    let releases = 0
    let routes = 0
    const pre = { designVisualBridge: { protocol: 'pre-design.page-visual.v1', bindStudioResolver(resolver) {
      assert.equal(typeof resolver.resolve, 'function')
      bindings++
      return () => { releases++ }
    } } }
    const effect = factory => { const cleanup = factory(); cleanups.push(cleanup); return cleanup }
    const ctx = {
      tools: { register() {} }, systemPrompt: { section() {} }, sessions: { get() {} },
      webServer: { host: '127.0.0.1', register() { routes++; return () => { routes-- } } },
      get() { return undefined },
      get preplanning() { throw new Error('cannot get property "preplanning" without inject') },
      inject(names, callback) {
        assert.deepEqual(names, ['preplanning'])
        onInject = value => callback({ get: key => key === 'preplanning' ? value : undefined, effect })
        if (availability === 'present') onInject(pre)
        if (availability === 'incompatible') onInject({})
      },
      effect,
    }
    try {
      apply(ctx, { allowNativeReview: true })
      assert.equal(routes, 1)
      assert.equal(bindings, availability === 'present' ? 1 : 0)
      if (availability === 'delayed') { onInject(pre); assert.equal(bindings, 1) }
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup?.()
    }
    assert.equal(routes, 0)
    assert.equal(releases, ['present', 'delayed'].includes(availability) ? 1 : 0)
  })
}

test('native DSH host plugin loads, registers tools and serves a session-bound health route', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'report-studio-dsh-host-'))
  let cleanup
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
      sessions: {
        get(sessionId) {
          return sessionId === 'session-host-test' ? { header: { cwd: dataDir } } : undefined
        },
      },
      effect(factory) {
        cleanup = factory()
        return cleanup
      },
    }

    apply(ctx, { dataDir, allowNativeReview: true })

    assert.equal(name, 'report-studio-dsh')
    assert.deepEqual(inject, ['tools', 'webServer', 'systemPrompt', 'sessions', 'llm', 'apiProxy'])
    assert.ok(['studio_open_workspace_project','studio_reload_upstream','studio_get_context','studio_apply_commands','studio_get_layout_context','studio_prepare_layout_candidate','studio_render_layout_preview','studio_submit_layout_review'].every(name=>tools.some(tool=>tool.name===name)))
    const openWorkspace = tools.find(tool => tool.name === 'studio_open_workspace_project')
    const reloadWorkspace = tools.find(tool => tool.name === 'studio_reload_upstream')
    const getContext = tools.find(tool => tool.name === 'studio_get_context')
    const applyCommands = tools.find(tool => tool.name === 'studio_apply_commands')
    assert.equal(openWorkspace.parameters.additionalProperties, false)
    assert.equal('workspaceRoot' in openWorkspace.parameters.properties, false)
    assert.equal(reloadWorkspace.parameters.additionalProperties, false)
    assert.equal('workspaceRoot' in reloadWorkspace.parameters.properties, false)
    assert.equal(getContext.parameters.type, 'object')
    assert.ok(getContext.parameters.anyOf)
    assert.deepEqual(getContext.output.schema, {})
    assert.deepEqual(applyCommands.parameters.required, ['submissionId', 'projectId', 'baseRevision', 'scopeKey', 'message', 'commands'])
    assert.equal(applyCommands.parameters.additionalProperties, false)
    assert.ok(Array.isArray(applyCommands.parameters.properties.commands.items.oneOf))
    assert.ok(applyCommands.parameters.properties.commands.items.oneOf.every(branch => branch.additionalProperties === false))
    assert.equal(JSON.stringify(applyCommands.parameters).includes('outline.delete'), false)
    assert.equal(promptSections[0].name, 'report-studio-v0.1.1')
    assert.match(promptSections[0].text,/studio_generate_design_visual/)
    assert.match(promptSections[0].text,/studio_resume_design_visual/)
    assert.match(promptSections[0].text,/studio_adopt_design_visual/)
    assert.match(promptSections[0].text,/批注提交后自动应用/)
    assert.doesNotMatch(promptSections[0].text,/creates a Proposal for human confirmation/)
    assert.equal(route.kind, 'prefix')
    assert.equal(route.path, '/report-studio')

    assert.equal((await openWorkspace.execute({}, { agent: { id: 'session-host-test' } })).status, 'workspace_project_missing')
    await assert.rejects(getContext.execute({}, { agent: { id: 'session-host-test' } }), error => error.code === 'invalid_command')

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

    for (const [assetPath, contentType] of [
      ['/report-studio/layout.css', 'text/css; charset=utf-8'],
      ['/report-studio/layout-ui.js', 'text/javascript; charset=utf-8'],
    ]) {
      body = ''
      await route.handler({ method: 'GET', url: assetPath }, response)
      assert.equal(response.statusCode, 200, `${assetPath} must be packaged with the DSH plugin`)
      assert.equal(headers.get('content-type'), contentType)
      assert.ok(body.length > 100, `${assetPath} must not be empty`)
    }

    body = ''
    await route.handler(Object.assign(Readable.from([Buffer.from(JSON.stringify({ workspaceRoot: 'C:\\must-not-open', dirty: true }))]), {
      method: 'POST', url: '/report-studio/api/workspace/reload?sessionId=session-host-test', headers: { 'content-type': 'application/json' },
    }), response)
    assert.equal(response.statusCode, 200, body)
    const workspaceReload = JSON.parse(body)
    assert.equal(workspaceReload.workspaceRoot, await realpath(dataDir))
    assert.equal(workspaceReload.status, 'workspace_project_missing')

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
    const designContext=await getContext.execute({scope:'design',pageId:state.pages[0].id},{agent:{id:'session-host-test',session:{id:'session-host-test'}}})
    assert.equal(designContext.rules.schemaVersion,'report-studio.design-rules.v2')
    assert.ok(designContext.pageAssets.some(row=>row.assetId===asset.assetId))
    body=''
    await route.handler(Object.assign(Readable.from([Buffer.from(JSON.stringify({pageIds:[state.pages[0].id],protectedPageIds:[],instruction:'整理本页汇报'}))]),{method:'POST',url:'/report-studio/api/design/start?sessionId=session-host-test',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','sec-fetch-site':'same-origin','content-type':'application/json'}}),response)
    assert.equal(response.statusCode,200,body)
    assert.equal(JSON.parse(body).dshPrompt.kind,'report_studio.design')
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
    const execBoundContext = await getContext.execute({
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
    await cleanup?.()
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

test('default DSH review routing uses the isolated local worker when DSH model services are injected', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'report-studio-worker-route-'))
  let cleanup
  let route
  try {
    const ctx = {
      tools: { register() {} },
      systemPrompt: { section() {} },
      webServer: { host: '127.0.0.1', register(definition) { route = definition; return () => undefined } },
      sessions: { get(sessionId) { return sessionId === 'worker-route' ? { header: { cwd: dataDir } } : undefined } },
      llm: { async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } } },
      apiProxy: { sessions: { models: async () => ({ result: { ok: true, value: { routable: true, current: { provider: 'test', model: 'test-model' } } } }) } },
      effect(factory) { cleanup = factory(); return cleanup },
    }
    apply(ctx, { dataDir })
    let body = ''
    const response = { statusCode: 0, setHeader() {}, end(value = '') { body += String(value) } }
    await route.handler({ method: 'GET', url: '/report-studio/api/health?sessionId=worker-route' }, response)
    const health = JSON.parse(body)
    assert.equal(response.statusCode, 200)
    assert.equal(health.reviewWorkerConfigured, true)
    assert.equal(health.reviewWorkerMode, 'dsh-local-worker')
  } finally {
    await cleanup?.()
    await rm(dataDir, { recursive: true, force: true })
  }
})
