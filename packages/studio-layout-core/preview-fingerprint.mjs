import { createHash } from 'node:crypto'

export const PREVIEW_CHECKS_VERSION = 'layout-dom-checks-v3'

function normalized(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(normalized)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]))
  }
  throw new TypeError('Fingerprint inputs must contain only finite JSON values')
}

// Object keys are canonicalized; array order is intentionally meaningful.
// Callers sort materials by pageAssetId then assetId and fonts by family.
export function createPreviewFingerprint({ candidateSha, sha256, rendererVersion, canvas, fonts, materials, checksVersion, sourceStateHash }) {
  return createHash('sha256').update(JSON.stringify(normalized({ candidateSha, sha256, rendererVersion, canvas, fonts, materials, checksVersion, sourceStateHash }))).digest('hex')
}
