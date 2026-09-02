
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ERROR_CODES, STANDARD_NAME, STANDARD_VERSION, createProjectDirectoryPlan, createStableId,
  isStableId, validateDocumentWithAjv, validateProjectDirectoryWithAjv,
} from '../src/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const minimal = path.join(root, 'fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project')
const example = path.join(root, 'examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief')
async function firstDraftPath(project) { const manifest = JSON.parse(await readFile(path.join(project, 'pages/manifest.json'), 'utf8')); return path.join(project, manifest.pages[0].draftPath) }

async function tempCopy(source) { const parent = await mkdtemp(path.join(os.tmpdir(), 'presentation-contract-')); const target = path.join(parent, path.basename(source)); await cp(source, target, { recursive: true }); return { parent, target } }

test('standard identity is exactly 0.1.0 without a v1 name suffix', () => {
  assert.equal(STANDARD_NAME, 'Presentation Standard Project Directory')
  assert.equal(STANDARD_VERSION, '0.1.0')
})

test('stable IDs use typed lowercase UUIDv7 identities', () => {
  const id = createStableId('page', { now: 1_788_361_200_000, randomBytes: () => Buffer.alloc(10, 7) })
  assert.match(id, /^page_[0-9a-f-]+$/)
  assert.equal(isStableId('page', id), true)
  assert.equal(isStableId('asset', id), false)
})

test('directory plan is pure and creates six genuinely empty canonical documents', () => {
  const plan = createProjectDirectoryPlan({ projectSlug: 'minimal-project', name: 'Minimal Project' })
  assert.equal(plan.standardVersion, '0.1.0')
  assert.equal(Object.keys(plan.documents).length, 6)
  assert.deepEqual(plan.documents['outline.json'].nodes, [])
  assert.deepEqual(plan.documents['pages/manifest.json'].pages, [])
  assert.deepEqual(plan.documents['source-materials/manifest.json'].materials, [])
  assert.deepEqual(plan.documents['assets/manifest.json'].assets, [])
})

test('sourceRefs accept numeric or string revisions and optional snapshot hash', async () => {
  const document = JSON.parse(await readFile(await firstDraftPath(example), 'utf8'))
  const block = document.contentBlocks.find(item => item.type === 'text')
  block.sourceRefs[0].sourceRevision = 'revision-a'
  delete block.sourceRefs[0].sourceSnapshotSha256
  const result = await validateDocumentWithAjv('DraftPageDocument', document)
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('governance fields are rejected from canonical documents', async () => {
  const document = JSON.parse(await readFile(path.join(minimal, 'project.json'), 'utf8'))
  document.lastModifiedRevision = 1
  const result = await validateDocumentWithAjv('ProjectManifest', document)
  assert.equal(result.valid, false)
})

test('minimum fixture and complete example both pass the directory validator', async () => {
  for (const project of [minimal, example]) {
    const result = await validateProjectDirectoryWithAjv(project, { allowGitKeep: true })
    assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2))
  }
})

test('speaker-note references are checked against page blocks and formal assets', async () => {
  const { parent, target } = await tempCopy(example)
  try {
    const file = await firstDraftPath(target)
    const document = JSON.parse(await readFile(file, 'utf8'))
    document.scriptBlocks[0].referencedAssetIds = ['asset_01992a80-0000-7000-8000-ffffffffffff']
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`)
    const result = await validateProjectDirectoryWithAjv(target, { allowGitKeep: true })
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(error => error.code === ERROR_CODES.REFERENCE_NOT_FOUND && error.instancePath.includes('referencedAssetIds')))
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('Unicode NFC and case-folded path collisions are rejected', async () => {
  const { parent, target } = await tempCopy(minimal)
  try {
    await writeFile(path.join(target, 'layouts', 'A.txt'), 'a')
    await writeFile(path.join(target, 'layouts', 'a.txt'), 'b')
    const result = await validateProjectDirectoryWithAjv(target, { allowGitKeep: true })
    assert.ok(result.errors.some(error => error.code === ERROR_CODES.PATH_PORTABILITY_COLLISION))
  } finally { await rm(parent, { recursive: true, force: true }) }
})
