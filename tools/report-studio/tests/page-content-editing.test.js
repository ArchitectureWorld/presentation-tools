const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Core = require('../src/studio-model.js')
const { createMockStudioAdapter } = require('../src/mock-studio-adapter.js')

function createStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

test('manual page-content update changes draft data and synchronizes mapped layout text without moving elements', () => {
  const state = Core.createInitialState()
  const originalPage = Core.findPage(state, 'page-04')
  const titleBefore = originalPage.layout.find(item => item.id === 'layout-page-04-title')
  const bodyBefore = originalPage.layout.find(item => item.id === 'layout-page-04-body')
  const titleGeometry = { x: titleBefore.x, y: titleBefore.y, w: titleBefore.w, h: titleBefore.h }
  const bodyGeometry = { x: bodyBefore.x, y: bodyBefore.y, w: bodyBefore.w, h: bodyBefore.h }

  const next = Core.updatePageContent(state, 'page-04', {
    headline: '统一数据底座，支撑园区持续演进与业务扩展',
    body: '统一承接设备、业务系统与空间模型，并向上提供可复用能力。',
    bullets: ['减少重复建设。', '保留标准接口。'],
    metrics: [
      { value: '1', label: '统一数据底座' },
      { value: '4 层', label: '技术能力架构' },
      { value: '30+', label: '可扩展业务场景' },
    ],
    script: [
      { time: '00:00', text: '先解释为什么需要统一底座。' },
      { time: '00:20', text: '再说明底座怎样支撑业务扩展。' },
    ],
  }, { now: '2026-09-02T03:00:00.000Z' })

  const page = Core.findPage(next, 'page-04')
  assert.equal(page.headline, '统一数据底座，支撑园区持续演进与业务扩展')
  assert.equal(page.body, '统一承接设备、业务系统与空间模型，并向上提供可复用能力。')
  assert.deepEqual(page.bullets, ['减少重复建设。', '保留标准接口。'])
  assert.deepEqual(page.metrics[1], { value: '4 层', label: '技术能力架构' })
  assert.deepEqual(page.script[1], { time: '00:20', text: '再说明底座怎样支撑业务扩展。' })
  assert.equal(page.layout.find(item => item.id === 'layout-page-04-title').text, page.headline)
  assert.equal(page.layout.find(item => item.id === 'layout-page-04-body').text, page.body)
  assert.deepEqual(
    Object.fromEntries(Object.entries(page.layout.find(item => item.id === 'layout-page-04-title')).filter(([key]) => ['x', 'y', 'w', 'h'].includes(key))),
    titleGeometry,
  )
  assert.deepEqual(
    Object.fromEntries(Object.entries(page.layout.find(item => item.id === 'layout-page-04-body')).filter(([key]) => ['x', 'y', 'w', 'h'].includes(key))),
    bodyGeometry,
  )
  assert.equal(next.lastSavedAt, '2026-09-02T03:00:00.000Z')
  assert.equal(originalPage.headline, '构建统一、开放、可持续演进的智慧园区技术底座')
  assert.equal(titleBefore.text, '统一数据底座，\n支撑园区持续演进')
})

test('manual page-content update synchronizes an existing layout bullet list and validates the headline', () => {
  const state = Core.createInitialState()
  const next = Core.updatePageContent(state, 'page-03', {
    headline: '从核心痛点确定建设优先级',
    body: '先处理高频、高影响且跨系统的问题。',
    bullets: ['统一身份与权限', '统一事件与工单', '统一空间与设备数据'],
    metrics: [],
    script: [],
  })
  const page = Core.findPage(next, 'page-03')
  assert.equal(page.layout.find(item => item.id === 'layout-page-03-title').text, page.headline)
  assert.equal(page.layout.find(item => item.id === 'layout-page-03-list').text, page.bullets.join('\n'))
  assert.throws(() => Core.updatePageContent(state, 'page-03', { headline: '   ' }), /页面标题不能为空/)
  assert.throws(() => Core.updatePageContent(state, 'missing-page', { headline: '标题' }), /页面不存在/)
})

test('mock adapter persists manual page-content edits', () => {
  const storage = createStorage()
  const first = createMockStudioAdapter({ storage, storageKey: 'manual-content', seedComments: false })
  first.updatePageContent('page-04', {
    headline: '人工修改后的页面标题',
    body: '人工修改后的页面正文',
    bullets: ['第一条人工要点'],
    metrics: [{ value: '8', label: '人工指标' }],
    script: [{ time: '00:00', text: '人工修改后的讲解脚本。' }],
  })

  const restored = createMockStudioAdapter({ storage, storageKey: 'manual-content', seedComments: false })
  const page = Core.findPage(restored.getState(), 'page-04')
  assert.equal(page.headline, '人工修改后的页面标题')
  assert.equal(page.layout.find(item => item.id === 'layout-page-04-title').text, '人工修改后的页面标题')
  assert.equal(page.script[0].text, '人工修改后的讲解脚本。')
})

test('draft UI exposes a dedicated edit mode with save and cancel actions and suspends annotation selection', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../prototype/app.js'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../prototype/styles.css'), 'utf8')

  assert.match(app, /data-edit-page-content/)
  assert.match(app, /data-save-page-content/)
  assert.match(app, /data-cancel-page-content/)
  assert.match(app, /pageContentEdit/)
  assert.match(app, /renderDraftContentEditor/)
  assert.match(app, /adapter\.updatePageContent/)
  assert.match(app, /if \(pageContentEdit\) return/)
  assert.match(styles, /\.page-content-editor/)
  assert.match(styles, /\.content-edit-block/)
  assert.match(styles, /\.content-edit-actions/)
})
