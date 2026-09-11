import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import vm from 'node:vm'
import { createRepository } from './repository.mjs'
import { ingestAsset } from './asset-service.mjs'
import { createStandardProjectService } from './standard-project.mjs'
import { createInitialState, executeAction } from '../../packages/studio-core/index.mjs'
import { createStableId, validateProjectDirectoryWithAjv } from '../../contracts/presentation-standard-project/src/index.mjs'

const fixtureRoot = new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/', import.meta.url)

async function loadUiHelper() {
  const source = await readFile(new URL('./public/app.js', import.meta.url), 'utf8')
  const context = {
    document: { addEventListener() {}, querySelector() { return null }, querySelectorAll() { return [] } },
    window: { setTimeout() {}, clearTimeout() {} },
    fetch: async () => new Promise(() => {}),
    console,
    structuredClone,
  }
  vm.runInNewContext(source, context, { filename: 'app.js' })
  return { buildDraftUpdatePatch: context.buildDraftUpdatePatch }
}

function png(suffix = 0) {
  return Buffer.concat([
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    Buffer.from([suffix]),
  ])
}

test('real first placeholder input creates a stable ListBlock and ListItem through the UI save payload', async () => {
  const { buildDraftUpdatePatch } = await loadUiHelper()
  assert.equal(typeof buildDraftUpdatePatch, 'function')
  let state = createInitialState()
  state = executeAction(state, { type: 'outline.add', title: '新页面' }).state
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
  const page = state.pages[0]
  assert.equal(page.contentBlocks.some(block => block.type === 'list'), false)

  const patch = buildDraftUpdatePatch(page, {
    heading: '新页面', body: '', listInputs: [{ listItemId: '', value: '真实首条要点' }], scriptInputs: [], script: '',
  })
  assert.equal(patch.listCreateContent, '真实首条要点')
  state = executeAction(state, { type: 'draft.update', pageId: page.id, patch }).state
  const createdList = state.pages[0].contentBlocks.find(block => block.type === 'list')
  assert.ok(createdList?.contentBlockId)
  assert.equal(createdList.items[0].content, '真实首条要点')
  const ids = [createdList.contentBlockId, createdList.items[0].listItemId]

  const secondPatch = buildDraftUpdatePatch(state.pages[0], {
    heading: '新页面', body: '', listInputs: [{ listItemId: createdList.items[0].listItemId, value: '编辑后的首条要点' }], scriptInputs: [], script: '',
  })
  state = executeAction(state, { type: 'draft.update', pageId: page.id, patch: secondPatch }).state
  const savedAgain = state.pages[0].contentBlocks.find(block => block.type === 'list')
  assert.deepEqual([savedAgain.contentBlockId, savedAgain.items[0].listItemId], ids)
  assert.equal(savedAgain.items[0].content, '编辑后的首条要点')
})

test('fresh repository upload creates a Revision and Contract-valid export while PageAsset edits preserve IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-fresh-chain-'))
  const repository = await createRepository(dir)
  try {
    await repository.transactContent({ baseRevision: 0, source: 'human', detail: { actionType: 'outline.add' } }, state => executeAction(state, { type: 'outline.add', title: '素材页' }).state)
    let state = repository.getState()
    await repository.transactContent({ baseRevision: state.project.currentRevision, source: 'human', detail: { actionType: 'draft.ensurePage' } }, current => executeAction(current, { type: 'draft.ensurePage', outlineNodeId: current.outline[0].id }).state)
    state = repository.getState()
    for (const [index, name] of ['first.png', 'second.png'].entries()) {
      await ingestAsset({ repository, request: Readable.from([png(index)]), pageId: state.pages[0].id, mimeType: 'image/png', originalFileName: name })
      state = repository.getState()
    }
    const before = state.pages[0].pageAssets.map(item => item.pageAssetId)
    const moved = [...state.pages[0].pageAssets].reverse().map((item, order) => ({ ...item, caption: `说明 ${order + 1}`, order }))
    await repository.transactContent({ baseRevision: state.project.currentRevision, source: 'human', detail: { actionType: 'draft.update' } }, current => executeAction(current, { type: 'draft.update', pageId: current.pages[0].id, patch: { pageAssets: moved } }).state)
    state = repository.getState()
    assert.equal(state.project.currentRevision, 5)
    assert.deepEqual(state.pages[0].pageAssets.map(item => item.pageAssetId), [...before].reverse())

    const exported = await createStandardProjectService(repository).exportProject()
    const validation = await validateProjectDirectoryWithAjv(exported.projectRoot, { allowGitKeep: true })
    assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2))
    const draft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${state.pages[0].pageId}.json`), 'utf8'))
    assert.deepEqual(draft.pageAssets.map(item => item.pageAssetId), [...before].reverse())
    assert.deepEqual(draft.pageAssets.map(item => item.caption), ['说明 1', '说明 2'])
  } finally {
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('caption patch produced by the Draft buffer survives repository reload and standard export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-caption-reload-'))
  let repository = await createRepository(dir)
  try {
    await repository.transactContent({ baseRevision: 0, source: 'human', detail: { actionType: 'outline.add' } }, state => executeAction(state, { type: 'outline.add', title: '说明页' }).state)
    let state = repository.getState()
    await repository.transactContent({ baseRevision: state.project.currentRevision, source: 'human', detail: { actionType: 'draft.ensurePage' } }, current => executeAction(current, { type: 'draft.ensurePage', outlineNodeId: current.outline[0].id }).state)
    state = repository.getState()
    await ingestAsset({ repository, request: Readable.from([png()]), pageId: state.pages[0].id, mimeType: 'image/png', originalFileName: 'caption.png' })
    state = repository.getState()
    const original = state.pages[0].pageAssets[0]
    await repository.transactContent({ baseRevision: state.project.currentRevision, source: 'human', detail: { actionType: 'draft.update' } }, current => executeAction(current, {
      type: 'draft.update', pageId: current.pages[0].id, patch: { pageAssets: [{ ...original, caption: '来自草案 Buffer 的说明' }] },
    }).state)
    await repository.close()
    repository = await createRepository(dir)
    state = repository.getState()
    assert.deepEqual([state.pages[0].pageAssets[0].pageAssetId, state.pages[0].pageAssets[0].caption], [original.pageAssetId, '来自草案 Buffer 的说明'])
    const exported = await createStandardProjectService(repository).exportProject()
    const draft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${state.pages[0].pageId}.json`), 'utf8'))
    assert.equal(draft.pageAssets[0].caption, '来自草案 Buffer 的说明')
  } finally {
    await repository.close().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  }
})

