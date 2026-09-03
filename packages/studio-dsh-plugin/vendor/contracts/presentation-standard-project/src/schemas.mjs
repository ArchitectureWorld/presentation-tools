
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STANDARD_VERSION } from './constants.mjs'

const defaultRoot = fileURLToPath(new URL(`../schemas/${STANDARD_VERSION}/`, import.meta.url))

export async function loadSchemas(root = defaultRoot) {
  const names = (await readdir(root)).filter(name => name.endsWith('.schema.json')).sort()
  return Promise.all(names.map(async name => JSON.parse(await readFile(path.join(root, name), 'utf8'))))
}

export async function computeSchemaSetHash(root = defaultRoot) {
  const names = (await readdir(root)).filter(name => name.endsWith('.schema.json')).sort()
  const hash = createHash('sha256')
  for (const name of names) {
    hash.update(name); hash.update('\0'); hash.update(await readFile(path.join(root, name))); hash.update('\0')
  }
  return hash.digest('hex')
}

export async function verifySchemaSetHash(contractRoot = fileURLToPath(new URL('../', import.meta.url))) {
  const expected = (await readFile(path.join(contractRoot, 'SCHEMASET.sha256'), 'utf8')).trim().split(/\s+/)[0]
  const actual = await computeSchemaSetHash(path.join(contractRoot, 'schemas', STANDARD_VERSION))
  return { valid: expected === actual, expectedSha256: expected, actualSha256: actual }
}
