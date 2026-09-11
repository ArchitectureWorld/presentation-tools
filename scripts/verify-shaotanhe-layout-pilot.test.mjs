import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan, layoutFamilyFor, selectVisualAssets } from './verify-shaotanhe-layout-pilot.mjs'

const asset = (assetId, kind, displayName, sourcePageId = 'page-source') => ({
  assetId, pageAssetId: `${assetId}-page`, displayName, role: 'supporting', sourcePageId,
  objectRef: { sha256: assetId.padEnd(64, '0').slice(0, 64), sizeBytes: 1000, mimeType: 'image/png' }, widthPx: 1600, heightPx: 1000,
  pilotKind: kind,
})

const page = title => ({ pageId: 'page-test', projectId: 'project-test', contentBlocks: [{ type: 'heading', role: 'page_title', content: title }] })

test('pilot assigns distinct visual families instead of one shared template', () => {
  const families = [0, 1, 2, 3, 4, 5, 6, 7].map(index => layoutFamilyFor(index))
  assert.ok(new Set(families).size >= 6)
})

test('pilot selects multiple semantically related visual assets and keeps source page bindings', () => {
  const current = asset('current', 'map', '少潭河遥感影像（现状空间证据）', 'page-test')
  const boundary = asset('boundary', 'diagram', '依据资料绘制的信息图解｜规划边界与法定准入规则')
  const ai = asset('ai', 'ai', 'AI概念示意｜水源保护与岸带监测')
  const selected = selectVisualAssets(page('规划边界与开发约束'), [current, boundary, ai], 2)
  assert.ok(selected.length >= 2)
  assert.deepEqual(selected.slice(0, 2).map(item => item.assetId).sort(), ['boundary', 'current'])
  assert.equal(selected.every(item => item.sourcePageId), true)
})

test('boundary page prefers a boundary diagram and map over an unrelated concept image', () => {
  const map = asset('map', 'map', '少潭河遥感影像｜现状空间证据', 'page-boundary')
  const boundary = asset('boundary', 'diagram', '依据资料绘制的信息图解｜法定边界与红线规则')
  const concept = asset('ai', 'ai', 'AI概念示意｜水源保护与岸带监测')
  const selected = selectVisualAssets(page('规划管控、权属与开发边界'), [map, boundary, concept], 6)
  assert.deepEqual(selected.slice(0, 2).map(item => item.assetId).sort(), ['boundary', 'map'])
})

test('buildPlan renders more than one image for a non-hero page and records a family', () => {
  const assets = [asset('one', 'map', '现状遥感图'), asset('two', 'diagram', '边界信息图')]
  const result = buildPlan(page('现状证据与核心矛盾'), 2, assets)
  assert.ok(['evidence-map', 'evidence-grid', 'compare', 'metrics', 'risk', 'timeline', 'decision', 'hero'].includes(result.layoutFamily))
  assert.ok(result.renderPlan.elements.filter(element => element.type === 'image').length >= 2)
})
