import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { readStandardProject } from '../packages/studio-standard-adapter/index.mjs'
import { createLayoutPreviewRenderer } from '../apps/studio-local/layout-preview.mjs'
import { resolveDshOpenPencilPackage, runOpenPencilRuntimeSmoke } from '../packages/studio-layout-openpencil/runtime.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const clone = value => structuredClone(value)
// The pilot must exercise visual page types, not simply the first twelve pages.
// These pages cover the acceptance matrix: cover, context, evidence, boundary,
// derived diagram, product diagram, AI concept, metric, capacity, risk,
// investment and decision closure.
const pilotIndexes = [0, 1, 5, 6, 23, 44, 21, 35, 67, 65, 75, 88]

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024

function textOf(page) {
  return page.contentBlocks?.find(block => block.type === 'heading' && block.role === 'page_title')?.content
    ?? page.contentBlocks?.find(block => block.type === 'text')?.content
    ?? page.pageId
}

function shorten(value, max = 34) {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').replace(/目前(?:仍)?属于(?:初步判断|方案建议|现行有效|inferred)[^：]*/u, '').trim()
  if (cleaned.length <= max) return cleaned
  const head = cleaned.split('：')[0]
  return `${(head.length < max - 2 ? head : cleaned).slice(0, max - 1)}…`
}

function assetKind(asset) {
  const label = `${asset?.displayName ?? ''} ${asset?.name ?? ''} ${asset?.caption ?? ''}`
  if (/AI概念|AI concept|generated_by_tool/i.test(label)) return 'ai'
  if (/信息图解|图表|指标|投资|风险|边界|功能|流程|承载|实施/i.test(label)) return 'diagram'
  if (/遥感|影像|地图|现场|空间现状/i.test(label)) return 'map'
  return 'visual'
}

const FAMILY_SPECS = {
  hero: { label: '主视觉封面', kinds: ['map', 'ai', 'visual'], requiredKinds: ['map', 'ai'], maxAssets: 2 },
  'evidence-map': { label: '地图 + 证据', kinds: ['map', 'diagram', 'ai'], requiredKinds: ['map', 'diagram'], maxAssets: 3 },
  'evidence-grid': { label: '证据矩阵', kinds: ['diagram', 'map', 'ai'], requiredKinds: ['diagram', 'map'], maxAssets: 3 },
  compare: { label: '双图对照', kinds: ['diagram', 'ai', 'map'], requiredKinds: ['diagram', 'ai'], maxAssets: 2 },
  grid: { label: '三卡图解', kinds: ['diagram', 'ai', 'map'], requiredKinds: ['diagram'], maxAssets: 3 },
  metrics: { label: '指标仪表盘', kinds: ['diagram', 'map', 'ai'], requiredKinds: ['diagram'], maxAssets: 3 },
  risk: { label: '风险矩阵', kinds: ['ai', 'diagram', 'map'], requiredKinds: ['ai', 'diagram'], maxAssets: 3 },
  timeline: { label: '实施路径', kinds: ['diagram', 'ai', 'map'], requiredKinds: ['diagram'], maxAssets: 3 },
  decision: { label: '决策闭环', kinds: ['diagram', 'map', 'ai'], requiredKinds: ['diagram'], maxAssets: 3 },
}

const PILOT_TOPIC_TERMS = {
  0: ['综合', '水资源', '现状', '决策'],
  1: ['背景', '现状', '边界', '水库'],
  5: ['现状', '问题', '风险', '监测'],
  6: ['边界', '规划', '法定', '红线'],
  23: ['存量', '建筑', '空间', '调查'],
  44: ['产品', '功能', '水利', '生态'],
  21: ['水资源', '农业', '灌溉', '流域'],
  35: ['指标', '红线', '控制', '道路'],
  67: ['生态', '承载', '露营', '交通'],
  65: ['风险', '水土', '监测', '生态'],
  75: ['投资', '资金', '财务', '建设'],
  88: ['启动', '条件', '责任', '实施', '风险'],
}

