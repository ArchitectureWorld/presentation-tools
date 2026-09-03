
import path from 'node:path'

export const MIME_BY_EXTENSION = Object.freeze({
  '.pdf': ['application/pdf'], '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.dwg': ['application/acad', 'application/x-acad', 'image/vnd.dwg'],
  '.dxf': ['application/dxf', 'application/x-dxf', 'image/vnd.dxf'],
  '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'], '.webp': ['image/webp'], '.svg': ['image/svg+xml'],
  '.mp4': ['video/mp4'], '.mov': ['video/quicktime'], '.webm': ['video/webm'],
  '.mp3': ['audio/mpeg'], '.wav': ['audio/wav', 'audio/x-wav'],
  '.csv': ['text/csv'], '.json': ['application/json'], '.geojson': ['application/geo+json'],
  '.txt': ['text/plain'], '.md': ['text/markdown'],
  '.ifc': ['application/x-step', 'application/step'], '.zip': ['application/zip'],
})

export function mimeMatchesExtension(relativePath, mimeType) {
  const allowed = MIME_BY_EXTENSION[path.extname(relativePath).toLowerCase()]
  return !allowed || allowed.includes(mimeType)
}

export function sniffKnownMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 6 && ['GIF87a','GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return buffer.subarray(8, 12).toString('ascii') === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav'
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg'
  const text = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && /<svg[\s>]/u.test(text))) return 'image/svg+xml'
  return null
}
