
import { randomBytes as cryptoRandomBytes } from 'node:crypto'
import { ERROR_CODES, PresentationContractError } from './errors.mjs'
import { ID_PREFIXES } from './constants.mjs'

export const UUID_V7_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

function formatUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createUuidV7({ now = Date.now(), randomBytes = cryptoRandomBytes } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new PresentationContractError(ERROR_CODES.INPUT_INVALID, 'UUIDv7 timestamp must be a non-negative 48-bit integer')
  }
  const bytes = Buffer.alloc(16)
  let timestamp = BigInt(now)
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn)
    timestamp >>= 8n
  }
  const random = Buffer.from(randomBytes(10))
  if (random.length !== 10) throw new PresentationContractError(ERROR_CODES.INPUT_INVALID, 'UUIDv7 random source must return exactly 10 bytes')
  random.copy(bytes, 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return formatUuid(bytes)
}

export function createStableId(kind, options = {}) {
  const prefix = ID_PREFIXES[kind]
  if (!prefix) throw new PresentationContractError(ERROR_CODES.INPUT_INVALID, `Unknown stable ID kind: ${kind}`)
  return `${prefix}_${createUuidV7(options)}`
}

export function stableIdPattern(kind) {
  const prefix = ID_PREFIXES[kind]
  if (!prefix) throw new PresentationContractError(ERROR_CODES.INPUT_INVALID, `Unknown stable ID kind: ${kind}`)
  return new RegExp(`^${prefix}_${UUID_V7_PATTERN}$`)
}

export function isStableId(kind, value) {
  return typeof value === 'string' && stableIdPattern(kind).test(value)
}