const PILOT_REQUIRED_KINDS = {
  0: ['map', 'ai'],
  1: ['map', 'diagram'],
  5: ['map', 'diagram'],
  6: ['diagram', 'map'],
  23: ['diagram', 'ai'],
  44: ['diagram', 'ai'],
  21: ['ai', 'diagram'],
  35: ['diagram'],
  67: ['diagram', 'ai'],
  65: ['ai', 'diagram'],
  75: ['diagram'],
  88: ['diagram'],
}

const PILOT_MAX_ASSETS = { 0: 2, 1: 2, 5: 3, 6: 2, 23: 2, 44: 3, 21: 2, 35: 3, 67: 3, 65: 3, 75: 2, 88: 3 }

export function layoutFamilyFor(pilotIndex) {
  return ['hero', 'evidence-map', 'evidence-grid', 'compare', 'grid', 'metrics', 'risk', 'timeline', 'decision'][pilotIndex % 9]
}

function pageKeywords(page) {
  const text = [textOf(page), ...(page.contentBlocks ?? []).map(block => block.content ?? '')].join(' ')
  return ['现状', '边界', '规划', '空间', '生态', '风险', '投资', '资金', '指标', '实施', '决策', '产品', '功能', '交通', '水资源', '征迁', '证据'].filter(keyword => text.includes(keyword))
}

export function selectVisualAssets(page, assetPool, pilotIndex) {
  const family = layoutFamilyFor(pilotIndex)
  const spec = FAMILY_SPECS[family]
  const keywords = pageKeywords(page)
  const topicTerms = PILOT_TOPIC_TERMS[pilotIndex] ?? keywords
  const unique = new Map()
  for (const candidate of assetPool ?? []) {
    if (!candidate?.assetId || unique.has(candidate.assetId)) continue
    const label = `${candidate.displayName ?? ''} ${candidate.name ?? ''} ${candidate.caption ?? ''} ${(candidate.sourceTitles ?? []).join(' ')}`
    const kind = candidate.pilotKind ?? assetKind(candidate)
    const local = candidate.sourcePageId === page.pageId || candidate.sourcePageIds?.includes(page.pageId)
    const kindScore = Math.max(0, spec.kinds.length - spec.kinds.indexOf(kind)) * 18
    const keywordScore = keywords.reduce((sum, keyword) => sum + (label.includes(keyword) ? 13 : 0), 0)
    const topicScore = topicTerms.reduce((sum, keyword) => sum + (label.includes(keyword) ? 30 : 0), 0)
    const score = (local ? 180 : 0) + topicScore + kindScore + keywordScore
    unique.set(candidate.assetId, { candidate, score, local, topicScore, kind })
  }
  const ranked = [...unique.values()].sort((left, right) => right.score - left.score || String(left.candidate.assetId).localeCompare(String(right.candidate.assetId)))
  const topical = ranked.filter(item => item.local || item.topicScore > 0)
  const fallback = ranked.filter(item => !item.local && item.topicScore === 0)
  const requiredKinds = PILOT_REQUIRED_KINDS[pilotIndex] ?? spec.requiredKinds ?? []
  const required = requiredKinds.map(kind => topical.find(item => item.kind === kind) ?? ranked.find(item => item.kind === kind)).filter(Boolean)
  const chosen = [...new Map([...required, ...topical, ...fallback].map(item => [item.candidate.assetId, item])).values()]
  return chosen
    .slice(0, PILOT_MAX_ASSETS[pilotIndex] ?? spec.maxAssets)
    .map(item => item.candidate)
}

