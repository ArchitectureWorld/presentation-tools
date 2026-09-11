import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import { createStudioId } from '../../packages/studio-contracts/index.mjs'
import { createRepository } from './repository.mjs'
import { createLayoutService } from './layout-service.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'layout-service-test-'))
  const repository = await createRepository(join(root, 'studio'))
  const initial = repository.getState()
  const outlineNodeId = createStudioId('outlineNode')
  const pageId = createStudioId('page')
  const titleBlockId = createStudioId('contentBlock')
  const bodyBlockId = createStudioId('contentBlock')
  await repository.transactContent({ baseRevision: initial.project.currentRevision, source: 'test', detail: { actionType: 'fixture' } }, state => {
    state.outline = [{
      id: outlineNodeId,
      outlineNodeId,
      parentOutlineNodeId: null,
      title: '目标',
      order: 0,
      sourceRefs: [],
      opaqueExtension: null,
      children: [],
    }]
    state.pages = [{
      id: pageId,
      pageId,
      outlineNodeId,
      draftDocumentId: createStudioId('draftDocument'),
      titleBlockId,
      order: 0,
      contentBlocks: [
        { contentBlockId: titleBlockId, type: 'heading', role: 'page_title', order: 0, content: '项目目标', sourceRefs: [] },
        { contentBlockId: bodyBlockId, type: 'text', role: 'body', order: 1, content: '建立稳定的排版链路。', sourceRefs: [] },
      ],
      scriptBlocks: [{ scriptBlockId: createStudioId('scriptBlock'), order: 0, content: '本页说明项目目标。', estimatedDurationSeconds: null, sourceRefs: [], referencedContentBlockIds: [titleBlockId], referencedAssetIds: [] }],
      pageAssets: [], assets: [], heading: '项目目标', body: '建立稳定的排版链路。', bullets: [], script: '本页说明项目目标。',
    }]
    state.ui = { stage: 'draft', activePageId: pageId }
    return state
  })
  const service = createLayoutService({ repository, layoutRoot: join(root, 'workspace', 'layouts') })
  return {
    root, repository, service, pageId, bodyBlockId,
    async close() { await repository.close(); await rm(root, { recursive: true, force: true }) },
  }
}

async function attachAssets(fx, specs) {
  const assets = await Promise.all(specs.map(async (spec, order) => {
    const mimeType = spec.mimeType ?? 'image/png'
    const objectRef = await fx.repository.putBlob(Readable.from([Buffer.from(`fixture-${order}`)]), { mimeType, originalFileName: spec.name ?? 'site.png' })
    return { id: createStudioId('asset'), assetId: null, pageAssetId: createStudioId('pageAsset'), name: spec.name ?? 'site.png',
      mimeType, objectRef, role: spec.role ?? 'supporting', order, caption: spec.name ?? '现场照片', sourceRefs: [], ...spec }
  }))
  for (const asset of assets) asset.assetId = asset.id
  await fx.repository.transactContent({ baseRevision: fx.repository.getState().project.currentRevision, source: 'test', detail: { actionType: 'attach-assets' } }, state => {
    state.pages[0].assets = [...state.pages[0].assets, ...assets]
    state.pages[0].pageAssets = [...state.pages[0].pageAssets, ...assets.filter(asset => !asset.unlinked).map(asset => structuredClone(asset))]
    return state
  })
  return assets
}

test('new layout uses the current page background as a full canvas image beneath a readable mask and text', async () => {
  const fx = await fixture()
  try {
    const [background] = await attachAssets(fx, [{ role: 'background', extensionPayload: { standard: { semanticRole: 'photograph' } } }])
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const image = result.renderPlan.elements.find(element => element.type === 'image')
    assert.equal(image.payload.assetId, background.assetId)
    assert.equal(image.sourceKey, `page-asset:${background.pageAssetId}`)
    assert.deepEqual(image.frame, { x: 0, y: 0, width: 1600, height: 900, rotation: 0 })
    assert.equal(image.style.fit, 'cover')
    const mask = result.renderPlan.elements.find(element => element.type === 'shape' && element.zIndex > image.zIndex)
    assert.ok(mask, 'background photograph needs a text readability mask')
    assert.equal(mask.style.fill, '#101820')
    assert.ok(mask.style.opacity >= 0.75)
    assert.equal(mask.payload.decorative, true)
    for (const text of result.renderPlan.elements.filter(element => element.type === 'text')) {
      assert.ok(text.zIndex > mask.zIndex)
      assert.equal(text.style.textColor, '#f5f5f7')
    }
  } finally { await fx.close() }
})

