import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

test('a decorative readability mask renders its fill without printing its editor label over the report', async () => {
  const root = { addEventListener() {}, style: {}, append() {} }
  const context = { document: { createElement: () => root, querySelector: () => null }, window: {}, structuredClone }
  vm.runInNewContext(await readFile(new URL('./public/layout-ui.js', import.meta.url), 'utf8'), context)
  const html = context.elementHtml({ layoutElementId: 'mask', type: 'shape', zIndex: 2,
    frame: { x: 0, y: 0, width: 1600, height: 900, rotation: 0 }, style: { fill: '#101820', opacity: 0.8 },
    payload: { shapeKind: 'rectangle', label: '文字可读性遮罩', decorative: true } })
  assert.match(html, /background:#101820/)
  assert.match(html, /opacity:0.8/)
  assert.doesNotMatch(html, />文字可读性遮罩</)
})

test('new text wrapping and metric content are rendered while existing text styles are left unchanged', async () => {
  const root = { addEventListener() {}, style: {}, append() {} }
  const context = { document: { createElement: () => root, querySelector: () => null }, window: {}, structuredClone }
  vm.runInNewContext(await readFile(new URL('./public/layout-ui.js', import.meta.url), 'utf8'), context)
  const element = { layoutElementId: 'metric', type: 'text', zIndex: 10,
    frame: { x: 0, y: 0, width: 400, height: 90, rotation: 0 }, style: { fontSize: 28, wordBreak: 'break-all' },
    payload: { kind: 'metric', label: '研究面积', value: 123, unit: '公顷' } }
  const html = context.elementHtml(element)
  assert.match(html, /研究面积 123 公顷/)
  assert.match(html, /word-break:break-all/)
  assert.doesNotMatch(context.elementHtml({ ...element, style: { fontSize: 28 } }), /word-break:/)
})
