export function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function elementLabel(element) {
  if (element.payload?.role === 'page_title') return '页面标题'
  if (element.type === 'text') return element.payload?.content?.slice(0, 28) || '文本'
  if (element.type === 'image') return element.payload?.caption || element.payload?.originalFileName || '图片'
  if (element.type === 'group') return element.payload?.label || '分组'
  return element.payload?.label || '图形'
}

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
// Accept the editor's existing solid colours; never interpolate arbitrary CSS declarations.
const color = (value, fallback) => /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(String(value ?? '')) ? value : fallback
const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback

function elementHtml(element, { assetUrl, selectedId, editable }) {
  const frame = element.frame
  const style = element.style ?? {}
  const selected = editable && element.layoutElementId === selectedId
  const common = [
    `left:${number(frame.x)}px`, `top:${number(frame.y)}px`, `width:${number(frame.width)}px`, `height:${number(frame.height)}px`,
    `transform:rotate(${number(frame.rotation)}deg)`, `z-index:${number(element.zIndex)}`,
    `opacity:${number(style.opacity, 1)}`,
  ].join(';')
  let content = ''
  if (element.type === 'text') {
    const payload = element.payload ?? {}
    const text = payload.kind === 'metric' ? `${payload.label} ${String(payload.value)}${payload.unit ? ` ${payload.unit}` : ''}` : payload.content ?? ''
    content = `<div class="layout-text-content" style="color:${escapeHtml(color(style.textColor, '#24262d'))};font-size:${number(style.fontSize, 28)}px;font-weight:${number(style.fontWeight, 400)};text-align:${choice(style.textAlign, ['left', 'center', 'right', 'justify'], 'left')}${style.wordBreak === 'break-all' ? ';word-break:break-all' : ''}">${escapeHtml(text)}</div>`
  } else if (element.type === 'image') {
    const src = assetUrl(element)
    content = src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(elementLabel(element))}" style="object-fit:${choice(style.fit, ['cover', 'contain', 'fill', 'none', 'scale-down'], 'cover')}">` : '<span>图片素材</span>'
  } else if (element.type !== 'shape' || element.payload?.decorative !== true) {
    content = `<span>${escapeHtml(elementLabel(element))}</span>`
  }
  const fill = element.type === 'shape' || element.type === 'group' ? `background:${escapeHtml(color(style.fill, 'transparent'))};border-radius:${number(style.cornerRadius)}px` : ''
  return `<article class="layout-element layout-${escapeHtml(element.type)}${selected ? ' is-selected' : ''}" data-layout-element="${escapeHtml(element.layoutElementId)}" style="${common};${fill}">${content}${selected ? '<button class="layout-resize-handle" data-layout-resize type="button" aria-label="缩放元素"></button>' : ''}</article>`
}

// This is the only element-markup implementation for both the editor and PNG previews.
export function renderLayoutElements(renderPlan, { assetUrl = () => '', selectedId = null, editable = false } = {}) {
  return (renderPlan?.elements ?? []).slice().sort((left, right) => left.zIndex - right.zIndex)
    .map(element => elementHtml(element, { assetUrl, selectedId, editable })).join('')
}