test('professional map and chart backgrounds keep their complete extent even in a full-canvas frame', async () => {
  for (const semanticRole of ['map', 'analytical_diagram', 'chart']) {
    const fx = await fixture()
    try {
      await attachAssets(fx, [{ role: 'background', extensionPayload: { standard: { semanticRole } } }])
      const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
      const image = result.renderPlan.elements.find(element => element.type === 'image')
      assert.equal(image.style.fit, 'contain', semanticRole)
      assert.deepEqual(image.frame, { x: 0, y: 0, width: 1600, height: 900, rotation: 0 })
    } finally { await fx.close() }
  }
})

test('new layout contains professional images without cropping and never turns PDF originals or unlinked assets into pictures', async () => {
  const fx = await fixture()
  try {
    const [original, chart, unrelated] = await attachAssets(fx, [
      { name: '工程量原件.pdf', mimeType: 'application/pdf', role: 'reference' },
      { name: '投资图表.png', role: 'primary' },
      { name: '别页背景.png', role: 'background', unlinked: true },
    ])
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const images = result.renderPlan.elements.filter(element => element.type === 'image')
    assert.deepEqual(images.map(image => image.payload.assetId), [chart.assetId])
    assert.equal(images[0].style.fit, 'contain')
    assert.ok(!images.some(image => [original.assetId, unrelated.assetId].includes(image.payload.assetId)))
  } finally { await fx.close() }
})

test('adding a background later preserves the already edited layout instead of applying a new default', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const title = result.layout.elements.find(element => element.type === 'text')
    result = await fx.service.mutate({ pageId: fx.pageId, baseRevision: result.state.project.currentRevision, expectedLayoutRevision: result.layout.layoutRevision,
      operation: { type: 'frame', layoutElementId: title.layoutElementId, frame: { x: 181, y: 91, width: 1000, height: 100, rotation: 0 } } })
    const before = result.layout.elements.map(({ frame, style, layoutElementId }) => ({ frame, style, layoutElementId }))
    await attachAssets(fx, [{ role: 'background' }])
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    assert.equal(result.created, false)
    assert.deepEqual(result.layout.elements.map(({ frame, style, layoutElementId }) => ({ frame, style, layoutElementId })), before)
  } finally { await fx.close() }
})

test('speaker notes remain available as sources but are never placed in a new layout', async () => {
  const fx = await fixture()
  try {
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    assert.ok(result.sourceProjection.sources.some(source => source.kind === 'script'))
    assert.ok(!result.renderPlan.elements.some(element => element.sourceKey?.startsWith('script-block:')))
    assert.ok(!result.renderPlan.elements.some(element => element.payload?.content === '本页说明项目目标。'))
  } finally { await fx.close() }
})

test('default body text never falls below the readable 24px floor', async () => {
  const fx = await fixture()
  try {
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const body = result.renderPlan.elements.find(element => element.sourceKey === `content-block:${fx.bodyBlockId}`)
    assert.ok(body, 'the body source must be represented in the default layout')
    assert.ok(body.style.fontSize >= 24, `body text must stay at or above 24px, got ${body.style.fontSize}px`)
  } finally { await fx.close() }
})

test('CAD and unknown image MIME types stay in the page library without becoming layout images', async () => {
  const fx = await fixture()
  try {
    const assets = await attachAssets(fx, [
      { name: '总图.dwg', mimeType: 'image/vnd.dwg', role: 'supporting' },
      { name: '总图.dxf', mimeType: 'image/vnd.dxf', role: 'primary' },
      { name: 'unknown.bin', mimeType: 'image/not-a-browser-format', role: 'background' },
    ])
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    assert.equal(result.renderPlan.elements.filter(element => element.type === 'image').length, 0)
    assert.equal(result.state.pages[0].pageAssets.length, assets.length)
  } finally { await fx.close() }
})

