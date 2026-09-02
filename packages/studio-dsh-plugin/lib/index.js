import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudioDshRuntime } from './runtime.js'

export const name = 'report-studio-dsh'
export const inject = ['tools', 'webServer', 'systemPrompt']

const publicDir = fileURLToPath(new URL('../../../apps/studio-local/public/', import.meta.url))
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('content-length', Buffer.byteLength(body))
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

async function readJson(request, limit = 20 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('请求体过大'), { statusCode: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('JSON 格式错误'), { statusCode: 400 })
  }
}

function sessionIdFrom(url) {
  const value = url.searchParams.get('sessionId')?.trim()
  if (!value) throw Object.assign(new Error('缺少 DSH Session ID'), { statusCode: 400 })
  return value
}

function sessionIdOf(exec) {
  if (exec.agent === undefined) throw new Error('Report Studio 工具必须在 DSH Agent Session 中调用。')
  return String(exec.agent.id)
}

function outputJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function toolOutput() {
  return {
    schema: {},
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function registerTools(ctx, runtime) {
  ctx.tools.register({
    name: 'studio_get_context',
    description: '读取当前 DSH Session 绑定的 Report Studio v0.1.0 大纲、草案、批注轮次、Submission、Proposal 与 Revision 上下文。修改前必须先调用。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: toolOutput(),
    async execute(_args, exec) {
      return outputJson(await runtime.getContext(sessionIdOf(exec)))
    },
  })

  ctx.tools.register({
    name: 'studio_apply_commands',
    description: '根据一个不可变 ReviewSubmission 提交结构化修改命令并创建 Proposal。该工具不会直接覆盖正式内容，仍需用户在 Report Studio 中确认。',
    parameters: {
      type: 'object',
      properties: {
        submissionId: {
          type: 'string',
          description: 'ReviewSubmission 提示中提供的稳定 ID。',
        },
        message: {
          type: 'string',
          description: '面向用户的修改说明。',
        },
        commands: {
          type: 'array',
          description: 'Report Studio 受控结构化命令数组。',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
            },
            required: ['type'],
            additionalProperties: true,
          },
        },
      },
      required: ['submissionId', 'message', 'commands'],
      additionalProperties: false,
    },
    output: toolOutput(),
    async execute(args, exec) {
      return outputJson(await runtime.applyCommands(sessionIdOf(exec), args))
    },
  })
}

async function serveStatic(request, response, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  let relative = url.pathname.slice('/report-studio'.length)
  if (relative === '' || relative === '/') relative = '/index.html'
  const safe = normalize(relative).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '')
  const filePath = join(publicDir, safe)
  if (!filePath.startsWith(publicDir)) return false
  try {
    const body = await readFile(filePath)
    response.statusCode = 200
    response.setHeader('content-type', contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream')
    response.setHeader('content-length', body.length)
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('cache-control', safe === 'index.html' ? 'no-store' : 'public, max-age=60')
    if (request.method === 'HEAD') response.end()
    else response.end(body)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function createRoute(runtime) {
  return async (request, response) => {
    const url = new URL(request.url ?? '/report-studio', 'http://dsh.local')
    try {
      if (url.pathname.startsWith('/report-studio/api/')) {
        const sessionId = sessionIdFrom(url)
        if (request.method === 'GET' && url.pathname === '/report-studio/api/health') {
          return sendJson(response, 200, {
            ok: true,
            version: 'v0.1.0',
            agentConfigured: true,
            agentMode: 'dsh-native',
            sessionId,
            dataRoot: runtime.dataRoot,
          })
        }
        if (request.method === 'GET' && url.pathname === '/report-studio/api/state') {
          return sendJson(response, 200, await runtime.getState(sessionId))
        }
        if (request.method === 'POST' && url.pathname === '/report-studio/api/action') {
          return sendJson(response, 200, await runtime.executeAction(sessionId, await readJson(request)))
        }
        if (request.method === 'POST' && url.pathname === '/report-studio/api/review/submit') {
          return sendJson(response, 200, await runtime.submitReview(sessionId, await readJson(request)))
        }
        if (request.method === 'POST' && url.pathname === '/report-studio/api/agent/chat') {
          return sendJson(response, 200, await runtime.prepareChat(sessionId, await readJson(request)))
        }
        const match = url.pathname.match(/^\/report-studio\/api\/proposal\/([^/]+)\/accept$/)
        if (request.method === 'POST' && match) {
          return sendJson(response, 200, await runtime.acceptProposal(sessionId, decodeURIComponent(match[1])))
        }
        return sendJson(response, 404, { error: 'not_found' })
      }
      if (await serveStatic(request, response, url)) return
      sendJson(response, 404, { error: 'not_found' })
    } catch (error) {
      sendJson(response, error?.statusCode || 400, { error: error?.message || 'request_failed' })
    }
  }
}

export function apply(ctx, config = {}) {
  const runtime = createStudioDshRuntime({ dataRoot: config.dataDir })
  registerTools(ctx, runtime)
  ctx.systemPrompt.section({
    name: 'report-studio-v0.1.0',
    order: 130,
    text: [
      'Report Studio v0.1.0 is available in this DSH Session.',
      'For Report Studio review tasks, call studio_get_context before proposing changes.',
      'Use studio_apply_commands only with the ReviewSubmission ID supplied by the user task.',
      'studio_apply_commands creates a Proposal for human confirmation and never directly commits Project State.',
    ].join('\n'),
  })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/report-studio', handler: createRoute(runtime) }),
    'report-studio-dsh: web route',
  )
}