async function resizeImage(bytes) {
  const args = ['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=1200:-1:force_original_aspect_ratio=decrease', '-frames:v', '1', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1']
  return await new Promise((resolvePromise, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []; let stderr = ''
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', reject); child.once('close', code => code === 0 && chunks.length ? resolvePromise(Buffer.concat(chunks)) : reject(new Error(stderr.slice(-1200) || 'ffmpeg image resize failed')))
    child.stdin.end(bytes)
  })
}

async function prepareAsset(asset, blobs, previewCache) {
  if (!asset?.objectRef?.sha256 || !asset.objectRef.mimeType?.startsWith('image/')) return null
  const original = blobs.get(asset.objectRef.sha256)
  if (!original) return null
  if (original.length <= MAX_PREVIEW_BYTES && asset.objectRef.mimeType !== 'image/svg+xml') return asset
  const cached = previewCache.get(asset.objectRef.sha256)
  const previewBytes = cached ?? await resizeImage(original)
  previewCache.set(asset.objectRef.sha256, previewBytes)
  const previewSha = sha256(previewBytes)
  blobs.set(previewSha, previewBytes)
  return {
    ...asset,
    objectRef: { ...asset.objectRef, sha256: previewSha, sizeBytes: previewBytes.length, mimeType: 'image/jpeg', originalFileName: `${asset.objectRef.originalFileName ?? asset.assetId}.preview.jpg` },
    widthPx: 1200,
    heightPx: Math.max(1, Math.round((Number(asset.heightPx) || 900) * 1200 / (Number(asset.widthPx) || 1600))),
    previewOfSha256: asset.objectRef.sha256,
  }
}

export function buildPlan(page, index, assets) {
  const title = shorten(textOf(page))
  const layoutFamily = layoutFamilyFor(index)
  const spec = FAMILY_SPECS[layoutFamily]
  const primary = assets[0]
  const kind = assetKind(primary)
  const frames = {
    hero: [{ x: 0, y: 0, width: 1600, height: 900, rotation: 0 }, { x: 1120, y: 76, width: 380, height: 220, rotation: 0 }],
    'evidence-map': [{ x: 660, y: 210, width: 430, height: 540, rotation: 0 }, { x: 1140, y: 210, width: 400, height: 260, rotation: 0 }, { x: 1140, y: 510, width: 400, height: 240, rotation: 0 }],
    'evidence-grid': [{ x: 700, y: 170, width: 400, height: 275, rotation: 0 }, { x: 1140, y: 170, width: 400, height: 275, rotation: 0 }, { x: 700, y: 490, width: 840, height: 275, rotation: 0 }],
    compare: [{ x: 700, y: 170, width: 400, height: 590, rotation: 0 }, { x: 1140, y: 170, width: 400, height: 590, rotation: 0 }],
    grid: [{ x: 700, y: 175, width: 400, height: 270, rotation: 0 }, { x: 1140, y: 175, width: 400, height: 270, rotation: 0 }, { x: 920, y: 490, width: 400, height: 270, rotation: 0 }],
    metrics: [{ x: 700, y: 175, width: 250, height: 585, rotation: 0 }, { x: 995, y: 175, width: 250, height: 585, rotation: 0 }, { x: 1290, y: 175, width: 250, height: 585, rotation: 0 }],
    risk: [{ x: 700, y: 175, width: 450, height: 585, rotation: 0 }, { x: 1190, y: 175, width: 350, height: 275, rotation: 0 }, { x: 1190, y: 485, width: 350, height: 275, rotation: 0 }],
    timeline: [{ x: 680, y: 300, width: 270, height: 460, rotation: 0 }, { x: 980, y: 300, width: 270, height: 460, rotation: 0 }, { x: 1280, y: 300, width: 270, height: 460, rotation: 0 }],
    decision: [{ x: 700, y: 180, width: 250, height: 570, rotation: 0 }, { x: 995, y: 180, width: 250, height: 570, rotation: 0 }, { x: 1290, y: 180, width: 250, height: 570, rotation: 0 }],
  }[layoutFamily]
  const background = layoutFamily === 'hero' ? '#142a2a' : layoutFamily === 'risk' ? '#f3eee8' : '#f4f1eb'
  const foreground = layoutFamily === 'hero' ? '#ffffff' : '#17191d'
  const elements = [
    { layoutElementId: `layout_element_${page.pageId}_bg`, type: 'shape', frame: { x: 0, y: 0, width: 1600, height: 900, rotation: 0 }, style: { fill: background }, zIndex: 0, syncPolicy: 'detached', elementState: 'normal', payload: { shapeKind: 'rectangle', decorative: true } },
    { layoutElementId: `layout_element_${page.pageId}_accent`, type: 'shape', frame: { x: 96, y: 62, width: 12, height: 92, rotation: 0 }, style: { fill: layoutFamily === 'hero' ? '#e5b86a' : '#2f7667', cornerRadius: 6 }, zIndex: 4, syncPolicy: 'detached', elementState: 'normal', payload: { shapeKind: 'rectangle', decorative: true } },
    { layoutElementId: `layout_element_${page.pageId}_title`, type: 'text', frame: { x: 140, y: 62, width: layoutFamily === 'hero' ? 1100 : 500, height: 110, rotation: 0 }, style: { fontSize: layoutFamily === 'hero' ? 42 : 31, fontWeight: 700, textColor: foreground }, zIndex: 10, syncPolicy: 'detached', elementState: 'normal', payload: { content: title, role: 'page_title' } },
    { layoutElementId: `layout_element_${page.pageId}_kicker`, type: 'text', frame: { x: 140, y: 178, width: 520, height: 44, rotation: 0 }, style: { fontSize: 18, fontWeight: 500, textColor: layoutFamily === 'hero' ? '#d6e5df' : '#60736d' }, zIndex: 10, syncPolicy: 'detached', elementState: 'normal', payload: { content: layoutFamily === 'hero' ? '少潭河｜前期策划汇报' : `${String(index + 1).padStart(2, '0')}  /  ${spec.label}`, role: 'section_kicker' } },
  ]
  const pageBody = shorten(page.contentBlocks?.find(block => block.type === 'text')?.content ?? `${spec.label}：将本页结论与可追溯视觉证据放在同一画面中。`, 42)
  if (layoutFamily !== 'hero') {
    elements.push({ layoutElementId: `layout_element_${page.pageId}_conclusion`, type: 'shape', frame: { x: 105, y: 320, width: 505, height: 255, rotation: 0 }, style: { fill: '#ffffff', cornerRadius: 18, opacity: 0.96 }, zIndex: 5, syncPolicy: 'detached', elementState: 'normal', payload: { shapeKind: 'rectangle', decorative: true } })
    elements.push({ layoutElementId: `layout_element_${page.pageId}_conclusion_title`, type: 'text', frame: { x: 140, y: 350, width: 430, height: 58, rotation: 0 }, style: { fontSize: 24, fontWeight: 700, textColor: '#21433e' }, zIndex: 11, syncPolicy: 'detached', elementState: 'normal', payload: { content: `本页判断｜${spec.label}`, role: 'conclusion' } })
    elements.push({ layoutElementId: `layout_element_${page.pageId}_conclusion_body`, type: 'text', frame: { x: 140, y: 425, width: 430, height: 120, rotation: 0 }, style: { fontSize: 21, fontWeight: 500, textColor: '#4e625d' }, zIndex: 11, syncPolicy: 'detached', elementState: 'normal', payload: { content: pageBody, role: 'visual_note' } })
  } else {
    elements.push({ layoutElementId: `layout_element_${page.pageId}_cover_note`, type: 'text', frame: { x: 140, y: 710, width: 720, height: 74, rotation: 0 }, style: { fontSize: 22, fontWeight: 500, textColor: '#d6e5df' }, zIndex: 11, syncPolicy: 'detached', elementState: 'normal', payload: { content: '从现状证据出发，明确首期决策与实施条件', role: 'visual_note' } })
  }
  for (const [assetIndex, asset] of assets.slice(0, frames.length).entries()) {
    const sourceAsset = { kind: 'asset', pageAssetId: asset.pageAssetId, assetId: asset.assetId, caption: asset.caption ?? '', objectRef: { sha256: asset.objectRef.sha256, sizeBytes: asset.objectRef.sizeBytes, mimeType: asset.objectRef.mimeType }, metadata: { widthPx: asset.widthPx, heightPx: asset.heightPx } }
    elements.push({ layoutElementId: `layout_element_${page.pageId}_image_${assetIndex + 1}`, type: 'image', frame: frames[assetIndex], style: { fit: layoutFamily === 'hero' && assetIndex === 0 ? 'cover' : 'contain', cornerRadius: layoutFamily === 'hero' && assetIndex === 0 ? 0 : 18 }, zIndex: 8 + assetIndex, syncPolicy: 'detached', elementState: 'normal', payload: sourceAsset })
  }
  const layout = {
    schemaVersion: 'report-studio.layout.v0.2.0-alpha.1', layoutPageId: `layout_page_${page.pageId}`, projectId: page.projectId,
    pageId: page.pageId, canvas: { width: 1600, height: 900, unit: 'studio_unit' }, baseDraftRevision: 0,
    lastSyncedDraftRevision: 0, syncState: 'synced', elements: elements.map(({ payload, ...element }) => ({ ...element, localPayload: payload })), pilotIndex: index,
  }
  return { layout, renderPlan: { layoutPageId: layout.layoutPageId, projectId: page.projectId, pageId: page.pageId, canvas: layout.canvas, elements }, kind, layoutFamily }
}

async function tilePngs(paths, output) {
  const columns = 4
  const width = 400
  const height = 225
  const streams = paths.map((_, index) => `[${index}:v]scale=${width}:${height}[v${index}]`).join(';')
  const layout = paths.map((_, index) => `${(index % columns) * width}_${Math.floor(index / columns) * height}`).join('|')
  const inputs = paths.map((_, index) => `[v${index}]`).join('')
  await new Promise((resolvePromise, reject) => {
    const child = spawn('ffmpeg', ['-y', ...paths.flatMap(path => ['-i', path]), '-filter_complex', `${streams};${inputs}xstack=inputs=${paths.length}:layout=${layout}:fill=black[out]`, '-map', '[out]', '-frames:v', '1', output], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk) }); child.once('error', reject); child.once('close', code => code === 0 ? resolvePromise() : reject(new Error(stderr.slice(-2000))))
  })
}

