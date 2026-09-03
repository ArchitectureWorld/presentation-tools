import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateProjectDirectoryWithAjv } from '../../contracts/presentation-standard-project/src/index.mjs'
import { readStandardProject, writeStandardProject } from './index.mjs'

const fixtureRoot = new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url)

test('standard fixture imports into the Studio canonical model without changing stable ids', async () => {
  const imported = await readStandardProject(fixtureRoot)
  assert.equal(imported.snapshot.project.id, 'project_01992a80-0000-7000-8000-000000000101')
  assert.equal(imported.snapshot.outline[0].id, 'outline_node_01992a80-0000-7000-8000-000000000110')
  assert.equal(imported.snapshot.pages[0].id, 'page_01992a80-0000-7000-8000-000000000111')
  assert.equal(imported.snapshot.pages[0].heading, '更新基础已经具备')
  assert.deepEqual(imported.snapshot.pages[0].bullets, ['优先改善高频公共活动空间', '保留可复用的现状资源', '分阶段验证投入与效果'])
  assert.match(imported.snapshot.pages[0].script, /本页先说明项目具备更新基础/)
})

test('standard round trip preserves unsupported blocks and managed source bytes', async () => {
  const target = await mkdtemp(join(tmpdir(), 'report-studio-standard-export-'))
  try {
    const imported = await readStandardProject(fixtureRoot)
    imported.snapshot.pages[0].body = '这是在 Report Studio 中修改后的正文。'
    const exported = await writeStandardProject({ snapshot: imported.snapshot, exportRoot: target })
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2))
    const draft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${imported.snapshot.pages[0].id}.json`), 'utf8'))
    assert.equal(draft.contentBlocks.find(block => block.type === 'text' && block.role === 'body').content, '这是在 Report Studio 中修改后的正文。')
    assert.ok(draft.contentBlocks.some(block => block.type === 'metric_group'), 'unsupported metric block must survive')
    const originalCsv = await readFile(new URL('source-materials/data/场地指标.csv', fixtureRoot))
    const exportedCsv = await readFile(join(exported.projectRoot, 'source-materials', 'data', '场地指标.csv'))
    assert.deepEqual(exportedCsv, originalCsv)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