test('reference photos remain available in the page library without being placed in the foreground', async () => {
  const fx = await fixture()
  try {
    const [reference, primary] = await attachAssets(fx, [{ role: 'reference' }, { role: 'primary' }])
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    assert.deepEqual(result.renderPlan.elements.filter(element => element.type === 'image').map(element => element.payload.assetId), [primary.assetId])
    assert.ok(result.sourceProjection.sources.some(source => source.key === `page-asset:${reference.pageAssetId}`))
  } finally { await fx.close() }
})

test('body that cannot fit at the readable floor returns layout_text_overflow instead of shrinking text', async () => {
  const fx = await fixture()
  try {
    const body = '项目建设内容与实施条件需要逐项核实。'.repeat(38)
    await fx.repository.transactContent({ baseRevision: fx.repository.getState().project.currentRevision, source: 'test' }, state => {
      state.pages[0].contentBlocks.find(block => block.contentBlockId === fx.bodyBlockId).content = body
      return state
    })
    await attachAssets(fx, [{ role: 'primary' }])
    const revision = fx.repository.getState().project.currentRevision
    let captured
    await assert.rejects(fx.service.ensure({ pageId: fx.pageId, baseRevision: revision }), error => {
      captured = error
      return error.code === 'layout_text_overflow'
    })
    assert.match(captured.message, /拆分/)
    assert.equal(fx.repository.getState().project.currentRevision, revision)
    assert.equal(fx.repository.getState().pages[0].layoutRef, undefined)
  } finally { await fx.close() }
})

test('a title that cannot fit at 36px fails without saving an unreadable layout', async () => {
  const fx = await fixture()
  try {
    await fx.repository.transactContent({ baseRevision: fx.repository.getState().project.currentRevision, source: 'test' }, state => {
      state.pages[0].contentBlocks.find(block => block.role === 'page_title').content = '题'.repeat(100)
      return state
    })
    const revision = fx.repository.getState().project.currentRevision
    await assert.rejects(fx.service.ensure({ pageId: fx.pageId, baseRevision: revision }), { code: 'layout_text_overflow' })
    assert.equal(fx.repository.getState().project.currentRevision, revision)
    assert.equal(fx.repository.getState().pages[0].layoutRef, undefined)
  } finally { await fx.close() }
})

test('all short body blocks are retained instead of silently taking only the first ten', async () => {
  const fx = await fixture()
  try {
    await fx.repository.transactContent({ baseRevision: fx.repository.getState().project.currentRevision, source: 'test' }, state => {
      for (let index = 0; index < 11; index += 1) state.pages[0].contentBlocks.push({
        contentBlockId: createStudioId('contentBlock'), type: 'text', role: 'body', order: index + 2, content: `完整保留要点 ${index}`, sourceRefs: [],
      })
      return state
    })
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    assert.equal(result.renderPlan.elements.filter(element => element.type === 'text' && element.payload.role !== 'page_title').length, 12)
    assert.ok(result.renderPlan.elements.every(element => element.frame.y + element.frame.height <= 900))
  } finally { await fx.close() }
})

test('unreadably dense content fails before persisting a clipped layout', async () => {
  const fx = await fixture()
  try {
    await fx.repository.transactContent({ baseRevision: fx.repository.getState().project.currentRevision, source: 'test' }, state => {
      state.pages[0].contentBlocks.find(block => block.contentBlockId === fx.bodyBlockId).content = '密集正文'.repeat(3000)
      return state
    })
    const revision = fx.repository.getState().project.currentRevision
    await assert.rejects(fx.service.ensure({ pageId: fx.pageId, baseRevision: revision }), error => error.code === 'layout_text_overflow')
    assert.equal(fx.repository.getState().project.currentRevision, revision)
    assert.equal(fx.repository.getState().pages[0].layoutRef, undefined)
  } finally { await fx.close() }
})