export async function verifyShaotanheLayoutPilot({ projectRoot = resolve('.tmp/shaotanhe-e2e-copy'), outputRoot = resolve('.tmp/shaotanhe-e2e-copy/.pilot') } = {}) {
  await mkdir(join(outputRoot, 'layouts'), { recursive: true }); await mkdir(join(outputRoot, 'png'), { recursive: true })
  const blobs = new Map()
  const imported = await readStandardProject(projectRoot, { putBlob: async (stream, meta) => { const bytes = Buffer.concat(await Array.fromAsync(stream)); const sha = sha256(bytes); blobs.set(sha, bytes); return { sha256: sha, sizeBytes: bytes.length, mimeType: meta.mimeType, originalFileName: meta.originalFileName, createdAt: '2026-09-09T00:00:00.000Z' } } })
  const pages = imported.snapshot.pages
  const poolById = new Map()
  for (const sourcePage of pages) for (const pageAsset of sourcePage.pageAssets ?? []) {
    const existing = poolById.get(pageAsset.assetId)
    if (existing) {
      existing.sourcePageIds = [...new Set([...(existing.sourcePageIds ?? []), sourcePage.pageId])]
      existing.sourceTitles = [...new Set([...(existing.sourceTitles ?? []), textOf(sourcePage)])]
    }
    else poolById.set(pageAsset.assetId, { ...pageAsset, sourcePageId: sourcePage.pageId, sourcePageIds: [sourcePage.pageId], sourceTitles: [textOf(sourcePage)], pilotKind: assetKind(pageAsset) })
  }
  const assetPool = [...poolById.values()]
  const selected = pilotIndexes.map(sourceIndex => ({ sourceIndex, page: pages[sourceIndex] })).filter(item => item.page)
  const renderer = createLayoutPreviewRenderer({ browserExecutable: process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE })
  const pagesReport = []; const pngPaths = []
  const previewCache = new Map()
  for (const [index, { sourceIndex, page }] of selected.entries()) {
    const assets = []
    const selectedAssets = selectVisualAssets(page, assetPool, sourceIndex)
    for (const asset of selectedAssets) {
      const prepared = await prepareAsset(asset, blobs, previewCache)
      if (prepared) assets.push({ ...prepared, pageAssetId: `pilot_${page.pageId}_${prepared.assetId}` })
    }
    const { layout, renderPlan, kind, layoutFamily } = buildPlan(page, sourceIndex, assets)
    const bytes = Buffer.from(JSON.stringify(layout))
    const candidateSha = sha256(bytes)
    const layoutPath = join(outputRoot, 'layouts', `${page.pageId}.op`)
    await writeFile(layoutPath, bytes)
    const preview = await renderer.render({ layout: { sourceStateHash: sha256(JSON.stringify(imported.snapshot)) }, renderPlan, pageAssets: assets, candidateSha, readAsset: ref => blobs.get(ref.sha256) })
    const pngPath = join(outputRoot, 'png', `${String(index + 1).padStart(2, '0')}-${page.pageId}.png`)
    await writeFile(pngPath, preview.png); pngPaths.push(pngPath)
    const reopened = JSON.parse(await readFile(layoutPath, 'utf8'))
    const imageElements = renderPlan.elements.filter(element => element.type === 'image')
    const imageArea = imageElements.reduce((sum, element) => sum + element.frame.width * element.frame.height, 0)
    const visualCoverage = Number((imageArea / (renderPlan.canvas.width * renderPlan.canvas.height)).toFixed(3))
    const aiAssetUsed = assets.some(asset => assetKind(asset) === 'ai' && imageElements.some(element => element.payload?.assetId === asset.assetId))
    const diagramAssetUsed = assets.some(asset => assetKind(asset) === 'diagram' && imageElements.some(element => element.payload?.assetId === asset.assetId))
    const blockers = [...preview.checks.blockers]
    if (!imageElements.length) blockers.push({ code: 'visual_asset_missing' })
    if (visualCoverage < 0.2) blockers.push({ code: 'visual_coverage_too_low', visualCoverage })
    const relevanceKeywords = PILOT_TOPIC_TERMS[sourceIndex] ?? pageKeywords(page)
    const relevanceScore = assets.length ? Number((assets.reduce((sum, asset) => sum + relevanceKeywords.filter(keyword => `${asset.displayName ?? ''} ${asset.name ?? ''} ${(asset.sourceTitles ?? []).join(' ')}`.includes(keyword)).length, 0) / assets.length).toFixed(2)) : 0
    pagesReport.push({ pageId: page.pageId, sourceIndex, title: textOf(page), layoutPath, pngPath, layoutSha256: sha256(bytes), reopenedSha256: sha256(Buffer.from(JSON.stringify(reopened))), blockers, layoutFamily, assetIds: assets.map(asset => asset.assetId), assetKinds: assets.map(asset => assetKind(asset)), assetBindings: assets.map(asset => ({ assetId: asset.assetId, sourcePageIds: asset.sourcePageIds ?? [asset.sourcePageId], pageAssetId: asset.pageAssetId })), assetId: assets[0]?.assetId ?? null, assetKind: kind, imageElementCount: imageElements.length, aiAssetUsed, diagramAssetUsed, visualCoverage, relevanceScore, textOnly: imageElements.length === 0 })
  }
  const montagePath = join(outputRoot, 'shaotanhe-12-page-montage.png')
  await tilePngs(pngPaths, montagePath)
  let runtime = null; let runtimeEvidence = null; let runtimeBlocker = null
  try {
    runtime = await resolveDshOpenPencilPackage()
    runtimeEvidence = await runOpenPencilRuntimeSmoke({ runtime })
  } catch (error) { runtimeBlocker = { code: error.code ?? 'layout_engine_unavailable', message: error.message } }
  const report = { status: runtimeBlocker ? 'blocked' : pagesReport.every(page => page.blockers.length === 0 && page.layoutSha256 === page.reopenedSha256 && !page.textOnly) ? 'passed' : 'failed', pageCount: pagesReport.length, visualCoverage: { textOnlyPages: pagesReport.filter(page => page.textOnly).map(page => page.pageId), average: Number((pagesReport.reduce((sum, page) => sum + page.visualCoverage, 0) / Math.max(1, pagesReport.length)).toFixed(3)) }, pages: pagesReport, montagePath, runtime: runtime ? { root: runtime.root, version: runtime.packageVersion, evidence: runtimeEvidence } : null, runtimeBlocker }
  await writeFile(join(outputRoot, 'pilot-report.json'), JSON.stringify(report, null, 2), 'utf8')
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyShaotanheLayoutPilot({ projectRoot: process.argv[2] ? resolve(process.argv[2]) : undefined })
  console.log(JSON.stringify(report, null, 2)); if (report.status !== 'passed') process.exitCode = 2
}
