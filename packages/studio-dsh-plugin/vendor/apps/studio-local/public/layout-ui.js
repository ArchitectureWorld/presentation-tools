const query = selector => document.querySelector(selector)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const clone = value => structuredClone(value)

let hostState = null
let record = null
let selectedId = null
let loading = false
let loadKey = null
let zoom = 0.72
let drag = null

const root = document.createElement('section')
root.id = 'layout-studio'
root.className = 'stage-view layout-studio'
root.hidden = true
query('#stage-workspace')?.append(root)

function endpoint(path) {
  const prefix = window.location.pathname.startsWith('/report-studio') ? '/report-studio' : ''
  const url = new URL(`${prefix}/api${path}`, window.location.origin)
  const sessionId = new URLSearchParams(window.location.search).get('sessionId')
  if (prefix && sessionId) url.searchParams.set('sessionId', sessionId)
  return `${url.pathname}${url.search}`
}

async function request(path, options = {}) {
  const response = await fetch(endpoint(path), {
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`)
    error.code = payload?.error?.code ?? 'layout_request_failed'
    throw error
  }
  return payload
}

function activePage() {
  return hostState?.pages?.find(page => page.id === hostState.ui?.activePageId)
    ?? hostState?.pages?.[0]
    ?? null
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function elementLabel(element) {
  if (element.payload?.role === 'page_title') return '页面标题'
  if (element.type === 'text') return element.payload?.content?.slice(0, 28) || '文本'
  if (element.type === 'image') return element.payload?.caption || element.payload?.originalFileName || '图片'
  if (element.type === 'group') return element.payload?.label || '分组'
  return element.payload?.label || '图形'
}

function assetUrl(element) {
  const assetId = element.payload?.assetId
  if (!assetId) return ''
  const prefix = window.location.pathname.startsWith('/report-studio') ? '/report-studio' : ''
  const url = new URL(`${prefix}/api/assets/${encodeURIComponent(assetId)}/content`, window.location.origin)
  const sessionId = new URLSearchParams(window.location.search).get('sessionId')
  if (prefix && sessionId) url.searchParams.set('sessionId', sessionId)
  return `${url.pathname}${url.search}`
}

function elementHtml(element) {
  const frame = element.frame
  const style = element.style ?? {}
  const selected = element.layoutElementId === selectedId
  const common = [
    `left:${frame.x}px`, `top:${frame.y}px`, `width:${frame.width}px`, `height:${frame.height}px`,
    `transform:rotate(${frame.rotation ?? 0}deg)`, `z-index:${element.zIndex}`,
    `opacity:${style.opacity ?? 1}`,
  ].join(';')
  let content = ''
  if (element.type === 'text') {
    content = `<div class="layout-text-content" style="color:${escapeHtml(style.textColor ?? '#24262d')};font-size:${Number(style.fontSize ?? 28)}px;font-weight:${Number(style.fontWeight ?? 400)};text-align:${escapeHtml(style.textAlign ?? 'left')}">${escapeHtml(element.payload?.content ?? '')}</div>`
  } else if (element.type === 'image') {
    const src = assetUrl(element)
    content = src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(elementLabel(element))}" style="object-fit:${escapeHtml(style.fit ?? 'cover')}">` : '<span>图片素材</span>'
  } else {
    content = `<span>${escapeHtml(elementLabel(element))}</span>`
  }
  const fill = element.type === 'shape' || element.type === 'group' ? `background:${escapeHtml(style.fill ?? 'transparent')};border-radius:${Number(style.cornerRadius ?? 0)}px` : ''
  return `<article class="layout-element layout-${escapeHtml(element.type)}${selected ? ' is-selected' : ''}" data-layout-element="${escapeHtml(element.layoutElementId)}" style="${common};${fill}">${content}${selected ? '<button class="layout-resize-handle" data-layout-resize type="button" aria-label="缩放元素"></button>' : ''}</article>`
}

function inspectorHtml(element) {
  if (!element) return '<div class="layout-empty-inspector">选择画布元素后编辑位置和样式。</div>'
  const frame = element.frame
  const opacity = Number(element.style?.opacity ?? 1)
  return `
    <div class="layout-inspector-heading"><div><small>SELECTED ELEMENT</small><strong>${escapeHtml(elementLabel(element))}</strong></div><span>${escapeHtml(element.type)}</span></div>
    <div class="layout-field-grid">
      ${[['x', 'X', frame.x], ['y', 'Y', frame.y], ['width', '宽', frame.width], ['height', '高', frame.height], ['rotation', '旋转', frame.rotation ?? 0]].map(([key, label, value]) => `<label><span>${label}</span><input data-layout-frame="${key}" type="number" value="${Number(value)}"></label>`).join('')}
    </div>
    <label class="layout-range"><span>不透明度 <b>${Math.round(opacity * 100)}%</b></span><input data-layout-opacity type="range" min="0" max="1" step="0.05" value="${opacity}"></label>
    ${element.type === 'text' ? `<label class="layout-single-field"><span>字号</span><input data-layout-font-size type="number" min="8" max="160" value="${Number(element.style?.fontSize ?? 28)}"></label>` : ''}
    ${['shape', 'group'].includes(element.type) ? `<label class="layout-single-field"><span>填充色</span><input data-layout-fill type="color" value="${/^#[0-9a-f]{6}$/i.test(element.style?.fill ?? '') ? element.style.fill : '#ffffff'}"></label>` : ''}
    <div class="layout-layer-actions"><button data-layout-layer="down" type="button" title="下移一层">↓</button><span>图层 ${Number(element.zIndex)}</span><button data-layout-layer="up" type="button" title="上移一层">↑</button></div>
  `
}

function render(message = '') {
  if (!hostState || hostState.ui?.stage !== 'layout') {
    root.hidden = true
    return
  }
  root.hidden = false
  const page = activePage()
  if (!page) {
    root.innerHTML = '<div class="layout-empty"><strong>暂无可排版页面</strong><p>先在大纲阶段生成草案页。</p></div>'
    return
  }
  if (loading) {
    root.innerHTML = '<div class="layout-empty"><strong>正在读取排版…</strong></div>'
    return
  }
  if (!record?.layout) {
    root.innerHTML = `<div class="layout-empty"><strong>${escapeHtml(page.heading || '未命名页面')}</strong><p>当前页面尚未建立 16:9 排版。</p><button class="primary-button" data-layout-ensure type="button">创建排版</button>${message ? `<small>${escapeHtml(message)}</small>` : ''}</div>`
    return
  }
  const selected = record.renderPlan?.elements?.find(element => element.layoutElementId === selectedId) ?? null
  const canvas = record.renderPlan?.canvas ?? { width: 1600, height: 900 }
  const width = Math.round(canvas.width * zoom)
  const height = Math.round(canvas.height * zoom)
  root.innerHTML = `
    <div class="layout-shell">
      <header class="layout-toolbar">
        <div><small>LAYOUT WORKSPACE</small><strong>${escapeHtml(page.heading || '未命名页面')}</strong><span>Revision ${Number(record.layout.layoutRevision)}</span></div>
        <div class="layout-toolbar-actions">
          <button data-layout-zoom="out" type="button" title="缩小">−</button>
          <button data-layout-zoom="fit" type="button" title="适合视图">${Math.round(zoom * 100)}%</button>
          <button data-layout-zoom="in" type="button" title="放大">＋</button>
          <button data-layout-reconcile type="button">同步草案</button>
        </div>
      </header>
      <div class="layout-body">
        <div class="layout-viewport" data-layout-viewport>
          <div class="layout-canvas-frame" style="width:${width}px;height:${height}px">
            <div class="layout-canvas" data-layout-canvas style="width:${canvas.width}px;height:${canvas.height}px;transform:scale(${zoom})">
              ${(record.renderPlan?.elements ?? []).slice().sort((left, right) => left.zIndex - right.zIndex).map(elementHtml).join('')}
            </div>
          </div>
        </div>
        <aside class="layout-inspector">${inspectorHtml(selected)}</aside>
      </div>
      <footer class="layout-status"><span>${message || (record.stale ? '草案来源已更新，等待同步' : '排版已保存')}</span><span>${record.renderPlan?.elements?.length ?? 0} 个元素 · 1600 × 900</span></footer>
    </div>`
}

async function loadLayout(force = false) {
  const page = activePage()
  if (!page || hostState.ui?.stage !== 'layout') return
  const key = `${page.id}:${hostState.project.currentRevision}`
  if (!force && key === loadKey && record) return
  loadKey = key
  loading = true
  render()
  try {
    record = await request(`/layout/pages/${encodeURIComponent(page.id)}`)
    if (!record.layout) selectedId = null
    else if (!record.renderPlan.elements.some(element => element.layoutElementId === selectedId)) selectedId = record.renderPlan.elements.at(-1)?.layoutElementId ?? null
    render()
  } catch (error) {
    record = null
    render(error.message)
  } finally {
    loading = false
    render()
  }
}

async function ensureLayout() {
  const page = activePage()
  if (!page) return
  loading = true
  render()
  try {
    record = await request(`/layout/pages/${encodeURIComponent(page.id)}/ensure`, {
      method: 'POST',
      body: JSON.stringify({ baseRevision: hostState.project.currentRevision }),
    })
    selectedId = record.renderPlan.elements.at(-1)?.layoutElementId ?? null
    loadKey = `${page.id}:${record.state.project.currentRevision}`
    window.reportStudioApplyExternalState?.(clone(record.state))
    render('排版已创建')
  } catch (error) {
    render(error.message)
  } finally {
    loading = false
    render()
  }
}

async function mutate(operation, successMessage) {
  const page = activePage()
  if (!page || !record?.layout) return
  try {
    record = await request(`/layout/pages/${encodeURIComponent(page.id)}/mutate`, {
      method: 'POST',
      body: JSON.stringify({
        baseRevision: hostState.project.currentRevision,
        expectedLayoutRevision: record.layout.layoutRevision,
        operation,
      }),
    })
    loadKey = `${page.id}:${record.state.project.currentRevision}`
    window.reportStudioApplyExternalState?.(clone(record.state))
    render(successMessage)
  } catch (error) {
    await loadLayout(true)
    render(error.message)
  }
}

async function reconcile() {
  const page = activePage()
  if (!page) return
  try {
    record = await request(`/layout/pages/${encodeURIComponent(page.id)}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ baseRevision: hostState.project.currentRevision }),
    })
    loadKey = `${page.id}:${record.state.project.currentRevision}`
    window.reportStudioApplyExternalState?.(clone(record.state))
    render('已同步最新草案')
  } catch (error) {
    render(error.message)
  }
}

function selectedElement() {
  return record?.renderPlan?.elements?.find(element => element.layoutElementId === selectedId) ?? null
}

root.addEventListener('click', event => {
  const element = event.target.closest('[data-layout-element]')
  if (element && !event.target.closest('[data-layout-resize]')) {
    selectedId = element.dataset.layoutElement
    render()
    return
  }
  if (event.target.closest('[data-layout-ensure]')) void ensureLayout()
  if (event.target.closest('[data-layout-reconcile]')) void reconcile()
  const zoomButton = event.target.closest('[data-layout-zoom]')
  if (zoomButton) {
    zoom = zoomButton.dataset.layoutZoom === 'in' ? clamp(zoom + 0.1, 0.25, 1.25)
      : zoomButton.dataset.layoutZoom === 'out' ? clamp(zoom - 0.1, 0.25, 1.25)
        : 0.72
    render()
  }
  const layer = event.target.closest('[data-layout-layer]')
  if (layer && selectedElement()) {
    const delta = layer.dataset.layoutLayer === 'up' ? 1 : -1
    void mutate({ type: 'reorder', layoutElementId: selectedId, zIndex: Math.max(0, selectedElement().zIndex + delta) }, '图层顺序已保存')
  }
})

root.addEventListener('change', event => {
  const element = selectedElement()
  if (!element) return
  if (event.target.matches('[data-layout-frame]')) {
    const frame = { ...element.frame, [event.target.dataset.layoutFrame]: Number(event.target.value) }
    if (frame.width < 24 || frame.height < 24) return render('宽高不能小于 24')
    void mutate({ type: 'frame', layoutElementId: selectedId, frame }, '几何已保存')
  } else if (event.target.matches('[data-layout-opacity]')) {
    void mutate({ type: 'style', layoutElementId: selectedId, style: { opacity: Number(event.target.value) } }, '样式已保存')
  } else if (event.target.matches('[data-layout-font-size]')) {
    void mutate({ type: 'style', layoutElementId: selectedId, style: { fontSize: Number(event.target.value) } }, '字号已保存')
  } else if (event.target.matches('[data-layout-fill]')) {
    void mutate({ type: 'style', layoutElementId: selectedId, style: { fill: event.target.value } }, '填充色已保存')
  }
})

root.addEventListener('pointerdown', event => {
  const node = event.target.closest('[data-layout-element]')
  if (!node || !record?.layout) return
  const element = record.renderPlan.elements.find(candidate => candidate.layoutElementId === node.dataset.layoutElement)
  if (!element) return
  selectedId = element.layoutElementId
  drag = {
    node,
    resize: Boolean(event.target.closest('[data-layout-resize]')),
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    frame: clone(element.frame),
  }
  node.setPointerCapture?.(event.pointerId)
  event.preventDefault()
})

root.addEventListener('pointermove', event => {
  if (!drag || drag.pointerId !== event.pointerId) return
  const dx = (event.clientX - drag.startX) / zoom
  const dy = (event.clientY - drag.startY) / zoom
  const frame = drag.resize
    ? { ...drag.frame, width: Math.max(24, Math.round(drag.frame.width + dx)), height: Math.max(24, Math.round(drag.frame.height + dy)) }
    : { ...drag.frame, x: Math.round(drag.frame.x + dx), y: Math.round(drag.frame.y + dy) }
  drag.preview = frame
  drag.node.style.left = `${frame.x}px`
  drag.node.style.top = `${frame.y}px`
  drag.node.style.width = `${frame.width}px`
  drag.node.style.height = `${frame.height}px`
})

root.addEventListener('pointerup', event => {
  if (!drag || drag.pointerId !== event.pointerId) return
  const current = drag
  drag = null
  current.node.releasePointerCapture?.(event.pointerId)
  if (current.preview) void mutate({ type: 'frame', layoutElementId: selectedId, frame: current.preview }, '位置与尺寸已保存')
})

window.reportStudioLayoutSync = nextState => {
  const previousPageId = activePage()?.id ?? null
  const previousRevision = hostState?.project?.currentRevision ?? null
  hostState = nextState
  const currentPageId = activePage()?.id ?? null
  render()
  if (hostState.ui?.stage === 'layout' && (previousPageId !== currentPageId || previousRevision !== hostState.project.currentRevision || !record)) {
    void loadLayout(previousPageId !== currentPageId)
  }
}
