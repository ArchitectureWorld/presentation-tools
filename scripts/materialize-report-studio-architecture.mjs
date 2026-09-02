#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDir, '..')
const sourceDirectory = join(repositoryRoot, 'docs', 'architecture', '.source')
const outputPath = join(repositoryRoot, 'docs', 'architecture', 'report-studio-architecture.md')
const verificationPath = join(repositoryRoot, 'docs', 'review', 'report-studio-architecture-materialization.txt')

const expected = Object.freeze({
  parts: 3,
  sha256: 'b0d6e78632576ffc3983fd9afd33b73f04d15436521fb130b20d8bc073d8caa1',
  bytes: 122039,
  lines: 2519,
})

function fail(message) {
  console.error(`[materialize-report-studio-architecture] ERROR: ${message}`)
  process.exit(1)
}

if (!existsSync(sourceDirectory)) {
  fail(`source directory does not exist: ${sourceDirectory}`)
}

const partNames = readdirSync(sourceDirectory)
  .filter(name => /^report-studio-architecture\.md\.gz\.b64\.part-\d{3}$/.test(name))
  .sort()

if (partNames.length !== expected.parts) {
  fail(`expected ${expected.parts} source parts, found ${partNames.length}`)
}

const encoded = partNames
  .map(name => readFileSync(join(sourceDirectory, name), 'utf8').trim())
  .join('')

let markdown
try {
  const compressed = Buffer.from(encoded, 'base64')
  markdown = gunzipSync(compressed)
} catch (error) {
  fail(`base64 or gzip decode failed: ${error instanceof Error ? error.message : String(error)}`)
}

const actual = Object.freeze({
  sha256: createHash('sha256').update(markdown).digest('hex'),
  bytes: markdown.byteLength,
  lines: markdown.toString('utf8').split('\n').length - 1,
})

if (actual.sha256 !== expected.sha256) {
  fail(`SHA-256 mismatch: expected ${expected.sha256}, got ${actual.sha256}`)
}
if (actual.bytes !== expected.bytes) {
  fail(`byte-count mismatch: expected ${expected.bytes}, got ${actual.bytes}`)
}
if (actual.lines !== expected.lines) {
  fail(`line-count mismatch: expected ${expected.lines}, got ${actual.lines}`)
}

mkdirSync(dirname(outputPath), { recursive: true })
mkdirSync(dirname(verificationPath), { recursive: true })
writeFileSync(outputPath, markdown)
writeFileSync(
  verificationPath,
  [
    `generated_file=${outputPath.replace(`${repositoryRoot}/`, '')}`,
    `source_parts=${partNames.length}`,
    `lines=${actual.lines}`,
    `bytes=${actual.bytes}`,
    `sha256=${actual.sha256}`,
    'status=PASS',
    '',
  ].join('\n'),
  'utf8',
)

console.log(`[materialize-report-studio-architecture] PASS`)
console.log(`file=${outputPath}`)
console.log(`parts=${partNames.length}`)
console.log(`lines=${actual.lines}`)
console.log(`bytes=${actual.bytes}`)
console.log(`sha256=${actual.sha256}`)
