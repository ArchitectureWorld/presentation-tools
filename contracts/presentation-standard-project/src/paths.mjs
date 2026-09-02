
import path from 'node:path'
import { ERROR_CODES, PresentationContractError } from './errors.mjs'

const CONTROL = /[\u0000-\u001f\u007f]/u
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/

export function normalizeProjectRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || CONTROL.test(value)) {
    throw new PresentationContractError(ERROR_CODES.PATH_INVALID, 'Project-relative path must be a non-empty Unicode string without control characters')
  }
  if (value.includes('\\') || value.includes('//')) {
    throw new PresentationContractError(ERROR_CODES.PATH_SEPARATOR_INVALID, 'Project-relative paths must use one forward slash between segments')
  }
  if (value.startsWith('/') || WINDOWS_DRIVE.test(value) || URI_SCHEME.test(value) || value.startsWith('//')) {
    throw new PresentationContractError(ERROR_CODES.PATH_ABSOLUTE, 'Absolute paths, drive paths, UNC paths, and URI paths are forbidden')
  }
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new PresentationContractError(ERROR_CODES.PATH_TRAVERSAL, 'Empty and dot path segments are forbidden')
  }
  return value.normalize('NFC')
}

export function assertPathIsNfc(value) {
  const normalized = normalizeProjectRelativePath(value)
  if (normalized !== value) throw new PresentationContractError(ERROR_CODES.PATH_NOT_NFC, 'Canonical project paths must use Unicode NFC')
  return value
}

export function assertFileNameIsNfc(value) {
  if (typeof value !== 'string' || value.length === 0 || CONTROL.test(value) || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new PresentationContractError(ERROR_CODES.PATH_INVALID, 'Canonical file name is invalid')
  }
  if (value.normalize('NFC') !== value) throw new PresentationContractError(ERROR_CODES.PATH_NOT_NFC, 'Canonical file names must use Unicode NFC')
  return value
}

export function portabilityKey(value) {
  return assertPathIsNfc(value).normalize('NFC').toLocaleLowerCase('en-US')
}

export function resolveWithinProject(projectRoot, relativePath) {
  const normalized = assertPathIsNfc(relativePath)
  const root = path.resolve(projectRoot)
  const resolved = path.resolve(root, ...normalized.split('/'))
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new PresentationContractError(ERROR_CODES.PATH_ESCAPE, `Path escapes project root: ${relativePath}`)
  }
  return resolved
}
