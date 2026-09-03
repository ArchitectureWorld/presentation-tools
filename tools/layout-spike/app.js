import { assertLayoutAdapter } from '../../packages/studio-layout-adapter/index.mjs'
import {
  createSpikeState,
  moveSelectedElement,
  resizeSelectedElement,
  selectElement,
  serializeFrameChanges,
} from './model.mjs'

const query = selector => document.querySelector(selector)
const clone = value => structuredClone(value)
let state = createSpikeState()

function elementLabel(element) {
  if (element.type === 'text') return '页面标题'
  if (element.type === 'image') return element.payload?.label || '图片素材'
  return element.payload?.label || '独立图形'
}

function createDomLayoutAdapter() {
  let root = null
  let handlers = null
  let viewModel = null
  let scale = 1
  let drag = null
  let mounted = false

  function viewportScale(canvas) {
    const width = Math.max(320, root.clientWidth - 56)
    const height = Math.max(220, root.clientHeight - 56)
    return Math.max(0.2, Math.min(1, width / canvas.width, height / canvas.height))
  }

  function makeElementNode(element, selected) {
    const node = document.createElement('article')
    node.className = `layout-element element-${element.type}${selected ? ' is-selected' : ''}`
    node.dataset.elementId = element.layoutElementId
    node.style.left = `${element.frame.x}px`
    node.style.top = `${element.frame.y}px`
    node.style.width = `${element.frame.width}px`
    node.style.height = `${element.frame.height}px`
    node.style.transform = `rotate(${element.frame.rotation}deg)`
    node.style.zIndex = String(element.zIndex)
    node.title = `${elementLabel(element)} · ${element.syncPolicy}`

    if (element.type === 'text') {
      const text = document.createElement('div')
      text.className = 'element-text-content'
      text.textContent = typeof element.payload === 'string' ? element.payload : element.payload?.text || 'Text'
      text.style.fontSize = `${element.style.fontSize ?? 40}px`
      text.style.fontWeight = String(element.style.fontWeight ?? 700)
      text.style.lineHeight = String(element.style.lineHeight ?? 1.2)
      text.style.textAlign = element.style.textAlign ?? 'left'
      node.append(text)
    } else if (element.type === 'image') {
      const visual = document.createElement('div')
      visual.className = 'image-placeholder'
      visual.innerHTML = '<i></i><i></i><i></i><i></i>'
      const copy = document.createElement('div')
      copy.className = 'image-placeholder-copy'
      const label = document.createElement('strong')
      label.textContent = element.payload?.label || 'Image placeholder'
      const note = document.createElement('span')
      note.textContent = element.payload?.note || 'Asset payload resolved by adapter'
      copy.append(label, note)
      node.append(visual, copy)
    } else {
      node.style.background = element.style.fill ?? '#202838'
      node.style.borderColor = element.style.stroke ?? 'rgba(255,255,255,.15)'
      node.style.borderRadius = `${element.style.cornerRadius ?? 18}px`
      const copy = document.createElement('div')
      copy.className = `shape-copy shape-${element.payload?.kind || 'default'}`
      const label = document.createElement('strong')
      label.textContent = element.payload?.label || 'Shape'
      copy.append(label)
      if (element.payload?.note) {
        const note = document.createElement('span')
        note.textContent = element.payload.note
        copy.append(note)
      }
      node.append(copy)
    }

    const policy = document.createElement('span')
    policy.className = `policy-chip policy-${element.syncPolicy}`
    policy.textContent = element.syncPolicy
    node.append(policy)

    if (selected) {
      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = 'resize-handle'
      handle.dataset.resizeHandle = element.layoutElementId
      handle.setAttribute('aria-label', `缩放 ${elementLabel(element)}`)
      node.append(handle)
    }
    return node
  }

  function render(nextViewModel) {
    if (!mounted) throw new Error('Layout adapter must be mounted before render().')
    viewModel = nextViewModel
    scale = viewportScale(viewModel.renderPlan.canvas)
    root.replaceChildren()

    const stage = document.createElement('div')
    stage.className = 'canvas-stage'
    stage.style.width = `${viewModel.renderPlan.canvas.width * scale}px`
    stage.style.height = `${viewModel.renderPlan.canvas.height * scale}px`

    const canvas = document.createElement('div')
    canvas.className = 'layout-canvas'
    canvas.style.width = `${viewModel.renderPlan.canvas.width}px`
    canvas.style.height = `${viewModel.renderPlan.canvas.height}px`
    canvas.style.transform = `scale(${scale})`
    canvas.dataset.scale = String(scale)

    for (const element of viewModel.renderPlan.elements.slice().sort((left, right) => left.zIndex - right.zIndex)) {
      canvas.append(makeElementNode(element, element.layoutElementId === viewModel.selectedElementId))
    }
    stage.append(canvas)
    root.append(stage)
  }

  function onMouseDown(event) {
    const handle = event.target.closest('[data-resize-handle]')
    const element = event.target.closest('[data-element-id]')
    if (!element || event.button !== 0) return
    event.preventDefault()
    const layoutElementId = element.dataset.elementId
    handlers.onSelect(layoutElementId)
    drag = {
      mode: handle ? 'resize' : 'move',
      layoutElementId,
      lastX: event.clientX,
      lastY: event.clientY,
    }
  }

  function onMouseMove(event) {
    if (!drag) return
    const deltaX = (event.clientX - drag.lastX) / scale
    const deltaY = (event.clientY - drag.lastY) / scale
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    if (drag.mode === 'resize') handlers.onResize(drag.layoutElementId, { width: deltaX, height: deltaY })
    else handlers.onMove(drag.layoutElementId, { x: deltaX, y: deltaY })
  }

  function onMouseUp() {
    drag = null
  }

  function onResize() {
    if (viewModel) render(viewModel)
    handlers?.onViewportChange?.()
  }

  return {
    mount(target, nextHandlers) {
      if (!(target instanceof HTMLElement)) throw new TypeError('mount() requires an HTMLElement root')
      if (mounted) throw new Error('Layout adapter is already mounted')
      root = target
      handlers = nextHandlers
      root.addEventListener('mousedown', onMouseDown)
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
      window.addEventListener('resize', onResize)
      mounted = true
    },
    render,
    readViewportState() {
      if (!mounted) throw new Error('Layout adapter is not mounted')
      return {
        viewportWidth: root.clientWidth,
        viewportHeight: root.clientHeight,
        documentWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scale,
      }
    },
    destroy() {
      if (!mounted) return
      root.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('resize', onResize)
      root.replaceChildren()
      root = null
      handlers = null
      viewModel = null
      drag = null
      mounted = false
    },
  }
}

