import { LayoutPersistenceError } from '../../packages/studio-layout-persistence/index.mjs'
import { LayoutServiceError } from './layout-service.mjs'

export class LayoutApiError extends Error {
  constructor(code, message, details = undefined, status = 400) {
    super(message)
    this.name = 'LayoutApiError'
    this.code = code
    this.details = details
    this.status = status
  }
}

function fail(code, message, details = undefined, status = 400) {
  throw new LayoutApiError(code, message, details, status)
}

export function matchLayoutApiPath(pathname, prefix = '/api') {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${escaped}/layout/pages/([^/]+)(?:/(ensure|mutate|reconcile))?$`, 'u').exec(pathname)
  if (!match) return null
  let pageId
  try { pageId = decodeURIComponent(match[1]) }
  catch { fail('layout_api_invalid_path', '排版 API 页面 ID 编码无效。', undefined, 400) }
  if (!pageId || pageId.includes('/') || pageId.includes('\\')) fail('layout_api_invalid_path', '排版 API 页面 ID 无效。', { pageId }, 400)
  return { pageId, operation: match[2] ?? 'read' }
}

function integer(value, name, { min = 0, optional = false } = {}) {
  if (optional && value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < min) fail('layout_api_invalid_request', `${name} 必须是大于等于 ${min} 的安全整数。`, { [name]: value })
  return value
}

export async function executeLayoutApi({ service, method, match, body = {} } = {}) {
  if (!service?.get || !service?.ensure || !service?.mutate) fail('layout_api_service_required', '排版 API 缺少 LayoutService。', undefined, 500)
  if (!match?.pageId || !match?.operation) fail('layout_api_invalid_path', '排版 API 路径无效。')
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('layout_api_invalid_request', '排版 API 请求体必须是对象。')
  const verb = String(method ?? 'GET').toUpperCase()
  switch (match.operation) {
    case 'read':
      if (verb !== 'GET') fail('layout_api_method_not_allowed', '读取排版仅支持 GET。', undefined, 405)
      return service.get({ pageId: match.pageId, reconcile: false })
    case 'ensure':
      if (verb !== 'POST') fail('layout_api_method_not_allowed', '创建排版仅支持 POST。', undefined, 405)
      return service.ensure({
        pageId: match.pageId,
        baseRevision: integer(body.baseRevision, 'baseRevision'),
        source: body.source ?? 'human-layout',
      })
    case 'reconcile':
      if (verb !== 'POST') fail('layout_api_method_not_allowed', '同步排版仅支持 POST。', undefined, 405)
      return service.ensure({
        pageId: match.pageId,
        baseRevision: integer(body.baseRevision, 'baseRevision'),
        source: body.source ?? 'layout-reconcile',
      })
    case 'mutate':
      if (verb !== 'POST') fail('layout_api_method_not_allowed', '修改排版仅支持 POST。', undefined, 405)
      if (!body.operation || typeof body.operation !== 'object' || Array.isArray(body.operation)) fail('layout_api_invalid_request', '排版修改缺少 operation。')
      return service.mutate({
        pageId: match.pageId,
        baseRevision: integer(body.baseRevision, 'baseRevision'),
        expectedLayoutRevision: integer(body.expectedLayoutRevision, 'expectedLayoutRevision'),
        operation: body.operation,
        source: body.source ?? 'human-layout',
      })
    default:
      fail('layout_api_invalid_path', '不支持的排版 API 操作。', { operation: match.operation }, 404)
  }
}

export function layoutApiErrorPayload(error) {
  const known = error instanceof LayoutApiError || error instanceof LayoutServiceError || error instanceof LayoutPersistenceError
  return {
    status: known ? (error.status ?? 400) : 500,
    payload: {
      error: {
        code: known ? error.code : 'layout_internal_error',
        message: known ? error.message : '排版服务发生内部错误。',
        ...(known && error.details !== undefined ? { details: error.details } : {}),
      },
    },
  }
}