test('dense paragraphs flow below a supporting image instead of being squeezed into its narrow column', async () => {
  const fx = await fixture()
  try {
    await fx.repository.transactContent({ baseRevision: fx.repository.getState().project.currentRevision, source: 'test' }, state => {
      const page = state.pages[0]
      page.contentBlocks.find(block => block.contentBlockId === fx.bodyBlockId).content = '核实建设条件。'.repeat(26)
      for (const [index, count] of [26, 26, 4, 4].entries()) page.contentBlocks.push({
        contentBlockId: createStudioId('contentBlock'), type: 'text', role: 'body', order: index + 2,
        content: '保留全部论据。'.repeat(count), sourceRefs: [],
      })
      return state
    })
    await attachAssets(fx, [{ role: 'supporting' }])
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const image = result.renderPlan.elements.find(element => element.type === 'image')
    const texts = result.renderPlan.elements.filter(element => element.type === 'text' && element.payload.role !== 'page_title')
    assert.equal(texts.length, 5)
    assert.ok(texts.some(text => text.frame.width > 790 && text.frame.y >= image.frame.y + image.frame.height))
    assert.ok(texts.every(text => text.style.fontSize >= 24 && text.frame.y + text.frame.height <= 900))
  } finally { await fx.close() }
})

test('dense text-only pages report layout_text_overflow before violating the body floor', async () => {
  const fx = await fixture()
  try {
    const contents = ['文'.repeat(160), `${'文'.repeat(160)}\n\n${'文'.repeat(51)}`,
      ...[160, 50, 162, 159, 154, 128].map(length => '文'.repeat(length))]
    await fx.repository.transactContent({ baseRevision: fx.repository.getState().project.currentRevision, source: 'test' }, state => {
      const page = state.pages[0]
      page.contentBlocks[0].content = '题'.repeat(52)
      page.contentBlocks = [page.contentBlocks[0], ...contents.map((content, index) => ({
        contentBlockId: createStudioId('contentBlock'), type: 'text', role: 'body', order: index + 1,
        content, sourceRefs: [],
      }))]
      return state
    })
    const revision = fx.repository.getState().project.currentRevision
    let captured
    await assert.rejects(fx.service.ensure({ pageId: fx.pageId, baseRevision: revision }), error => {
      captured = error
      return error.code === 'layout_text_overflow'
    })
    assert.match(captured.message, /拆分/)
    assert.equal(fx.repository.getState().project.currentRevision, revision)
    assert.equal(fx.repository.getState().pages[0].layoutRef, undefined)
  } finally { await fx.close() }
})

test('ensure creates a persisted LayoutPage and attaches an exact hash ref to the project Revision', async () => {
  const fx = await fixture()
  try {
    const before = fx.repository.getState().project.currentRevision
    const result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: before })
    assert.equal(result.created, true)
    assert.equal(result.layout.layoutRevision, 0)
    assert.equal(result.state.project.currentRevision, before + 1)
    assert.equal(result.state.pages[0].layoutRef.sha256, result.layoutRef.sha256)
    assert.equal(result.layout.projectId, result.state.project.projectId)
    assert.ok(result.renderPlan.elements.length >= 3)
    const stored = await fx.service.store.readPage(fx.pageId)
    assert.equal(stored.ref.sha256, result.layoutRef.sha256)
  } finally { await fx.close() }
})

test('opening an unchanged layout is a complete no-op for project and layout revisions', async () => {
  const fx = await fixture()
  try {
    const created = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const revision = created.state.project.currentRevision
    const reopened = await fx.service.ensure({ pageId: fx.pageId, baseRevision: revision })
    assert.equal(reopened.noOp, true)
    assert.equal(reopened.state.project.currentRevision, revision)
    assert.equal(reopened.layout.layoutRevision, created.layout.layoutRevision)
  } finally { await fx.close() }
})

