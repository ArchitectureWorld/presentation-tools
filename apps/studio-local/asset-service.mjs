import { createStudioId, ERROR_CODES, StudioError } from '../../packages/studio-contracts/index.mjs'

export const MAX_ASSET_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_HEADER_BYTES = 256 * 1024
const MAX_IMAGE_DIMENSION = 16_384
const MAX_IMAGE_PIXELS = 100_000_000

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) }
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return null
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null
      return { widthPx: bytes.readUInt16BE(offset + 5), heightPx: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return null
}

export function imageDimensions(mimeType, bytes) {
  return mimeType === 'image/png' ? pngDimensions(bytes) : mimeType === 'image/jpeg' ? jpegDimensions(bytes) : null
}

function assertImage(mimeType, header) {
  const dimensions = imageDimensions(mimeType, header)
  if (!dimensions || !dimensions.widthPx || !dimensions.heightPx || dimensions.widthPx > MAX_IMAGE_DIMENSION || dimensions.heightPx > MAX_IMAGE_DIMENSION || dimensions.widthPx * dimensions.heightPx > MAX_IMAGE_PIXELS) {
    throw new StudioError(ERROR_CODES.INVALID_COMMAND, '上传素材必须是结构完整且尺寸合理的 PNG 或 JPEG 图片。', undefined, 400)
  }
  return dimensions
}

export async function ingestAsset({ repository, request, pageId, mimeType, originalFileName }) {
  const before = repository.getState()
  if (!pageId || !before.pages.some(page => page.id === pageId) || !['image/png', 'image/jpeg'].includes(mimeType) || !originalFileName) {
    throw new StudioError(ERROR_CODES.INVALID_COMMAND, '上传素材必须指定存在的页面、受支持的图片 MIME 和文件名。', undefined, 400)
  }
  let total = 0
  let header = Buffer.alloc(0)
  let dimensions = null
  async function* checked() {
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk)
      total += bytes.length
      if (total > MAX_ASSET_BYTES) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '上传素材超过 20 MiB 限制。', undefined, 413)
      if (header.length < MAX_IMAGE_HEADER_BYTES) header = Buffer.concat([header, bytes]).subarray(0, MAX_IMAGE_HEADER_BYTES)
      yield bytes
    }
    dimensions = assertImage(mimeType, header)
  }
  const objectRef = await repository.putBlob(checked(), { mimeType, originalFileName })
  const asset = { id: createStudioId('asset'), name: originalFileName, mimeType, objectRef, sizeBytes: objectRef.sizeBytes, sha256: objectRef.sha256, ...dimensions }
  try {
    await repository.transactContent({ baseRevision: before.project.currentRevision, source: 'human', detail: { actionType: 'asset.ingest', pageId } }, state => {
      const page = state.pages.find(item => item.id === pageId)
      if (!page) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '上传目标页面不存在。', { pageId }, 404)
      page.assets = [...(page.assets ?? []), asset]
      return state
    })
  } catch (error) {
    await repository.recordOrphanBlob?.(objectRef, { reason: error.code ?? 'asset_ingest_publish_failed', pageId })
    throw error
  }
  return { assetId: asset.id, objectRef, metadata: { name: asset.name, mimeType, sizeBytes: asset.sizeBytes, sha256: asset.sha256, widthPx: asset.widthPx, heightPx: asset.heightPx } }
}

export async function serveReferencedAsset({ repository, assetId, response }) {
  const asset = repository.getState().pages.flatMap(page => page.assets ?? []).find(item => item.id === assetId)
  if (!asset?.objectRef) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到当前项目引用的素材。', undefined, 404)
  const stream = await repository.openBlob(asset.objectRef)
  response.writeHead?.(200, { 'content-type': asset.mimeType, 'content-length': asset.sizeBytes, 'x-content-type-options': 'nosniff' })
  if (!response.writeHead) {
    response.statusCode = 200
    response.setHeader('content-type', asset.mimeType)
    response.setHeader('content-length', asset.sizeBytes)
    response.setHeader('x-content-type-options', 'nosniff')
  }
  stream.pipe(response)
  return true
}