test('standard import through UI save payload and core update preserves multiple ScriptBlocks and ListItems on export', async () => {
  const { buildDraftUpdatePatch } = await loadUiHelper()
  assert.equal(typeof buildDraftUpdatePatch, 'function')
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-import-ui-chain-'))
  const source = join(dir, 'source')
  const repository = await createRepository(join(dir, 'repository'))
  try {
    await cp(fixtureRoot, source, { recursive: true })
    const manifest = JSON.parse(await readFile(join(source, 'pages', 'manifest.json'), 'utf8'))
    const draftPath = join(source, ...manifest.pages[0].draftPath.split('/'))
    const sourceDraft = JSON.parse(await readFile(draftPath, 'utf8'))
    sourceDraft.scriptBlocks.push({ ...structuredClone(sourceDraft.scriptBlocks[0]), scriptBlockId: createStableId('scriptBlock'), order: 1, content: '第二段原始讲解稿' })
    await writeFile(draftPath, `${JSON.stringify(sourceDraft, null, 2)}\n`, 'utf8')

    const service = createStandardProjectService(repository)
    await service.importProject(source)
    let state = repository.getState()
    const page = state.pages[0]
    const list = page.contentBlocks.find(block => block.type === 'list')
    const patch = buildDraftUpdatePatch(page, {
      heading: page.heading,
      body: 'UI 编辑后的正文',
      listInputs: list.items.map((item, index) => ({ listItemId: item.listItemId, value: `UI 要点 ${index + 1}` })),
      scriptInputs: page.scriptBlocks.map((block, index) => ({ scriptBlockId: block.scriptBlockId, value: `UI 讲解稿 ${index + 1}` })),
      script: '',
    })
    await repository.transactContent({ baseRevision: state.project.currentRevision, source: 'human', detail: { actionType: 'draft.update' } }, current => executeAction(current, { type: 'draft.update', pageId: page.id, patch }).state)
    state = repository.getState()
    const exported = await service.exportProject()
    const draft = JSON.parse(await readFile(join(exported.projectRoot, 'pages', 'drafts', `${page.pageId}.json`), 'utf8'))
    assert.deepEqual(draft.scriptBlocks.map(item => item.scriptBlockId), sourceDraft.scriptBlocks.map(item => item.scriptBlockId))
    assert.deepEqual(draft.scriptBlocks.map(item => item.content), ['UI 讲解稿 1', 'UI 讲解稿 2'])
    assert.deepEqual(draft.contentBlocks.find(block => block.type === 'list').items.map(item => item.listItemId), sourceDraft.contentBlocks.find(block => block.type === 'list').items.map(item => item.listItemId))
    assert.deepEqual(draft.contentBlocks.find(block => block.type === 'list').items.map(item => item.content), list.items.map((_, index) => `UI 要点 ${index + 1}`))
  } finally {
    await repository.close()
    await rm(dir, { recursive: true, force: true })
  }
})