test('frame and style mutations use both project CAS and layout CAS', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const title = result.layout.elements.find(item => item.type === 'text')
    result = await fx.service.mutate({
      pageId: fx.pageId,
      baseRevision: result.state.project.currentRevision,
      expectedLayoutRevision: result.layout.layoutRevision,
      operation: { type: 'frame', layoutElementId: title.layoutElementId, frame: { x: 200, y: 120, width: 900, height: 110, rotation: 2 } },
    })
    assert.equal(result.layout.layoutRevision, 1)
    assert.deepEqual(result.layout.elements.find(item => item.layoutElementId === title.layoutElementId).frame, { x: 200, y: 120, width: 900, height: 110, rotation: 2 })
    await assert.rejects(
      fx.service.mutate({ pageId: fx.pageId, baseRevision: result.state.project.currentRevision, expectedLayoutRevision: 0, operation: { type: 'style', layoutElementId: title.layoutElementId, style: { opacity: 0.5 } } }),
      error => error.code === 'layout_revision_conflict',
    )
  } finally { await fx.close() }
})

test('human style mutations reject body text below the shared design readability floor', async () => {
  const fx = await fixture()
  try {
    const created = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const body = created.layout.elements.find(item => item.sourceRef?.kind === 'content-block' && item.sourceRef.contentBlockId === fx.bodyBlockId)
    await assert.rejects(
      fx.service.mutate({
        pageId: fx.pageId,
        baseRevision: created.state.project.currentRevision,
        expectedLayoutRevision: created.layout.layoutRevision,
        operation: { type: 'style', layoutElementId: body.layoutElementId, style: { fontSize: 23 } },
      }),
      error => error.code === 'design_validation_failed'
        && error.details?.blockers?.some(row => row.code === 'design_small_text' && row.elementId === body.layoutElementId),
    )
    const current = await fx.service.get({ pageId: fx.pageId, reconcile: false })
    assert.equal(current.layout.elements.find(item => item.layoutElementId === body.layoutElementId).style.fontSize, 28)
  } finally { await fx.close() }
})

test('legacy small texts can be repaired one at a time without allowing a new undersized edit', async () => {
  const fx = await fixture()
  try {
    let record = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const legacy = structuredClone(record.layout)
    for (const element of legacy.elements.filter(row => row.type === 'text')) element.style.fontSize = 18
    const written = await fx.service.store.writePage(legacy, { expectedLayoutRevision: record.layout.layoutRevision,
      sourceProjectRevision: record.state.project.currentRevision, sourceStateHash: legacy.sourceStateHash })
    await fx.repository.transactContent({ baseRevision: record.state.project.currentRevision, source: 'test' }, state => {
      state.pages[0].layoutRef = written.ref
      return state
    })
    record = await fx.service.get({ pageId: fx.pageId, reconcile: false })
    const texts = record.layout.elements.filter(row => row.type === 'text')
    for (const [index, element] of texts.entries()) {
      record = await fx.service.mutate({ pageId: fx.pageId, baseRevision: record.state.project.currentRevision,
        expectedLayoutRevision: record.layout.layoutRevision,
        operation: { type: 'style', layoutElementId: element.layoutElementId, style: { fontSize: index === 0 ? 36 : 24 } } })
      assert.equal(record.layout.elements.find(row => row.layoutElementId === element.layoutElementId).style.fontSize, index === 0 ? 36 : 24)
    }
    await assert.rejects(fx.service.mutate({ pageId: fx.pageId, baseRevision: record.state.project.currentRevision,
      expectedLayoutRevision: record.layout.layoutRevision,
      operation: { type: 'style', layoutElementId: texts[1].layoutElementId, style: { fontSize: 23 } } }), { code: 'design_validation_failed' })
  } finally { await fx.close() }
})