const adapter = assertLayoutAdapter(createDomLayoutAdapter())

function selectedElement() {
  return state.renderPlan.elements.find(element => element.layoutElementId === state.selectedElementId) ?? null
}

function renderInspector() {
  const element = selectedElement()
  query('#selection-name').textContent = element ? elementLabel(element) : '未选择元素'
  query('#selection-badges').replaceChildren()
  if (element) {
    for (const label of [element.type, element.syncPolicy, element.elementState]) {
      const badge = document.createElement('span')
      badge.textContent = label
      query('#selection-badges').append(badge)
    }
  }

  const fields = {
    '#frame-x': element?.frame.x,
    '#frame-y': element?.frame.y,
    '#frame-width': element?.frame.width,
    '#frame-height': element?.frame.height,
  }
  for (const [selector, value] of Object.entries(fields)) {
    query(selector).textContent = value === undefined ? '—' : Number(value.toFixed(1)).toString()
  }

  const serialized = serializeFrameChanges(state)
  query('#frame-changes').textContent = JSON.stringify(serialized, null, 2)
  query('#change-count').textContent = `${serialized.changes.length} 项框架变更`
  const viewport = adapter.readViewportState()
  query('#scale-label').textContent = `${Math.round(viewport.scale * 100)}% 适配`
}

function render() {
  adapter.render(state)
  renderInspector()
}

adapter.mount(query('#canvas-viewport'), {
  onSelect(layoutElementId) {
    state = selectElement(state, layoutElementId)
    render()
  },
  onMove(layoutElementId, delta) {
    if (state.selectedElementId !== layoutElementId) state = selectElement(state, layoutElementId)
    state = moveSelectedElement(state, delta)
    render()
  },
  onResize(layoutElementId, delta) {
    if (state.selectedElementId !== layoutElementId) state = selectElement(state, layoutElementId)
    state = resizeSelectedElement(state, delta)
    render()
  },
  onViewportChange() {
    if (query('#scale-label')) renderInspector()
  },
})

query('#reset-layout').addEventListener('click', () => {
  state = createSpikeState()
  query('#copy-status').textContent = ''
  render()
})

query('#copy-frame-changes').addEventListener('click', async () => {
  const text = JSON.stringify(serializeFrameChanges(state), null, 2)
  try {
    await navigator.clipboard.writeText(text)
    query('#copy-status').textContent = '已复制'
  } catch {
    query('#copy-status').textContent = '浏览器未授权复制'
  }
})

render()

window.__layoutSpike = Object.freeze({
  getState: () => clone(state),
  getSerialized: () => clone(serializeFrameChanges(state)),
  getViewportState: () => clone(adapter.readViewportState()),
  reset() {
    state = createSpikeState()
    render()
    return clone(state)
  },
})
window.__layoutSpikeReady = true
