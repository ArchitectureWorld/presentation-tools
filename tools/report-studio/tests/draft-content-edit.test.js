const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Core = require('../src/studio-model.js')
const { createMockStudioAdapter } = require('../src/mock-studio-adapter.js')

function geometry(layout) {
  return layout.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))
}

test('updateDraftPage saves structured text and synchronizes matching layout text without moving elements', () => {
  const state = Core.createInitialState()
  const originalPage = Core.findPage(state, 'page-04')
  const beforeGeometry = geometry(originalPage.layout)

  const next = Core.updateDraftPage(state, 'page-04', {
    headline: '统一数字底座，支撑园区持续演进',
    body: '统一连接设备、业务系统与空间模型。',
    bullets: ['打通数据孤岛', '复用业务能力', '支持持续扩展'],
    metrics: [
      { value: '1', label: '统一底座' },
      { value: '3', label: '能力层级' },
      { value: '20+', label: '业务场景' },
    ],
    script: [
      { time: '00:00', text: '先说明统一底座的建设价值。' },
      { time: '00:20', text: '再说明能力复用与持续扩展。' },
    ],
  }, { now: '2026-09-02T03:00:00.000Z' })

  const page = Core.findPage(next, 'page-04')
  assert.equal(page.headline, '统一数字底座，支撑园区持续演进')
  assert.equal(page.body, '统一连接设备、业务系统与空间模型。')
  assert.deepEqual(page.bullets, ['打通数据孤岛', '复用业务能力', '支持持续扩展'])
  assert.deepEqual(page.metrics[1], { value: '3', label: '能力层级' })
  assert.equal(page.script[1].text, '再说明能力复用与持续扩展。')
  assert.equal(next.lastSavedAt, '2026-09-02T03:00:00.000Z')

  assert.equal(page.layout.find(item => item.id === 'layout-page-04-title').text, page.headline)
  assert.equal(page.layout.find(item => item.id === 'layout-page-04-body').text, page.body)
  assert.deepEqual(geometry(page.layout), beforeGeometry)

  assert.equal(originalPage.headline, '构建统一、开放、可持续演进的智慧园区技术底座')
})

test('updateDraftPage synchronizes bullet-list layout text and rejects an empty headline', () => {
  const state = Core.createInitialState()
  const next = Core.updateDraftPage(state, 'page-03', {
    headline: '从真实业务链路确定建设优先级',
    body: '先解决跨系统协同，再推进数据复用。',
    bullets: ['统一身份与权限', '统一事件与工单'],
    metrics: [{ value: '2', label: '优先能力' }],
    script: [{ time: '00:00', text: '从业务链路展开需求分析。' }],
  })

  const page = Core.findPage(next, 'page-03')
  assert.equal(
    page.layout.find(item => item.id === 'layout-page-03-list').text,
    '统一身份与权限\n统一事件与工单',
  )

  assert.throws(() => Core.updateDraftPage(state, 'page-03', {
    headline: '   ',
    body: '',
    bullets: [],
    metrics: [],
    script: [],
  }), /页面标题不能为空/)
})

test('mock adapter persists manually edited draft content', () => {
  const data = new Map()
  const storage = {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { data.set(key, String(value)) },
    removeItem(key) { data.delete(key) },
  }
  const first = createMockStudioAdapter({ storage, seedComments: false })
  first.updateDraftPage('page-04', {
    headline: '人工修改后的页面标题',
    body: '人工修改后的页面正文',
    bullets: ['人工要点'],
    metrics: [{ value: '1', label: '人工指标' }],
    script: [{ time: '00:00', text: '人工修改后的讲解脚本' }],
  })

  const restored = createMockStudioAdapter({ storage, seedComments: false }).getState()
  const page = Core.findPage(restored, 'page-04')
  assert.equal(page.headline, '人工修改后的页面标题')
  assert.equal(page.layout.find(item => item.id === 'layout-page-04-title').text, '人工修改后的页面标题')
})

test('draft UI exposes a deliberate edit mode with save and cancel controls', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../prototype/app.js'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../prototype/styles.css'), 'utf8')

  assert.match(app, /data-edit-draft-content/)
  assert.match(app, /data-save-draft-content/)
  assert.match(app, /data-cancel-draft-content/)
  assert.match(app, /data-draft-editor/)
  assert.match(app, /updatePageContent/)
  assert.match(app, /编辑内容/)
  assert.match(app, /保存修改/)
  assert.match(app, /取消/)
  assert.match(app, /isDraftEditing/)
  assert.match(styles, /\.draft-edit-form/)
  assert.match(styles, /\.draft-field/)
})
