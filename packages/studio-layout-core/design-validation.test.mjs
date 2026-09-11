import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLayoutPage, addDetachedLayoutElement, addLiveLayoutElement } from './index.mjs'
const module = await import('./design-validation.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error })
const sourceRef = { kind: 'content-block', contentBlockId: 'block-current' }
const sources = { 'content-block:block-current': { kind: 'text', content: '当前正文', role: 'body' }, 'page-asset:asset-current': { kind: 'asset', objectRef: { sha256: 'a'.repeat(64), mimeType: 'image/png' }, metadata: { semanticRole: 'diagram' } } }
function layout() { return addDetachedLayoutElement(createLayoutPage({ projectId: 'project-test', pageId: 'page-test', baseDraftRevision: 0 }), { layoutElementId: 'text-a', type: 'text', localPayload: { content: '整理后的正文' }, frame: { x: 10, y: 10, width: 500, height: 200, rotation: 0 }, style: { fontSize: 28 } }) }
function validate(value, mapping = { 'text-a': ['content-block:block-current'] }) {
  assert.equal(typeof module.validateDesignLayout, 'function', 'guarded layout validation must exist')
  return module.validateDesignLayout({ layout: value, sources, sourceMapping: mapping })
}
test('detached text needs complete current-source mapping; foreign URL, HTML and image references are blockers', () => {
  assert.equal(validate(layout()).valid, true)
  for (const mapping of [{}, { 'text-a': ['content-block:missing'] }, { 'text-a': [] }, { 'text-a': ['page-asset:asset-current'] }]) assert.equal(validate(layout(), mapping).valid, false)
  for (const patch of [{ html: '<b>payload</b>' }, { url: 'https://foreign.example/file' }, { content: '<img src=x onerror=alert(1)>' }]) {
    const value = layout(); Object.assign(value.elements[0].localPayload, patch); assert.equal(validate(value).valid, false)
  }
  const image = addLiveLayoutElement(layout(), { type: 'image', sourceRef, frame: { x: 600, y: 10, width: 300, height: 300, rotation: 0 }, style: { fit: 'contain' } })
  assert.equal(validate(image).valid, false)
})
test('validation rejects unsupported style values, off-canvas frames and invalid or cyclic parents', () => {
  for (const style of [{ position: 'fixed' }, { fontSize: '28; color:red' }, { fill: 'url(https://evil.test)' }, { opacity: 2 }, { textAlign: 'unset' }]) {
    const value = layout(); value.elements[0].style = style; assert.equal(validate(value).valid, false)
  }
  for (const frame of [{ x: -1 }, { width: 1601 }, { rotation: NaN }]) { const value = layout(); Object.assign(value.elements[0].frame, frame); assert.equal(validate(value).valid, false) }
  for (const parent of ['missing', 'text-a']) { const value = layout(); value.elements[0].parentLayoutElementId = parent; assert.equal(validate(value).valid, false) }
})
test('small type blocks ordinary copy and diagram images must use contain', () => {
  const value = layout(); value.elements[0].style.fontSize = 12
  assert.ok(validate(value).blockers.some(row => row.code === 'design_small_text'))
  value.elements[0].style.fontSize = 24
  const image = addLiveLayoutElement(value, { type: 'image', sourceRef: { kind: 'page-asset', pageAssetId: 'asset-current' }, frame: { x: 600, y: 10, width: 300, height: 300, rotation: 0 }, style: { fit: 'cover' } })
  assert.equal(validate(image).valid, false)
  image.elements.at(-1).style.fit = 'contain'
  assert.equal(validate(image).valid, true)
})

test('ordinary body text below 24px is a blocking readability failure while footnotes keep their 16px exception', () => {
  const body = layout(); body.elements[0].style.fontSize = 23
  const bodyResult = validate(body)
  assert.equal(bodyResult.valid, false)
  assert.ok(bodyResult.blockers.some(row => row.code === 'design_small_text' && row.elementId === 'text-a'))
  const footnote = layout(); footnote.elements[0].localPayload.role = 'footnote'; footnote.elements[0].style.fontSize = 16
  assert.equal(validate(footnote).valid, true)
  footnote.elements[0].style.fontSize = 15
  assert.equal(validate(footnote).valid, false, 'the footnote exception stops at 16px')
})

test('visible shape and group labels cannot bypass source mapping', () => {
  for (const type of ['shape', 'group']) {
    const value = layout(); value.elements[0].type = type; value.elements[0].style = {}; value.elements[0].localPayload = { label: '无来源的结论' }
    assert.equal(validate(value, {}).valid, false)
    assert.equal(validate(value).valid, true)
  }
})

test('type-specific styles are rejected when the actual renderer cannot use them', () => {
  const value = layout(); value.elements[0].style.fill = '#112233'
  assert.equal(validate(value).valid, false)
  const image = addLiveLayoutElement(layout(), { type: 'image', sourceRef: { kind: 'page-asset', pageAssetId: 'asset-current' }, frame: { x: 600, y: 10, width: 300, height: 300, rotation: 0 }, style: { fit: 'contain', cornerRadius: 18 } })
  assert.equal(validate(image).valid, false)
})

test('opaque document fields cannot hide an arbitrary URL or HTML payload', () => {
  for (const patch of [{ html: '<iframe src="https://example.test"></iframe>' }, { external: { url: 'https://example.test/a.png' } }]) {
    assert.equal(validate({ ...layout(), ...patch }).valid, false)
  }
})

test('readability checks use title 36 body 24 and footnote or caption 16 scaled with the canvas', () => {
  for (const [width, height, role, minimum] of [
    [1600, 900, 'page_title', 36], [1600, 900, 'body', 24], [1600, 900, 'footnote', 16], [1600, 900, 'caption', 16],
    [800, 450, 'page_title', 18], [800, 450, 'body', 12], [800, 450, 'caption', 8],
    [3200, 1800, 'page_title', 72], [3200, 1800, 'body', 48], [3200, 1800, 'footnote', 32],
  ]) {
    const value = layout()
    value.canvas = { ...value.canvas, width, height }
    value.elements[0].localPayload.role = role
    value.elements[0].style.fontSize = minimum - 1
    const tooSmall = validate(value)
    const issues = tooSmall.blockers
    assert.ok(issues.some(row => row.code === 'design_small_text' && row.minimumFontSize === minimum), `${role} on ${width}x${height} needs ${minimum}px`)
    value.elements[0].style.fontSize = minimum
    assert.equal(validate(value).blockers.some(row => row.code === 'design_small_text'), false)
  }
  const title = addLiveLayoutElement(createLayoutPage({ projectId: 'project-test', pageId: 'page-test', baseDraftRevision: 0 }), {
    type: 'text', sourceRef, frame: { x: 10, y: 10, width: 500, height: 200, rotation: 0 }, style: {},
  })
  const result = module.validateDesignLayout({ layout: title, sources: { 'content-block:block-current': { kind: 'text', role: 'page_title', content: '当前标题' } } })
  assert.ok(result.blockers.some(row => row.minimumFontSize === 36), 'the real renderer default 28px must block a live page title')
  assert.equal(result.capabilities.minimumTitleFontSize, 36)
  assert.equal(result.capabilities.minimumBodyFontSize, 24)
  assert.equal(result.capabilities.minimumFootnoteFontSize, 16)
})

test('local payload capability gaps reject paths arrows crop and unsupported fields instead of silently drawing a rectangle', () => {
  for (const payload of [
    { shapeKind: 'path', path: 'M 0 0 L 20 20', decorative: true },
    { shapeKind: 'arrow', decorative: true },
    { shapeKind: 'ellipse', decorative: true },
    { shapeKind: 'rectangle', crop: { x: 0, y: 0, width: 1, height: 1 }, decorative: true },
    { shapeKind: 'rectangle', path: 'M 0 0', decorative: true },
    { shapeKind: 'rectangle', decorative: 'true' },
  ]) {
    const value = layout(); value.elements[0].type = 'shape'; value.elements[0].style = {}; value.elements[0].localPayload = payload
    const result = validate(value)
    assert.equal(result.valid, false, JSON.stringify(payload))
    assert.ok(result.blockers.some(row => row.code === 'design_unsupported_payload'))
  }
  for (const type of ['text', 'group']) {
    const value = layout(); value.elements[0].type = type; value.elements[0].style = {}
    value.elements[0].localPayload = type === 'text' ? { content: '正文', crop: { x: 0 } } : { label: '分组', path: 'M 0 0' }
    assert.equal(validate(value).valid, false)
  }
  const textAlias = layout(); textAlias.elements[0].localPayload = { text: '当前 renderer 对 detached text 不读取此字段' }
  assert.equal(validate(textAlias).valid, false)
})

test('supported local payloads remain valid with provenance metadata and source mapping', () => {
  for (const [type, payload] of [
    ['text', { kind: 'text', content: '正文', role: 'body', sourceType: 'text', order: 0, sourceRefs: [], contentNature: 'proposal' }],
    ['text', { kind: 'metric', label: '面积', value: 20, unit: 'ha', metricId: 'metric-current', parentContentBlockId: 'block-current', note: null, sourceRefs: [] }],
    ['shape', { shapeKind: 'rectangle', decorative: true, label: '页面背景' }],
    ['shape', { label: '当前来源说明', decorative: false }],
    ['group', { label: '当前来源分组' }],
  ]) {
    const value = layout(); value.elements[0].type = type; value.elements[0].style = {}; value.elements[0].localPayload = payload
    assert.equal(validate(value).valid, true, JSON.stringify(payload))
  }
})
