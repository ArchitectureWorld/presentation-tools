import { assertLayoutPageDocument, sourceRefKey } from '../studio-layout-contracts/index.mjs'

// This deliberately matches the properties consumed by the Studio renderer.
export const DESIGN_RENDER_CAPABILITIES = Object.freeze({
  styles: ['opacity', 'fontSize', 'fontWeight', 'textColor', 'textAlign', 'wordBreak', 'fit', 'fill', 'cornerRadius'],
  stylesByType: {
    text: ['opacity', 'fontSize', 'fontWeight', 'textColor', 'textAlign', 'wordBreak'],
    image: ['opacity', 'fit'], shape: ['opacity', 'fill', 'cornerRadius'], group: ['opacity', 'fill', 'cornerRadius'],
  },
  defaultFontSize: 28, minimumTitleFontSize: 36, minimumBodyFontSize: 24, minimumFootnoteFontSize: 16,
  fontSizeReferenceCanvas: { width: 1600, height: 900 }, fontSizeScale: 'min(width/1600,height/900)',
  payloadFieldsByType: {
    text: ['kind', 'role', 'content', 'label', 'value', 'unit'],
    image: [], shape: ['shapeKind', 'label', 'decorative', 'role'], group: ['label', 'role'],
  },
  shapeKinds: ['rectangle'],
  diagramFit: 'contain',
})
const color = value => typeof value === 'string' && /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|transparent)$/iu.test(value)
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const styleRules = {
  opacity: value => number(value, 0, 1), fontSize: value => number(value, 1, 160),
  fontWeight: value => Number.isInteger(value) && number(value, 100, 900), textColor: color, fill: color,
  textAlign: value => ['left', 'center', 'right', 'justify'].includes(value),
  wordBreak: value => ['normal', 'break-all'].includes(value), fit: value => ['contain', 'cover'].includes(value),
  cornerRadius: value => number(value, 0, 800),
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
// Preserved source provenance is metadata, not an additional drawing capability.
const textMetadataFields = ['sourceType', 'order', 'sourceRefs', 'contentNature', 'parentContentBlockId', 'listItemId', 'metricId', 'note', 'tableRowId', 'tableCellId', 'tableColumnId', 'scriptBlockId', 'estimatedDurationSeconds', 'referencedContentBlockIds', 'referencedAssetIds']
function unsupportedPayloadFields(type, payload) {
  const fields = DESIGN_RENDER_CAPABILITIES.payloadFieldsByType[type]
  const unsupported = Object.keys(payload).filter(key => !fields.includes(key) && !(type === 'text' && textMetadataFields.includes(key)))
  if (Object.hasOwn(payload, 'role') && typeof payload.role !== 'string') unsupported.push('role')
  if (Object.hasOwn(payload, 'label') && typeof payload.label !== 'string') unsupported.push('label')
  if (type === 'shape') {
    if (Object.hasOwn(payload, 'shapeKind') && !DESIGN_RENDER_CAPABILITIES.shapeKinds.includes(payload.shapeKind)) unsupported.push('shapeKind')
    if (Object.hasOwn(payload, 'decorative') && typeof payload.decorative !== 'boolean') unsupported.push('decorative')
  }
  if (type === 'text') {
    if (payload.kind === 'metric') {
      if (typeof payload.label !== 'string') unsupported.push('label')
      if (typeof payload.value !== 'string' && !(typeof payload.value === 'number' && Number.isFinite(payload.value))) unsupported.push('value')
      if (payload.unit != null && typeof payload.unit !== 'string') unsupported.push('unit')
      if (Object.hasOwn(payload, 'content')) unsupported.push('content')
    } else {
      if (typeof payload.content !== 'string' && !(typeof payload.content === 'number' && Number.isFinite(payload.content))) unsupported.push('content')
      for (const key of ['label', 'value', 'unit']) if (Object.hasOwn(payload, key)) unsupported.push(key)
    }
  }
  return [...new Set(unsupported)]
}

// Manual edits and Agent candidates share typography rules, but only Agent
// candidates require complete current-source provenance for detached copy.
export function validateLayoutTypography({ layout, sources }) {
  const blockers = []
  const reference = DESIGN_RENDER_CAPABILITIES.fontSizeReferenceCanvas
  const scale = Math.min(layout.canvas.width / reference.width, layout.canvas.height / reference.height)
  for (const element of layout.elements) {
    if (element.type !== 'text') continue
    const payload = element.syncPolicy === 'live' ? sources[sourceRefKey(element.sourceRef)] : element.localPayload
    const role = payload?.role ?? ''
    const title = /^(?:page_title|main_title|title|主标题)$/iu.test(role)
    const footnote = /footnote|caption|脚注|图注/iu.test(role)
    const baseline = title ? DESIGN_RENDER_CAPABILITIES.minimumTitleFontSize : footnote ? DESIGN_RENDER_CAPABILITIES.minimumFootnoteFontSize : DESIGN_RENDER_CAPABILITIES.minimumBodyFontSize
    const minimum = baseline * scale
    const fontSize = element.style.fontSize ?? DESIGN_RENDER_CAPABILITIES.defaultFontSize
    if (!styleRules.fontSize(fontSize)) blockers.push({ code: 'design_unsupported_style', elementId: element.layoutElementId, detail: 'fontSize' })
    else if (fontSize < minimum) blockers.push({ code: 'design_small_text', elementId: element.layoutElementId, minimumFontSize: minimum })
  }
  return { valid: blockers.length === 0, blockers, warnings: [], capabilities: DESIGN_RENDER_CAPABILITIES }
}

export function validateDesignLayout({ layout, sources, sourceMapping = {} } = {}) {
  const blockers = [], warnings = []
  const block = (code, elementId = null, detail = null) => blockers.push({ code, elementId, detail })
  try { assertLayoutPageDocument(layout) } catch (error) {
    block(error.code ?? 'design_invalid_layout', null, error.message)
    return { valid: false, blockers, warnings, capabilities: DESIGN_RENDER_CAPABILITIES }
  }
  if (!object(sources) || !object(sourceMapping)) {
    block('design_invalid_source_mapping')
    return { valid: false, blockers, warnings, capabilities: DESIGN_RENDER_CAPABILITIES }
  }
  const inspect = (value, elementId, path = '') => {
    if (typeof value === 'string' && (/<\/?[a-z!][^>]*>/iu.test(value) || /(?:https?:\/\/|data:|javascript:|file:\/\/|url\s*\()/iu.test(value))) block('design_external_payload_forbidden', elementId, path)
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (/^(?:html|innerHTML|outerHTML|url|src|href|dataUrl|dataBase64|bytes)$/iu.test(key)) block('design_external_payload_forbidden', elementId, key)
      inspect(child, elementId, `${path}.${key}`)
    }
  }
  const elements = new Map(layout.elements.map(element => [element.layoutElementId, element]))
  const { elements: ignoredElements, ...documentFields } = layout
  inspect(documentFields, null)
  if (layout.elements.length > 500 || layout.canvas.width > 8192 || layout.canvas.height > 8192) block('design_layout_limit')
  for (const element of layout.elements) {
    const id = element.layoutElementId
    inspect(element, id)
    if (element.syncPolicy === 'detached') {
      for (const field of unsupportedPayloadFields(element.type, element.localPayload)) block('design_unsupported_payload', id, { type: element.type, field })
    }
    const { x, y, width, height, rotation } = element.frame
    const radians = rotation * Math.PI / 180
    const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))
    const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
    if (x + width / 2 - rotatedWidth / 2 < -0.001 || y + height / 2 - rotatedHeight / 2 < -0.001
      || x + width / 2 + rotatedWidth / 2 > layout.canvas.width + 0.001 || y + height / 2 + rotatedHeight / 2 > layout.canvas.height + 0.001) block('design_frame_outside_canvas', id)
    for (const [key, value] of Object.entries(element.style)) if (!DESIGN_RENDER_CAPABILITIES.stylesByType[element.type].includes(key) || !styleRules[key]?.(value)) block('design_unsupported_style', id, key)
    const visited = new Set([id])
    let parent = element.parentLayoutElementId
    while (parent) {
      const row = elements.get(parent)
      if (!row || row.type !== 'group' || visited.has(parent)) { block('design_invalid_parent', id); break }
      visited.add(parent); parent = row.parentLayoutElementId
    }
    let payload = element.localPayload
    if (element.syncPolicy === 'live') {
      const key = sourceRefKey(element.sourceRef)
      payload = sources[key]
      if (!Object.hasOwn(sources, key)) block('design_source_missing', id, key)
    } else if (element.type === 'text' || ['content', 'text', 'label'].some(key => typeof payload?.[key] === 'string' && payload[key].trim())) {
      // Decorative shape labels describe geometry and are not rendered as copy.
      const decorativeOnly = element.type === 'shape' && payload?.decorative === true && !payload.content && !payload.text
      if (!decorativeOnly) {
        const mapping = sourceMapping[id]
        if (!Array.isArray(mapping) || !mapping.length || mapping.some(key => typeof key !== 'string' || !Object.hasOwn(sources, key) || sources[key].kind === 'asset')) block('design_source_mapping_required', id)
      }
    }
    if (element.type === 'image') {
      if (element.syncPolicy !== 'live' || element.sourceRef?.kind !== 'page-asset' || payload?.kind !== 'asset' || !/^image\//u.test(payload?.objectRef?.mimeType ?? '')) block('design_image_source_forbidden', id)
      const photographic = /photo|photograph|摄影|照片/iu.test(payload?.metadata?.semanticRole ?? '')
      if (!photographic && element.style.fit !== 'contain') block('design_diagram_requires_contain', id)
    }
    if (element.type === 'text') {
      if (!payload || !['text', 'list-item', 'metric', 'table-cell', 'script-block', undefined].includes(payload.kind)) block('design_text_source_invalid', id)
    }
  }
  blockers.push(...validateLayoutTypography({ layout, sources }).blockers)
  for (const id of Object.keys(sourceMapping)) if (!elements.has(id)) block('design_source_mapping_unknown_element', id)
  return { valid: blockers.length === 0, blockers, warnings, capabilities: DESIGN_RENDER_CAPABILITIES }
}
