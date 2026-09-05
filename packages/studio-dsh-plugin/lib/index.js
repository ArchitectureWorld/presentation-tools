import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudioDshRuntime } from './runtime.js'
import { STUDIO_APPLY_COMMANDS_SCHEMA, errorPayload } from '../vendor/packages/studio-contracts/index.mjs'
import { createStandardProjectService } from '../vendor/apps/studio-local/standard-project.mjs'
import { ingestAsset, serveReferencedAsset } from '../vendor/apps/studio-local/asset-service.mjs'
import { createLayoutService } from '../vendor/apps/studio-local/layout-service.mjs'
import { executeLayoutApi, layoutApiErrorPayload, matchLayoutApiPath } from '../vendor/apps/studio-local/layout-api.mjs'
import { createAgentBridge } from '../vendor/apps/studio-local/agent-bridge.mjs'

export const name = 'report-studio-dsh'
export const inject = ['tools', 'webServer', 'systemPrompt', 'sessions']
const SECURITY_MODE = 'local-single-user-only'

const publicDir = fileURLToPath(new URL('../vendor/apps/studio-local/public/', import.meta.url))
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
    name: 'studio_open_workspace_project',
    description: '从当前 DSH Session 的 header.cwd 打开并验证 Presentation Standard Project Directory 0.1.0。不会接受浏览器或 Agent 提供的绝对路径。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: toolOutput(),
    async execute(_args, exec) {
      return outputJson(await runtime.openWorkspace(sessionIdOf(exec)))
    },
  })

  ctx.tools.register({
    name: 'studio_reload_upstream',
    description: '重新扫描当前 DSH Session Workspace 并执行 Contract 全量验证；存在待应用更新时由 Report Studio 界面决定是否载入。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: toolOutput(),
    async execute(_args, exec) {
      return outputJson(await runtime.reloadWorkspace(sessionIdOf(exec), { dirty: true }))
    },
  })

  ctx.tools.register({
    name: 'studio_get_context',
    description: '按不可变 ReviewSubmission 的 baseRevision 读取 Report Studio v0.1.1 大纲、草案和批注快照。修改前必须先调用。',
    parameters: {
      type: 'object',
      properties: {
        submissionId: { type: 'string', description: 'ReviewSubmission 提示中提供的稳定 ID。' },
      },
      required: ['submissionId'],
      additionalProperties: false,
    },
    output: toolOutput(),
    async execute(args, exec) {
      return outputJson(await runtime.getContext(sessionIdOf(exec), args.submissionId))
    },
  })

  ctx.tools.register({
    name: 'studio_apply_commands',
    description: '根据一个不可变 ReviewSubmission 提交结构化修改命令并创建 Proposal。该工具不会直接覆盖正式内容，仍需用户在 Report Studio 中确认。',
    parameters: structuredClone(STUDIO_APPLY_COMMANDS_SCHEMA),
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

function createRoute(runtime, listenHost) {
  return async (request, response) => {
    const url = new URL(request.url ?? '/report-studio', 'http://dsh.local')
    try {
      if (url.pathname.startsWith('/report-studio/api/')) {
        const sessionId = sessionIdFrom(url)
        if (request.method === 'GET' && url.pathname === '/report-studio/api/workspace/status') {
          return sendJson(response, 200, await runtime.workspaceStatus(sessionId))
        }
        if (request.method === 'POST' && url.pathname === '/report-studio/api/workspace/reload') {
          return sendJson(response, 200, await runtime.reloadWorkspace(sessionId, await readJson(request)))
        }
        if (request.method === 'POST' && url.pathname === '/report-studio/api/workspace/apply') {
          return sendJson(response, 200, await runtime.applyWorkspaceCandidate(sessionId, await readJson(request)))
        }
        const repository = await runtime.repositoryFor(sessionId)
        const workspace = await runtime.workspaceStatus(sessionId)
        const standardProject = createStandardProjectService(repository)
        const layoutRoot = workspace?.workspaceRoot ? join(workspace.workspaceRoot, 'layouts') : join(repository.root, 'layouts')
        const layoutService = createLayoutService({ repository, layoutRoot })
        if (request.method === 'GET' && url.pathname === '/report-studio/api/health') {
          return sendJson(response, 200, {
            ok: true,
            version: 'v0.1.1',
            productVersion: '0.2.0-beta.1',
            layoutStage: true,
            agentConfigured: true,
            agentMode: 'dsh-native',
            sessionId,
            securityMode: SECURITY_MODE,
            listenHost,
            networkSharedSecurity: false,
            dataRoot: runtime.dataRoot,
            layoutRoot,
            migrationStatus: repository.migrationStatus().status,
          })
        }
        if (request.method === 'GET' && url.pathname === '/report-studio/api/migration/status') return sendJson(response, 200, repository.migrationStatus())
        if (request.method === 'POST' && url.pathname === '/report-studio/api/migration/apply') return sendJson(response, 200, await repository.applyMigration())
        if (request.method === 'GET' && url.pathname === '/report-studio/api/standard/status') return sendJson(response, 200, standardProject.status())
        if (request.method === 'POST' && url.pathname === '/report-studio/api/standard/import') {
          const input = await readJson(request)
          return sendJson(response, 200, await standardProject.importProject(input.projectRoot))
        }
        if (request.method === 'POST' && url.pathname === '/report-studio/api/standard/export') return sendJson(response, 200, await standardProject.exportProject())
        const layoutMatch = matchLayoutApiPath(url.pathname, '/report-studio/api')
        if (layoutMatch) {
          try {
            const body = request.method === 'POST' ? await readJson(request) : {}
            return sendJson(response, 200, await executeLayoutApi({ service: layoutService, method: request.method, match: layoutMatch, body }))
          } catch (error) {
            const result = layoutApiErrorPayload(error)
            return sendJson(response, result.status, result.payload)
          }
        }
        if (request.method === 'GET' && url.pathname === '/report-studio/api/state') {
          return sendJson(response, 200, await runtime.getState(sessionId))
        }
        if (request.method === 'POST' && url.pathname === '/report-studio/api/assets/ingest') {
          const pageId = url.searchParams.get('pageId')
          const mimeType = String(request.headers?.['content-type'] ?? '').split(';', 1)[0].toLowerCase()
          const originalFileName = String(request.headers?.['x-file-name'] ?? 'upload').replace(/[\\/\0]/g, '_')
          return sendJson(response, 200, await ingestAsset({ repository, request, pageId, mimeType, originalFileName }))
        }
        const contentMatch = url.pathname.match(/^\/report-studio\/api\/assets\/([^/]+)\/content$/)
        if (request.method === 'GET' && contentMatch) return await serveReferencedAsset({ repository, assetId: decodeURIComponent(contentMatch[1]), response })
        if (request.method === 'POST' && url.pathname === '/report-studio/api/action') {
          return sendJson(response, 200, await runtime.executeAction(sessionId, await readJson(request)))
        }
        if (request.method === 'POST' && url.pathname === '/report-studio/api/review/submit') {
          return sendJson(response, 200, await runtime.submitReview(sessionId, await readJson(request)))
        }
        const retryMatch = url.pathname.match(/^\/report-studio\/api\/review\/([^/]+)\/retry$/)
        if (request.method === 'POST' && retryMatch) return sendJson(response, 200, await runtime.retrySubmission(sessionId, decodeURIComponent(retryMatch[1])))
        const dispatchMatch = url.pathname.match(/^\/report-studio\/api\/review\/([^/]+)\/dispatch$/)
        if (request.method === 'POST' && dispatchMatch) return sendJson(response, 200, await runtime.updateDispatch(sessionId, decodeURIComponent(dispatchMatch[1]), await readJson(request)))
        if (request.method === 'POST' && url.pathname === '/report-studio/api/agent/chat') {
          return sendJson(response, 200, await runtime.prepareChat(sessionId, await readJson(request)))
        }
        const match = url.pathname.match(/^\/report-studio\/api\/proposal\/([^/]+)\/accept$/)
        if (request.method === 'POST' && match) {
          return sendJson(response, 200, await runtime.acceptProposal(sessionId, decodeURIComponent(match[1])))
        }
        const proposalActionMatch = url.pathname.match(/^\/report-studio\/api\/proposal\/([^/]+)\/(reject|return)$/)
        if (request.method === 'POST' && proposalActionMatch) {
          const proposalId = decodeURIComponent(proposalActionMatch[1])
          return sendJson(response, 200, proposalActionMatch[2] === 'reject'
            ? await runtime.rejectProposal(sessionId, proposalId)
            : await runtime.returnProposal(sessionId, proposalId))
        }
        return sendJson(response, 404, { error: 'not_found' })
      }
      if (await serveStatic(request, response, url)) return
      sendJson(response, 404, { error: 'not_found' })
    } catch (error) {
      sendJson(response, error?.statusCode || error?.status || 400, error?.code ? errorPayload(error) : { error: error?.message || 'request_failed' })
    }
  }
}

export function apply(ctx, config = {}) {
  if (ctx.webServer.host !== '127.0.0.1') {
    throw new Error(`${SECURITY_MODE} requires DSH webServer host 127.0.0.1`)
  }
  const agentBridge = createAgentBridge({ url: config.agentUrl || process.env.REPORT_STUDIO_AGENT_URL || '' })
  const runtime = createStudioDshRuntime({ dataRoot: config.dataDir, sessions: ctx.sessions, agentBridge })
  registerTools(ctx, runtime)
  ctx.systemPrompt.section({
    name: 'report-studio-v0.1.1',
    order: 130,
    text: [
      'Report Studio v0.2.0 layout workspace is available in this DSH Session.',
      'DSH remains the only Agent runtime; the Layout workspace does not choose its own model.',
      'For Report Studio review tasks, call studio_get_context with the supplied submissionId before proposing changes.',
      'Use studio_apply_commands only with the ReviewSubmission ID supplied by the user task.',
      'studio_apply_commands creates a Proposal for human confirmation and never directly commits Project State.',
    ].join('\n'),
  })
  ctx.effect(() => {
    const unregister = ctx.webServer.register({ kind: 'prefix', path: '/report-studio', handler: createRoute(runtime, ctx.webServer.host) })
    return async () => {
      unregister?.()
      await runtime.close()
    }
  }, 'report-studio-dsh: web route')
}
