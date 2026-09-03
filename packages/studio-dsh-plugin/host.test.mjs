import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject, name } from './lib/index.js'

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
    assert.deepEqual(tools[1].parameters.required, ['submissionId', 'message', 'commands'])
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
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