test('draft source changes reconcile live content without moving or restyling layout elements', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const title = result.layout.elements.find(item => item.type === 'text')
    result = await fx.service.mutate({
      pageId: fx.pageId, baseRevision: result.state.project.currentRevision, expectedLayoutRevision: result.layout.layoutRevision,
      operation: { type: 'frame', layoutElementId: title.layoutElementId, frame: { x: 222, y: 88, width: 888, height: 120, rotation: 0 } },
    })
    const frame = structuredClone(result.layout.elements.find(item => item.layoutElementId === title.layoutElementId).frame)
    const style = structuredClone(result.layout.elements.find(item => item.layoutElementId === title.layoutElementId).style)
    const beforeHash = result.layout.sourceStateHash
    await fx.repository.transactContent({ baseRevision: result.state.project.currentRevision, source: 'test', detail: { actionType: 'draft-change' } }, state => {
      state.pages[0].contentBlocks.find(block => block.contentBlockId === state.pages[0].titleBlockId).content = '更新后的项目目标'
      state.pages[0].heading = '更新后的项目目标'
      return state
    })
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision, source: 'workspace-sync' })
    const after = result.layout.elements.find(item => item.layoutElementId === title.layoutElementId)
    assert.deepEqual(after.frame, frame)
    assert.deepEqual(after.style, style)
    assert.notEqual(result.layout.sourceStateHash, beforeHash)
    assert.equal(result.renderPlan.elements.find(item => item.layoutElementId === title.layoutElementId).payload.content, '更新后的项目目标')
  } finally { await fx.close() }
})

test('removed sources become orphaned while detached elements keep local payload and geometry', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const body = result.layout.elements.find(item => item.sourceRef?.contentBlockId === fx.bodyBlockId)
    result = await fx.service.mutate({
      pageId: fx.pageId, baseRevision: result.state.project.currentRevision, expectedLayoutRevision: result.layout.layoutRevision,
      operation: { type: 'detach', layoutElementId: body.layoutElementId },
    })
    const detached = structuredClone(result.layout.elements.find(item => item.layoutElementId === body.layoutElementId))
    await fx.repository.transactContent({ baseRevision: result.state.project.currentRevision, source: 'test', detail: { actionType: 'remove-body' } }, state => {
      state.pages[0].contentBlocks = state.pages[0].contentBlocks.filter(block => block.contentBlockId !== fx.bodyBlockId)
      state.pages[0].body = ''
      return state
    })
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision, source: 'workspace-sync' })
    const after = result.layout.elements.find(item => item.layoutElementId === body.layoutElementId)
    assert.equal(after.syncPolicy, 'detached')
    assert.deepEqual(after.localPayload, detached.localPayload)
    assert.deepEqual(after.frame, detached.frame)
  } finally { await fx.close() }
})

test('layouts/ survives loss of the page pointer and is reattached from the Presentation-owned store', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const sha = result.layoutRef.sha256
    await fx.repository.transactContent({ baseRevision: result.state.project.currentRevision, source: 'test', detail: { actionType: 'simulate-upstream-replace' } }, state => {
      delete state.pages[0].layoutRef
      return state
    })
    const before = fx.repository.getState().project.currentRevision
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: before, source: 'workspace-sync' })
    assert.equal(result.state.project.currentRevision, before + 1)
    assert.equal(result.state.pages[0].layoutRef.sha256, sha)
    assert.equal(result.layoutRef.sha256, sha)
  } finally { await fx.close() }
})

test('removed live sources become orphaned without losing geometry or style', async () => {
  const fx = await fixture()
  try {
    let result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision })
    const body = result.layout.elements.find(item => item.sourceRef?.contentBlockId === fx.bodyBlockId)
    const before = structuredClone(body)
    await fx.repository.transactContent({ baseRevision: result.state.project.currentRevision, source: 'test', detail: { actionType: 'remove-live-body' } }, state => {
      state.pages[0].contentBlocks = state.pages[0].contentBlocks.filter(block => block.contentBlockId !== fx.bodyBlockId)
      state.pages[0].body = ''
      return state
    })
    result = await fx.service.ensure({ pageId: fx.pageId, baseRevision: fx.repository.getState().project.currentRevision, source: 'workspace-sync' })
    const after = result.layout.elements.find(item => item.layoutElementId === body.layoutElementId)
    assert.equal(after.syncPolicy, 'live')
    assert.equal(after.elementState, 'orphaned')
    assert.deepEqual(after.frame, before.frame)
    assert.deepEqual(after.style, before.style)
    assert.equal(result.layout.syncState, 'orphaned')
  } finally { await fx.close() }
})
