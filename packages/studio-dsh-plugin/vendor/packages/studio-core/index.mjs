import { createHash } from 'node:crypto';
import {
  ERROR_CODES,
  REVIEW_RUN_INTEGRATION_STATES,
  REVIEW_SUBMISSION_TRANSITIONS,
  StudioError,
  assertCanonicalSnapshot,
  assertStudioApplyCommands,
  assertStudioCommand,
  canonicalFromState,
  createStudioId,
  projectStateFromParts,
} from '../studio-contracts/index.mjs';

const now = () => new Date().toISOString();
const ID_KINDS = Object.freeze({
  project: 'project', projectRules: 'projectRules', outlineDocument: 'outlineDocument', outline: 'outlineNode', page: 'page', draftDocument: 'draftDocument', contentBlock: 'contentBlock', listItem: 'listItem', scriptBlock: 'scriptBlock', pageAsset: 'pageAsset', revision: 'revision',
  annotation: 'annotation', round: 'reviewRound', submission: 'reviewSubmission', reviewRun: 'reviewRun', reviewTask: 'reviewTask', proposal: 'proposal',
});
const id = prefix => createStudioId(ID_KINDS[prefix]);
const clone = value => structuredClone(value);

export const REVIEW_TASK_PHASES = Object.freeze([
  'queued',
  'reading_context',
  'processing',
  'proposal_created',
  'completed',
  'failed',
  'timed_out',
  'conflict',
  'partially_completed',
  'no_changes',
]);

const TERMINAL_REVIEW_TASK_PHASES = new Set(['completed', 'failed', 'timed_out', 'conflict', 'partially_completed', 'no_changes']);

function contentBlock(page, type, role) {
  return page.contentBlocks.find(block => block.type === type && block.role === role) ?? null;
}

function synchronizePageCanonical(page, preferLegacy = false, explicit = new Set()) {
  page.id ??= page.pageId ?? id('page');
  page.pageId ??= page.id;
  page.draftDocumentId ??= id('draftDocument');
  page.contentBlocks ??= [];
  page.scriptBlocks ??= [];
  page.pageAssets ??= [];
  let heading = page.contentBlocks.find(block => block.contentBlockId === page.titleBlockId) ?? contentBlock(page, 'heading', 'page_title');
  if (!heading) {
    heading = { contentBlockId: id('contentBlock'), type: 'heading', role: 'page_title', order: 0, content: page.heading ?? '未命名页面', sourceRefs: [] };
    page.contentBlocks.push(heading);
  }
  page.titleBlockId = heading.contentBlockId;
  if (preferLegacy && explicit.has('heading')) heading.content = page.heading;
  page.heading = heading.content;
  let body = contentBlock(page, 'text', 'body');
  if (page.body || explicit.has('body')) {
    if (!body) {
      body = { contentBlockId: id('contentBlock'), type: 'text', role: 'body', order: page.contentBlocks.length, content: page.body, sourceRefs: [] };
      page.contentBlocks.push(body);
    }
    if (preferLegacy && explicit.has('body')) body.content = page.body;
    page.body = body.content;
  }
  let list = page.contentBlocks.find(block => block.type === 'list') ?? null;
  const bullets = (page.bullets ?? []).filter(value => String(value).trim());
  if (preferLegacy && explicit.has('bullets') && bullets.length) {
    if (!list) {
      list = { contentBlockId: id('contentBlock'), type: 'list', role: 'body', order: page.contentBlocks.length, listStyle: 'unordered', items: [], sourceRefs: [] };
      page.contentBlocks.push(list);
    }
    list.items = bullets.map((value, index) => ({
      ...(list.items?.[index] ?? {}), listItemId: list.items?.[index]?.listItemId ?? id('listItem'), content: String(value), order: index, sourceRefs: clone(list.items?.[index]?.sourceRefs ?? []),
    }));
  }
  if (preferLegacy && explicit.has('script') && !explicit.has('scriptBlocks')) {
    const script = page.scriptBlocks[0] ?? { scriptBlockId: id('scriptBlock'), order: 0, estimatedDurationSeconds: null, sourceRefs: [], referencedContentBlockIds: [heading.contentBlockId], referencedAssetIds: [] };
    if (!page.scriptBlocks.length) page.scriptBlocks.push(script);
    script.content = page.script;
    page.script = script.content;
  }
  if (preferLegacy && explicit.has('assets') && Array.isArray(page.assets)) {
    const preserved = new Map(page.pageAssets.map(link => [link.pageAssetId, link]))
    page.pageAssets = page.assets.map((asset, index) => {
      const { id: legacyId, ...legacy } = clone(asset)
      const prior = preserved.get(asset.pageAssetId) ?? {}
      return {
        ...prior, ...legacy,
        pageAssetId: asset.pageAssetId ?? id('pageAsset'), assetId: asset.assetId ?? legacyId,
        role: asset.role ?? prior.role ?? 'supporting', caption: asset.caption ?? prior.caption ?? '', order: index,
        sourceRefs: clone(asset.sourceRefs ?? prior.sourceRefs ?? []),
      }
    })
  } else if (page.assets?.length && !page.pageAssets.length) {
    page.pageAssets = page.assets.map((asset, index) => {
      const { id: legacyId, ...legacy } = clone(asset)
      return { ...legacy, pageAssetId: asset.pageAssetId ?? id('pageAsset'), assetId: asset.assetId ?? legacyId, role: asset.role ?? 'supporting', caption: asset.caption ?? '', order: index, sourceRefs: clone(asset.sourceRefs ?? []) }
    })
  }
  page.contentBlocks = page.contentBlocks.sort((a, b) => a.order - b.order).map((block, index) => ({ ...block, order: index }));
  page.scriptBlocks = page.scriptBlocks.sort((a, b) => a.order - b.order).map((block, index) => ({ ...block, order: index }));
  page.assets = page.pageAssets.map(link => ({ ...clone(link), id: link.assetId, assetId: link.assetId }));
  page.bullets = (list?.items ?? []).map(item => item.content);
  page.script = page.scriptBlocks.map(block => block.content).join('\n\n');
}

export function createInitialState() {
  const projectId = id('project');
  return {
    schemaVersion: 'report-studio.v0.1.1',
    project: { id: projectId, projectId, projectRulesId: id('projectRules'), outlineDocumentId: id('outlineDocument'), title: '未命名汇报项目', currentRevision: 0, createdAt: now(), updatedAt: now() },
    outline: [], pages: [], annotations: [], reviewRounds: [], reviewSubmissions: [], reviewRuns: [], designRuns: [], layoutCandidates: [], designProtections: [], designBatches: [], proposals: [], revisions: [],
    ui: { stage: 'outline', activePageId: null },
  };
}

function hashState(state) {
  const content = JSON.stringify({ outline: state.outline, pages: state.pages });
  return createHash('sha256').update(content).digest('hex');
}

function commitRevision(state, source, detail) {
  const next = clone(state);
  const number = next.project.currentRevision + 1;
  next.project.currentRevision = number;
  next.project.updatedAt = now();
  next.revisions.push({ id: id('revision'), number, parentRevision: number - 1, source, detail: detail ?? null, stateHash: hashState(next), createdAt: now() });
  return next;
}

function findOutlineNode(nodes, nodeId) {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const found = findOutlineNode(node.children || [], nodeId);
    if (found) return found;
  }
  return null;
}

function findOutlineContainer(nodes, nodeId) {
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].id === nodeId) return { nodes, index: i };
    const found = findOutlineContainer(nodes[i].children || [], nodeId);
    if (found) return found;
  }
  return null;
}

function normalizeOutlineOrder(nodes, parentOutlineNodeId = null) {
  nodes.forEach((node, index) => {
    node.order = index
    node.parentOutlineNodeId = parentOutlineNodeId
    normalizeOutlineOrder(node.children ?? [], node.outlineNodeId)
  })
}

function normalizePageOrder(pages) {
  pages.forEach((page, index) => { page.order = index })
}

function listBlockForPage(page) {
  synchronizePageCanonical(page)
  let list = page.contentBlocks.find(block => block.type === 'list')
  if (!list) {
    list = { contentBlockId: id('contentBlock'), type: 'list', role: 'body', order: page.contentBlocks.length, listStyle: 'unordered', items: [], sourceRefs: [] }
    page.contentBlocks.push(list)
  }
  list.items ??= []
  return list
}

function normalizeListItems(list) {
  list.items = list.items.map((item, index) => ({ ...item, order: index }))
}

function collectOutlineSubtreeIds(node, ids = new Set()) {
  ids.add(node.id);
  for (const child of node.children || []) collectOutlineSubtreeIds(child, ids);
  return ids;
}

function collectOutlineNodeIds(nodes, ids = []) {
  for (const node of nodes ?? []) {
    ids.push(node.id)
    collectOutlineNodeIds(node.children, ids)
  }
  return ids
}

const DEFAULT_COMMANDS = Object.freeze({
  outline: Object.freeze(['project.rename', 'outline.add', 'outline.rename', 'outline.move', 'draft.ensurePage']),
  draft: Object.freeze(['draft.update', 'draft.list.update', 'draft.list.insert', 'draft.list.delete', 'draft.list.move']),
})

const COMMAND_RISK = Object.freeze({
  'project.rename': 'ordinary_reversible',
  'outline.add': 'structural_review_required',
  'outline.rename': 'ordinary_reversible',
  'outline.move': 'structural_review_required',
  'draft.ensurePage': 'structural_review_required',
  'draft.update': 'ordinary_reversible',
  'draft.list.update': 'ordinary_reversible',
  'draft.list.insert': 'structural_review_required',
  'draft.list.delete': 'structural_review_required',
  'draft.list.move': 'structural_review_required',
})

function invalidCommand(message, details = undefined) {
  throw new StudioError(ERROR_CODES.INVALID_COMMAND, message, details, 400)
}

function validTextBoundary(text, offset) {
  return !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]))
}

function annotationContentHash(annotation) {
  return createHash('sha256').update(JSON.stringify([annotation.id, annotation.version, annotation.instruction, annotation.target])).digest('hex')
}

function annotationMatchesSnapshot(annotation, snapshot) {
  if (annotationContentHash(annotation) === snapshot.contentHash) return true
  return !['draft-title', 'draft-text', 'draft-list-item'].includes(annotation.target?.type)
    && createHash('sha256').update(`${annotation.id}:${annotation.version}:${annotation.instruction}`).digest('hex') === snapshot.contentHash
}

function assertTargetSelection(selection, text) {
  if (!selection || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
    || selection.start < 0 || selection.end <= selection.start || selection.end > text.length
    || !validTextBoundary(text, selection.start) || !validTextBoundary(text, selection.end)
    || typeof selection.quote !== 'string' || text.slice(selection.start, selection.end) !== selection.quote) {
    invalidCommand('批注目标选区已变化或无效，请重新选择文字。')
  }
}

function annotationTargetSource(state, scopeKey, target) {
  if (!target || typeof target !== 'object') invalidCommand('批注 target 目标无效。')
  // Older scope annotations stored either the scope key or an object label as id.
  if (target.type === 'scope') return null
  const pageId = scopeKey?.startsWith('draft:') ? scopeKey.slice(6) : null
  const page = pageId ? state.pages.find(row => row.id === pageId) : null
  if (scopeKey !== 'outline:root' && !page) invalidCommand('批注 target 目标不在当前范围内。')
  if (target.type === 'outline-document' && scopeKey === 'outline:root' && [scopeKey, state.project.outlineDocumentId].includes(target.id)) return null
  if (target.type === 'outline-node' && scopeKey === 'outline:root' && findOutlineNode(state.outline, target.id)) return null
  if ((target.type === 'page' || target.type === 'draft-page') && page && target.id === page.id) return null
  // Legacy targets were informational; preserve their page-wide command contract.
  if (target.type === 'content-block' && page?.contentBlocks.some(block => block.contentBlockId === target.id)) return null
  if (!page || target.pageId !== page.id) invalidCommand('批注 target 目标不在当前页面内。')
  let text
  if (target.type === 'draft-title' && target.id === page.titleBlockId && target.blockId === page.titleBlockId) text = page.heading
  else if (target.type === 'draft-text' && target.id === (target.blockId ?? page.id)) {
    const block = contentBlock(page, 'text', 'body')
    if (target.blockId !== (block?.contentBlockId ?? null)) invalidCommand('批注 target 正文目标块无效。')
    text = page.body ?? ''
  } else if (target.type === 'draft-list-item') {
    const block = page.contentBlocks.find(row => row.type === 'list' && row.contentBlockId === target.blockId)
    const item = block?.items.find(row => row.listItemId === target.id)
    if (!item) invalidCommand('批注 target 要点目标不存在。')
    text = item.content
  } else invalidCommand('不支持的批注 target 目标。')
  if (target.selection !== undefined) {
    if (target.type === 'draft-title') invalidCommand('标题批注目标不支持文字选区。')
    assertTargetSelection(target.selection, text)
  }
  return text
}

function assertCommandTargets(state, submission, command) {
  const sources = command.sourceAnnotationIds.map(annotationId => submission.annotationSnapshots.find(row => row.annotationId === annotationId))
  const ranges = []
  let sourceText = null
  let replacement = null
  for (const source of sources) {
    const target = source.target
    const text = annotationTargetSource(state, submission.scopeKey, target)
    if (!['draft-title', 'draft-text', 'draft-list-item'].includes(target.type)) {
      continue
    }
    const matches = command.pageId === target.pageId && (
      target.type === 'draft-title' && command.type === 'draft.update' && Object.keys(command.patch).length === 1 && Object.hasOwn(command.patch, 'heading')
      || target.type === 'draft-text' && command.type === 'draft.update' && Object.keys(command.patch).length === 1 && Object.hasOwn(command.patch, 'body')
      || target.type === 'draft-list-item' && command.type === 'draft.list.update' && command.listItemId === target.id)
    if (!matches) invalidCommand('Command 超出 sourceAnnotationIds 对应的批注 target 目标。', { commandId: command.commandId, annotationId: source.annotationId })
    sourceText = text
    replacement = target.type === 'draft-title' ? command.patch.heading : target.type === 'draft-text' ? command.patch.body : command.content
    if (target.selection) ranges.push(target.selection)
  }
  if (!ranges.length) return
  // A command may combine several selected spans, while retaining every unselected segment.
  const merged = []
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ start: range.start, end: range.end })
  }
  const prefix = sourceText.slice(0, merged[0].start)
  const suffix = sourceText.slice(merged.at(-1).end)
  let cursor = prefix.length
  let unchanged = replacement.startsWith(prefix) && replacement.endsWith(suffix) && replacement.length >= prefix.length + suffix.length
  for (let index = 1; unchanged && index < merged.length; index++) {
    const segment = sourceText.slice(merged[index - 1].end, merged[index].start)
    const found = replacement.indexOf(segment, cursor)
    unchanged = found >= 0 && found + segment.length <= replacement.length - suffix.length
    cursor = found + segment.length
  }
  if (!unchanged) invalidCommand('Command 修改了批注目标选区之外的文字。', { commandId: command.commandId })
}

function scopeFromInput(state, input) {
  const scopeKey = String(input?.scopeKey ?? '').trim()
  if (!scopeKey) invalidCommand('缺少 scopeKey。')
  let scopeStage
  let pageId = null
  if (scopeKey === 'outline:root') scopeStage = 'outline'
  else if (scopeKey.startsWith('draft:')) {
    scopeStage = 'draft'
    pageId = scopeKey.slice('draft:'.length)
    if (!state.pages.some(page => page.id === pageId)) invalidCommand('ReviewSubmission 引用了不存在的页面。', { scopeKey, pageId })
  } else invalidCommand('不支持的 ReviewSubmission scopeKey。', { scopeKey })
  const stage = input?.stage ?? state.ui?.stage ?? scopeStage
  if (stage !== scopeStage) invalidCommand('ReviewSubmission 的 stage 与 scopeKey 不一致。', { stage, scopeKey })
  const requestedPageId = input?.pageId === undefined ? (scopeStage === 'draft' ? state.ui?.activePageId ?? null : null) : input.pageId
  if (requestedPageId !== pageId) invalidCommand('ReviewSubmission 的 pageId 与 scopeKey 不一致。', { pageId: requestedPageId, scopeKey })
  return { scopeKey, stage, pageId }
}

function writableIdsForScope(state, { stage, pageId }) {
  if (stage === 'outline') return [state.project.id, state.project.outlineDocumentId, ...collectOutlineNodeIds(state.outline)].filter(Boolean)
  const page = state.pages.find(item => item.id === pageId)
  if (!page) return []
  return [
    page.id,
    page.pageId,
    page.draftDocumentId,
    ...page.contentBlocks.flatMap(block => [block.contentBlockId, ...(block.items ?? []).map(item => item.listItemId)]),
    ...page.scriptBlocks.map(block => block.scriptBlockId),
    ...page.pageAssets.map(asset => asset.pageAssetId),
  ].filter(Boolean)
}

function commandWritableIds(state, command) {
  switch (command.type) {
    case 'project.rename': return [command.projectId]
    case 'outline.add': return [command.parentId ?? state.project.outlineDocumentId]
    case 'outline.rename':
    case 'outline.move': return [command.nodeId]
    case 'draft.ensurePage': return [command.outlineNodeId]
    case 'draft.update': return [command.pageId]
    case 'draft.list.insert': return [command.pageId, command.afterListItemId].filter(Boolean)
    case 'draft.list.delete':
    case 'draft.list.update':
    case 'draft.list.move': return [command.pageId, command.listItemId]
    default: return []
  }
}

function objectMap(state) {
  const snapshot = canonicalFromState(state)
  const entries = new Map()
  entries.set(snapshot.project.id, clone(snapshot.project))
  const visitOutline = nodes => {
    for (const node of nodes ?? []) {
      const { children = [], ...value } = node
      entries.set(node.id, { ...clone(value), childOutlineNodeIds: children.map(child => child.id) })
      visitOutline(children)
    }
  }
  visitOutline(snapshot.outline)
  for (const page of snapshot.pages) {
    const { contentBlocks = [], scriptBlocks = [], pageAssets = [], ...value } = page
    entries.set(page.id, {
      ...clone(value),
      contentBlockIds: contentBlocks.map(block => block.contentBlockId),
      scriptBlockIds: scriptBlocks.map(block => block.scriptBlockId),
      pageAssetIds: pageAssets.map(asset => asset.pageAssetId),
    })
    for (const block of contentBlocks) {
      const { items = [], ...blockValue } = block
      entries.set(block.contentBlockId, { ...clone(blockValue), listItemIds: items.map(item => item.listItemId) })
      for (const item of items) entries.set(item.listItemId, clone(item))
    }
    for (const script of scriptBlocks) entries.set(script.scriptBlockId, clone(script))
    for (const asset of pageAssets) entries.set(asset.pageAssetId, clone(asset))
  }
  return entries
}

function structuredDiff(beforeState, afterState) {
  const beforeObjects = objectMap(beforeState)
  const afterObjects = objectMap(afterState)
  const ids = [...new Set([...beforeObjects.keys(), ...afterObjects.keys()])].sort()
  const changes = []
  for (const objectId of ids) {
    const before = beforeObjects.get(objectId) ?? null
    const after = afterObjects.get(objectId) ?? null
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    changes.push({
      objectId,
      changeType: before === null ? 'added' : after === null ? 'deleted' : 'modified',
      before: clone(before),
      after: clone(after),
    })
  }
  return {
    before: changes.map(change => ({ objectId: change.objectId, value: clone(change.before) })),
    after: changes.map(change => ({ objectId: change.objectId, value: clone(change.after) })),
    changes,
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function requestHash(input) {
  return createHash('sha256').update(canonicalJson(input)).digest('hex')
}

function applyContentAction(state, action, { commit = true, source = 'human' } = {}) {
  let next = clone(state);
  switch (action.type) {
    case 'project.rename': {
      const title = String(action.title || '').trim();
      if (!title) throw new Error('项目名称不能为空');
      next.project.title = title;
      break;
    }
    case 'outline.add': {
      const title = String(action.title || '新章节').trim() || '新章节';
      const node = { id: action.nodeId ?? id('outline'), outlineNodeId: null, parentOutlineNodeId: action.parentId ?? null, title, order: 0, sourceRefs: [], opaqueExtension: null, children: [], createdAt: now() };
      node.outlineNodeId = node.id;
      if (action.parentId) {
        const parent = findOutlineNode(next.outline, action.parentId);
        if (!parent) throw new Error('未找到父级大纲节点');
        parent.children ??= [];
        node.order = parent.children.length;
        parent.children.push(node);
      } else { node.order = next.outline.length; next.outline.push(node); }
      break;
    }
    case 'outline.rename': {
      const node = findOutlineNode(next.outline, action.nodeId);
      if (!node) throw new Error('未找到大纲节点');
      const title = String(action.title || '').trim();
      if (!title) throw new Error('章节标题不能为空');
      node.title = title;
      break;
    }
    case 'outline.delete': {
      const location = findOutlineContainer(next.outline, action.nodeId);
      if (!location) throw new Error('未找到大纲节点');
      const removedIds = collectOutlineSubtreeIds(location.nodes[location.index]);
      location.nodes.splice(location.index, 1);
      normalizeOutlineOrder(next.outline)
      next.pages = next.pages.filter(page => !removedIds.has(page.outlineNodeId));
      normalizePageOrder(next.pages)
      if (next.ui.activePageId && !next.pages.some(page => page.id === next.ui.activePageId)) next.ui.activePageId = next.pages[0]?.id ?? null;
      break;
    }
    case 'outline.move': {
      const location = findOutlineContainer(next.outline, action.nodeId);
      if (!location) throw new Error('未找到大纲节点');
      const delta = action.direction === 'up' ? -1 : action.direction === 'down' ? 1 : 0;
      const target = location.index + delta;
      if (!delta || target < 0 || target >= location.nodes.length) return state;
      [location.nodes[location.index], location.nodes[target]] = [location.nodes[target], location.nodes[location.index]];
      normalizeOutlineOrder(next.outline)
      break;
    }
    case 'draft.ensurePage': {
      const node = findOutlineNode(next.outline, action.outlineNodeId);
      if (!node) throw new Error('未找到对应大纲节点');
      let page = next.pages.find(item => item.outlineNodeId === action.outlineNodeId);
      if (!page) {
        page = { id: action.pageId ?? id('page'), pageId: null, outlineNodeId: action.outlineNodeId, draftDocumentId: null, titleBlockId: null, order: next.pages.length, heading: node.title, body: '', bullets: [''], script: '', assets: [], createdAt: now(), updatedAt: now() };
        synchronizePageCanonical(page);
        next.pages.push(page);
      }
      next.ui.activePageId = page.id;
      next.ui.stage = 'draft';
      break;
    }
    case 'draft.update': {
      const page = next.pages.find(item => item.id === action.pageId);
      if (!page) throw new Error('未找到草案页面');
      const patch = action.patch || {};
      if ('heading' in patch) page.heading = String(patch.heading ?? '');
      if ('body' in patch) page.body = String(patch.body ?? '');
      if ('script' in patch) page.script = String(patch.script ?? '');
      if ('bullets' in patch) page.bullets = Array.isArray(patch.bullets) ? patch.bullets.map(item => String(item)) : [];
      if ('assets' in patch) page.assets = Array.isArray(patch.assets) ? clone(patch.assets) : [];
      if ('listItems' in patch || 'listBlockId' in patch) {
        const list = page.contentBlocks.find(block => block.contentBlockId === patch.listBlockId)
        if (!list || list.type !== 'list' || !Array.isArray(patch.listItems)) throw new Error('未找到对应列表块')
        const currentIds = new Set(list.items.map(item => item.listItemId))
        if (patch.listItems.some(item => !currentIds.has(item.listItemId))) throw new Error('列表编辑必须引用现有 listItemId')
        list.items = clone(patch.listItems).map((item, index) => ({ ...item, order: index }))
      }
      if (patch.listCreateContent !== undefined) {
        let list = patch.listBlockId
          ? page.contentBlocks.find(block => block.contentBlockId === patch.listBlockId)
          : page.contentBlocks.find(block => block.type === 'list')
        if (!list) {
          list = { contentBlockId: id('contentBlock'), type: 'list', role: 'body', order: page.contentBlocks.length, listStyle: 'unordered', items: [], sourceRefs: [] }
          page.contentBlocks.push(list)
        }
        if (list.type !== 'list') throw new Error('未找到对应列表块')
        list.items ??= []
        list.items.push({ listItemId: id('listItem'), content: String(patch.listCreateContent), order: list.items.length, sourceRefs: [] })
      }
      if ('scriptBlocks' in patch) {
        const currentIds = new Set(page.scriptBlocks.map(block => block.scriptBlockId))
        if (!Array.isArray(patch.scriptBlocks) || patch.scriptBlocks.some(block => !currentIds.has(block.scriptBlockId))) throw new Error('讲解稿编辑必须引用现有 scriptBlockId')
        page.scriptBlocks = clone(patch.scriptBlocks).map((block, index) => ({ ...block, order: index }))
      }
      if ('pageAssets' in patch) {
        const currentIds = new Set(page.pageAssets.map(asset => asset.pageAssetId))
        if (!Array.isArray(patch.pageAssets) || patch.pageAssets.some(asset => !currentIds.has(asset.pageAssetId))) throw new Error('素材编辑必须引用现有 pageAssetId')
        page.pageAssets = clone(patch.pageAssets).map((asset, index) => ({ ...asset, order: index }))
      }
      synchronizePageCanonical(page, true, new Set(Object.keys(patch)));
      page.updatedAt = now();
      break;
    }
    case 'draft.list.update': {
      const page = next.pages.find(item => item.id === action.pageId)
      if (!page) throw new Error('未找到草案页面')
      const list = page.contentBlocks.find(block => block.type === 'list' && block.items.some(item => item.listItemId === action.listItemId))
      const item = list?.items.find(item => item.listItemId === action.listItemId)
      if (!item) throw new Error('未找到列表项')
      item.content = String(action.content ?? '')
      synchronizePageCanonical(page)
      page.updatedAt = now()
      break
    }
    case 'draft.list.insert': {
      const page = next.pages.find(item => item.id === action.pageId)
      if (!page) throw new Error('未找到草案页面')
      const list = listBlockForPage(page)
      const afterIndex = action.afterListItemId == null ? -1 : list.items.findIndex(item => item.listItemId === action.afterListItemId)
      if (afterIndex < -1) throw new Error('未找到列表项')
      if (action.afterListItemId != null && afterIndex < 0) throw new Error('未找到列表项')
      list.items.splice(afterIndex + 1, 0, { listItemId: action.listItemId ?? id('listItem'), content: String(action.content ?? ''), order: 0, sourceRefs: [] })
      normalizeListItems(list)
      page.bullets = list.items.map(item => item.content)
      synchronizePageCanonical(page)
      page.updatedAt = now()
      break
    }
    case 'draft.list.delete': {
      const page = next.pages.find(item => item.id === action.pageId)
      if (!page) throw new Error('未找到草案页面')
      const list = listBlockForPage(page)
      const itemIndex = list.items.findIndex(item => item.listItemId === action.listItemId)
      if (itemIndex < 0) throw new Error('未找到列表项')
      list.items.splice(itemIndex, 1)
      normalizeListItems(list)
      page.bullets = list.items.map(item => item.content)
      synchronizePageCanonical(page)
      page.updatedAt = now()
      break
    }
    case 'draft.list.move': {
      const page = next.pages.find(item => item.id === action.pageId)
      if (!page) throw new Error('未找到草案页面')
      const list = listBlockForPage(page)
      const itemIndex = list.items.findIndex(item => item.listItemId === action.listItemId)
      if (itemIndex < 0) throw new Error('未找到列表项')
      const targetIndex = action.direction === 'up' ? itemIndex - 1 : action.direction === 'down' ? itemIndex + 1 : itemIndex
      if (targetIndex < 0 || targetIndex >= list.items.length || targetIndex === itemIndex) return state
      ;[list.items[itemIndex], list.items[targetIndex]] = [list.items[targetIndex], list.items[itemIndex]]
      normalizeListItems(list)
      page.bullets = list.items.map(item => item.content)
      synchronizePageCanonical(page)
      page.updatedAt = now()
      break
    }
    default: throw new Error(`不支持的内容操作：${action.type}`);
  }
  return commit ? commitRevision(next, source, { actionType: action.type }) : next;
}

export function executeAction(state, action) {
  if (!action || typeof action.type !== 'string') throw new Error('缺少 action.type');
  if (action.type.startsWith('outline.') || action.type.startsWith('draft.') || action.type === 'project.rename') return { state: applyContentAction(state, action) };
  const next = clone(state);
  switch (action.type) {
    case 'ui.setStage':
      if (!['outline', 'draft', 'layout'].includes(action.stage)) throw new Error('无效阶段');
      next.ui.stage = action.stage; return { state: next };
    case 'ui.setPage':
      if (action.pageId && !next.pages.some(page => page.id === action.pageId)) throw new Error('未找到页面');
      next.ui.activePageId = action.pageId ?? null; return { state: next };
    case 'annotation.add': {
      const instruction = String(action.instruction || '').trim();
      if (!instruction) throw new Error('批注不能为空');
      annotationTargetSource(next, action.scopeKey, action.target || { type: 'scope', id: action.scopeKey })
      const annotation = { id: id('annotation'), scopeKey: action.scopeKey, reviewRoundId: action.reviewRoundId ?? null, target: clone(action.target || { type: 'scope', id: action.scopeKey, label: action.scopeKey }), instruction, lifecycle: 'draft', resolution: 'open', version: 1, createdAgainstRevision: next.project.currentRevision, createdAt: now(), updatedAt: now() };
      next.annotations.push(annotation); return { state: next, annotation };
    }
    case 'annotation.update': {
      const annotation = next.annotations.find(item => item.id === action.annotationId);
      if (!annotation) throw new Error('未找到批注');
      if (annotation.resolution === 'resolved' && action.instruction) throw new Error('已完成批注需先重新打开');
      if (action.instruction !== undefined) {
        const instruction = String(action.instruction).trim(); if (!instruction) throw new Error('批注不能为空');
        annotation.instruction = instruction; annotation.version += 1;
      }
      if (action.resolution !== undefined) {
        if (!['open', 'resolved'].includes(action.resolution)) throw new Error('无效完成状态');
        annotation.resolution = action.resolution;
      }
      annotation.updatedAt = now(); return { state: next, annotation };
    }
    default: throw new Error(`不支持的操作：${action.type}`);
  }
}

export function submitReviewRound(state, input) {
  const next = clone(state);
  if (input?.projectId !== undefined && input.projectId !== next.project.id) invalidCommand('ReviewSubmission 的 projectId 与当前项目不一致。', { projectId: input.projectId })
  const scope = scopeFromInput(next, input)
  const { scopeKey, stage, pageId } = scope
  let round = input.reviewRoundId ? next.reviewRounds.find(item => item.id === input.reviewRoundId) : null;
  if (input.reviewRoundId && !round) invalidCommand('未找到批注轮次。', { reviewRoundId: input.reviewRoundId })
  if (round) {
    const roundStage = round.stage ?? (round.scopeKey?.startsWith('draft:') ? 'draft' : 'outline')
    const roundPageId = round.pageId ?? (roundStage === 'draft' ? round.scopeKey.slice('draft:'.length) : null)
    if (round.status !== 'open') invalidCommand('仅 open 的 ReviewRound 可以继续提交。', { reviewRoundId: round.id, status: round.status })
    if (round.projectId !== undefined && round.projectId !== next.project.id) invalidCommand('ReviewRound 属于其他项目。', { reviewRoundId: round.id })
    if (round.scopeKey !== scopeKey || roundStage !== stage || roundPageId !== pageId) {
      invalidCommand('ReviewRound 的 scope、stage 或 page 不匹配。', {
        reviewRoundId: round.id,
        expected: { scopeKey: round.scopeKey, stage: roundStage, pageId: roundPageId },
        received: { scopeKey, stage, pageId },
      })
    }
  }
  if (!round) {
    round = { id: id('round'), projectId: next.project.id, scopeKey, stage, pageId, status: 'open', createdAt: now(), updatedAt: now() }
    next.reviewRounds.push(round)
  }
  if (input.annotationIds !== undefined && (!Array.isArray(input.annotationIds) || !input.annotationIds.length
    || input.annotationIds.some(id => typeof id !== 'string' || !next.annotations.some(a => a.id === id && a.scopeKey === scopeKey))
    || new Set(input.annotationIds).size !== input.annotationIds.length)) invalidCommand('批注筛选必须是当前范围内唯一的批注 ID。')
  const selectedAnnotationIds = input.annotationIds === undefined ? null : new Set(input.annotationIds)
  const candidates = next.annotations.filter(annotation => (!selectedAnnotationIds || selectedAnnotationIds.has(annotation.id)) && annotation.scopeKey === scopeKey && annotation.resolution === 'open' && annotation.lifecycle === 'draft' && (annotation.reviewRoundId === null || annotation.reviewRoundId === round.id));
  if (!candidates.length) throw new Error('当前轮次没有待提交批注');
  const previousCount = next.reviewSubmissions.filter(item => item.reviewRoundId === round.id).length;
  const submissionId = id('submission');
  const annotationSnapshots = candidates.map(annotation => ({
    annotationId: annotation.id,
    id: annotation.id,
    annotationVersion: annotation.version,
    version: annotation.version,
    target: clone(annotation.target),
    instruction: annotation.instruction,
    contentHash: annotationContentHash(annotation),
  }))
  for (const annotation of annotationSnapshots) annotationTargetSource(next, scopeKey, annotation.target)
  const allowedCommands = clone(DEFAULT_COMMANDS[stage] ?? [])
  const writableIds = [...new Set(writableIdsForScope(next, scope))]
  const createdAt = now()
  const submission = {
    id: submissionId,
    reviewSubmissionId: submissionId,
    reviewRoundId: round.id,
    number: previousCount + 1,
    submissionNumber: previousCount + 1,
    projectId: next.project.id,
    stage,
    scopeKey,
    pageId,
    baseRevision: next.project.currentRevision,
    annotationSnapshots,
    annotations: clone(annotationSnapshots),
    allowedCommands,
    writableIds,
    status: 'pending_dispatch',
    idempotencyKey: `review:${submissionId}`,
    dispatchAttempts: 0,
    lastDispatchError: null,
    createdAt,
    agentMessage: null,
  };
  for (const annotation of candidates) { annotation.lifecycle = 'submitted'; annotation.reviewRoundId = round.id; }
  next.reviewSubmissions.push(submission); round.updatedAt = now();
  return { state: next, round: clone(round), submission: clone(submission) };
}

export function createProposalFromAgent(state, submissionId, result) {
  const commands = Array.isArray(result?.commands) ? result.commands : []
  if (!commands.length) invalidCommand('commands 必须至少包含一条结构化修改命令。')
  for (const command of commands) assertStudioCommand(command)
  const input = assertStudioApplyCommands(result)
  if (input.projectId !== state.project.id) invalidCommand('ChangeSet 的 projectId 与当前项目不一致。', { projectId: input.projectId })
  if (input.baseRevision !== state.project.currentRevision) {
    throw new StudioError(ERROR_CODES.STALE_REVIEW_SUBMISSION, 'ChangeSet 的 baseRevision 已过期。', { baseRevision: input.baseRevision, currentRevision: state.project.currentRevision }, 409)
  }
  const next = clone(state);
  const submission = next.reviewSubmissions.find(item => item.id === submissionId);
  if (!submission || input.submissionId !== submissionId || submission.reviewSubmissionId !== submissionId) invalidCommand('未找到匹配的 ReviewSubmission。', { submissionId })
  if (submission.projectId !== input.projectId) invalidCommand('ReviewSubmission 的 projectId 不匹配。', { submissionId })
  if (submission.baseRevision !== input.baseRevision) {
    throw new StudioError(ERROR_CODES.STALE_REVIEW_SUBMISSION, 'ReviewSubmission 的 baseRevision 不匹配。', { submissionId, baseRevision: submission.baseRevision }, 409)
  }
  if (input.scopeKey !== submission.scopeKey || input.commands.some(command => command.scopeKey !== submission.scopeKey || command.baseRevision !== submission.baseRevision)) {
    invalidCommand('Command 超出 ReviewSubmission 的冻结 scope 或 revision。', { submissionId, scopeKey: submission.scopeKey })
  }
  const allowedCommands = new Set(submission.allowedCommands ?? [])
  for (const command of input.commands) if (!allowedCommands.has(command.type)) invalidCommand('Command 不在 ReviewSubmission.allowedCommands 中。', { commandId: command.commandId, type: command.type })
  const writableIds = new Set(submission.writableIds ?? [])
  for (const command of input.commands) {
    const forbiddenIds = commandWritableIds(next, command).filter(value => !writableIds.has(value))
    if (forbiddenIds.length) invalidCommand('Command 引用了 ReviewSubmission.writableIds 之外的对象。', { commandId: command.commandId, forbiddenIds })
  }
  const annotationIds = new Set((submission.annotationSnapshots ?? []).map(annotation => annotation.annotationId))
  const fieldWrites = new Set()
  for (const command of input.commands) {
    const fieldKey = command.type === 'draft.update' ? `${command.pageId}:${Object.keys(command.patch)[0]}` : command.type === 'draft.list.update' ? `${command.pageId}:item:${command.listItemId}` : null
    if (fieldKey && fieldWrites.has(fieldKey)) invalidCommand('同一字段或要点不能重复覆盖，请合并为一条命令并引用所有对应批注。', { commandId: command.commandId })
    if (fieldKey) fieldWrites.add(fieldKey)
    if (command.sourceAnnotationIds.some(annotationId => !annotationIds.has(annotationId))) invalidCommand('Command 引用了本次 Submission 之外的批注。', { commandId: command.commandId })
    assertCommandTargets(next, submission, command)
    if (COMMAND_RISK[command.type] !== command.riskLevel) invalidCommand('Command riskLevel 与实际操作风险不一致。', { commandId: command.commandId, expected: COMMAND_RISK[command.type], received: command.riskLevel })
    if (command.riskLevel === 'protected_or_deferred') invalidCommand('受保护或暂缓操作不能进入普通批注任务。', { commandId: command.commandId })
  }
  const idempotencyKey = String(input.idempotencyKey || submission.idempotencyKey || `review:${submission.id}`);
  const inputHash = requestHash({ ...input, idempotencyKey })
  const existing = next.proposals.find(item => item.submissionId === submissionId);
  if (existing) {
    if (existing.idempotencyKey !== idempotencyKey || existing.inputHash !== inputHash) throw new StudioError(ERROR_CODES.PROPOSAL_ALREADY_EXISTS, '该 ReviewSubmission 已存在不同的 Proposal。', { proposalId: existing.id }, 409);
    return { state: next, proposal: clone(existing), reused: true };
  }
  let candidate = clone(next)
  for (const command of input.commands) candidate = applyContentAction(candidate, command, { commit: false, source: 'agent' })
  assertCanonicalSnapshot(canonicalFromState(candidate))
  const diff = structuredDiff(next, candidate)
  if (!diff.changes.length) invalidCommand('ChangeSet 未产生可确认的 Canonical 差异。')
  const riskOrder = ['ordinary_reversible', 'structural_review_required', 'protected_or_deferred']
  const aggregateRiskLevel = input.commands.reduce((highest, command) => riskOrder.indexOf(command.riskLevel) > riskOrder.indexOf(highest) ? command.riskLevel : highest, 'ordinary_reversible')
  const sourceAnnotationIds = [...new Set(input.commands.flatMap(command => command.sourceAnnotationIds))].sort()
  const affectedObjectIds = diff.changes.map(change => change.objectId).sort()
  const hasDeletion = diff.changes.some(change => change.changeType === 'deleted')
  const proposal = {
    id: id('proposal'),
    submissionId,
    reviewRoundId: submission.reviewRoundId,
    projectId: submission.projectId,
    scopeKey: submission.scopeKey,
    baseRevision: submission.baseRevision,
    idempotencyKey,
    inputHash,
    message: input.message,
    commands: clone(input.commands),
    candidateSnapshot: canonicalFromState(candidate),
    affectedObjectIds,
    diff,
    aggregateRiskLevel,
    hasDeletion,
    sourceAnnotationIds,
    status: 'pending',
    createdAt: now(),
  };
  const transitioned = transitionReviewSubmission(next, submissionId, 'proposal_created', { resultProposalId: proposal.id })
  const transitionedSubmission = transitioned.state.reviewSubmissions.find(item => item.id === submissionId)
  transitionedSubmission.agentMessage = proposal.message
  transitioned.state.proposals.push(proposal)
  return { state: transitioned.state, proposal: clone(proposal) };
}

function submissionTransitionError(submissionId, from, to) {
  return new StudioError(
    ERROR_CODES.INVALID_SUBMISSION_TRANSITION,
    `ReviewSubmission 不允许从 ${from} 迁移到 ${to}。`,
    { submissionId, from, to },
    409,
  )
}

function submissionOf(state, submissionId) {
  const submission = state.reviewSubmissions.find(item => item.id === submissionId)
  if (!submission) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到 ReviewSubmission', { submissionId }, 404)
  return submission
}

function latestReviewRun(state, submissionId) {
  return (state.reviewRuns ?? [])
    .filter(run => run.reviewSubmissionId === submissionId)
    .sort((left, right) => Number(right.dispatchAttempt) - Number(left.dispatchAttempt))[0] ?? null
}

export function beginReviewDispatch(state, submissionId, {
  sessionId,
  at = now(),
  leaseMs = 120_000,
} = {}) {
  const next = clone(state)
  next.reviewRuns ??= []
  const submission = submissionOf(next, submissionId)
  if (submission.status !== 'pending_dispatch') throw submissionTransitionError(submissionId, submission.status, 'pending_dispatch')
  const existing = latestReviewRun(next, submissionId)
  if (existing?.integrationState === 'pending_dispatch') {
    return { state: next, submission: clone(submission), reviewRun: clone(existing), idempotent: true }
  }
  const cleanSessionId = String(sessionId ?? '').trim()
  if (!cleanSessionId) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '开始投递必须绑定 sessionId。', { submissionId }, 400)
  const dispatchAttempt = Math.max(Number(submission.dispatchAttempts || 0), Number(existing?.dispatchAttempt || 0)) + 1
  const createdAt = String(at)
  const leaseExpiresAt = new Date(new Date(createdAt).getTime() + Number(leaseMs)).toISOString()
  const reviewRunId = id('reviewRun')
  const reviewRun = {
    id: reviewRunId,
    reviewRunId,
    reviewSubmissionId: submissionId,
    sessionId: cleanSessionId,
    dispatchAttempt,
    integrationState: 'pending_dispatch',
    createdAt,
    deliveredAt: null,
    resultProposalId: null,
    lastError: null,
    leaseExpiresAt,
    taskId: id('reviewTask'),
    parentSessionId: cleanSessionId,
    workerSessionRef: null,
    phase: 'queued',
    summary: null,
    finishedAt: null,
    closedAt: null,
  }
  submission.dispatchAttempts = dispatchAttempt
  submission.activeReviewRunId = reviewRunId
  submission.lastDispatchAt = createdAt
  submission.lastDispatchError = null
  next.reviewRuns.push(reviewRun)
  return { state: next, submission: clone(submission), reviewRun: clone(reviewRun), idempotent: false }
}

export function updateReviewTask(state, reviewRunId, {
  phase,
  workerSessionRef,
  summary,
  finishedAt,
  closedAt,
  at = now(),
} = {}) {
  const next = clone(state)
  const run = (next.reviewRuns ?? []).find(item => item.reviewRunId === reviewRunId)
  if (!run) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, '未找到 ReviewRun。', { reviewRunId }, 404)
  if (phase !== undefined) {
    const cleanPhase = String(phase)
    if (!REVIEW_TASK_PHASES.includes(cleanPhase)) throw new StudioError(ERROR_CODES.INVALID_COMMAND, '无效的 ReviewTask 阶段。', { phase: cleanPhase }, 400)
    run.phase = cleanPhase
    if (TERMINAL_REVIEW_TASK_PHASES.has(cleanPhase)) {
      run.finishedAt ??= String(finishedAt ?? at)
      if (closedAt === undefined) run.closedAt ??= String(at)
    }
  }
  if (workerSessionRef !== undefined) run.workerSessionRef = workerSessionRef == null ? null : String(workerSessionRef)
  if (summary !== undefined) run.summary = summary == null ? null : String(summary)
  if (finishedAt !== undefined) run.finishedAt = finishedAt == null ? null : String(finishedAt)
  if (closedAt !== undefined) run.closedAt = closedAt == null ? null : String(closedAt)
  return { state: next, reviewRun: clone(run) }
}

export function transitionReviewSubmission(state, submissionId, to, {
  reviewRunId = null,
  resultProposalId = null,
  error = null,
  sessionId = null,
  at = now(),
} = {}) {
  if (!REVIEW_RUN_INTEGRATION_STATES.includes(to)) throw submissionTransitionError(submissionId, 'unknown', to)
  const next = clone(state)
  next.reviewRuns ??= []
  const submission = submissionOf(next, submissionId)
  const from = submission.status
  if (from === 'dispatched' && to === 'dispatched') {
    const run = latestReviewRun(next, submissionId)
    if (reviewRunId && run?.reviewRunId !== reviewRunId) throw submissionTransitionError(submissionId, from, to)
    return { state: next, submission: clone(submission), reviewRun: clone(run), idempotent: true }
  }
  if (!(REVIEW_SUBMISSION_TRANSITIONS[from] ?? []).includes(to)) throw submissionTransitionError(submissionId, from, to)
  let run = null
  if (!(['dispatch_failed', 'apply_failed', 'conflict'].includes(from) && to === 'pending_dispatch')) {
    run = reviewRunId
      ? next.reviewRuns.find(item => item.reviewRunId === reviewRunId && item.reviewSubmissionId === submissionId)
      : next.reviewRuns.find(item => item.reviewRunId === submission.activeReviewRunId) ?? latestReviewRun(next, submissionId)
    if (!run || run.integrationState !== from) throw submissionTransitionError(submissionId, from, to)
  }
  submission.status = to
  submission.lastDispatchAt = String(at)
  if (run && String(sessionId ?? '').trim()) run.sessionId = String(sessionId).trim()
  if (['dispatch_failed', 'apply_failed', 'conflict'].includes(to)) {
    const message = String(error || '投递失败')
    submission.lastDispatchError = message
    run.lastError = message
  } else submission.lastDispatchError = null
  if (to === 'pending_dispatch') submission.activeReviewRunId = null
  else {
    run.integrationState = to
    if (to === 'dispatched') run.deliveredAt = String(at)
    if (to === 'proposal_created') {
      if (!resultProposalId) throw new StudioError(ERROR_CODES.INVALID_REFERENCE, 'Proposal 迁移必须提供 resultProposalId。', { submissionId }, 400)
      run.resultProposalId = resultProposalId
    }
  }
  return { state: next, submission: clone(submission), reviewRun: clone(run), idempotent: false }
}

export function recoverExpiredReviewDispatches(state, { at = now() } = {}) {
  let next = clone(state)
  const deadline = new Date(at).getTime()
  const recoveredReviewRunIds = []
  for (const run of next.reviewRuns ?? []) {
    if (!['pending_dispatch', 'dispatched'].includes(run.integrationState) || !run.leaseExpiresAt || new Date(run.leaseExpiresAt).getTime() > deadline) continue
    const submission = next.reviewSubmissions.find(item => item.id === run.reviewSubmissionId)
    if (!submission || submission.status !== run.integrationState || submission.activeReviewRunId !== run.reviewRunId) continue
    if (run.integrationState === 'dispatched') {
      next = markReviewApplicationFailure(next, submission.id, { reviewRunId: run.reviewRunId,
        error: new Error('修改执行中断或等待超时，可重新读取当前版本后继续。'), at: String(at) }).state
      recoveredReviewRunIds.push(run.reviewRunId)
      continue
    }
    next = transitionReviewSubmission(next, submission.id, 'dispatch_failed', {
      reviewRunId: run.reviewRunId,
      error: '投递等待超时，可继续投递。',
      at,
    }).state
    recoveredReviewRunIds.push(run.reviewRunId)
  }
  return { state: next, recoveredReviewRunIds }
}

export function markSubmissionDispatch(state, submissionId, { status, error = null, reviewRunId = null, sessionId = 'legacy-bridge', at = now() } = {}) {
  if (!['dispatched', 'dispatch_failed'].includes(status)) throw submissionTransitionError(submissionId, submissionOf(state, submissionId).status, status)
  let prepared = { state, reviewRun: null }
  const submission = submissionOf(state, submissionId)
  if (submission.status === 'pending_dispatch' && !latestReviewRun(state, submissionId)) prepared = beginReviewDispatch(state, submissionId, { sessionId, at })
  return transitionReviewSubmission(prepared.state, submissionId, status, { error, reviewRunId: reviewRunId ?? prepared.reviewRun?.reviewRunId, sessionId, at })
}

export function retryReviewSubmission(state, submissionId, { sessionId = 'legacy-bridge', at = now(), leaseMs = 120_000 } = {}) {
  const pending = transitionReviewSubmission(state, submissionId, 'pending_dispatch', { at })
  return beginReviewDispatch(pending.state, submissionId, { sessionId, at, leaseMs })
}

export function acceptProposal(state, proposalId) {
  const proposal = state.proposals.find(item => item.id === proposalId);
  if (!proposal) throw new Error('未找到 Proposal');
  if (proposal.kind === 'layout') throw new StudioError('design_accept_required', '布局 Proposal 必须通过宿主设计服务接受。', undefined, 409)
  if (proposal.status !== 'pending') throw new Error('Proposal 已处理');
  if (state.project.currentRevision !== proposal.baseRevision) throw new Error('stale_revision');
  let next
  if (proposal.candidateSnapshot) {
    assertCanonicalSnapshot(proposal.candidateSnapshot)
    next = projectStateFromParts({
      snapshot: proposal.candidateSnapshot,
      currentRevision: state.project.currentRevision,
      operational: state,
      ui: state.ui,
    })
  } else {
    next = clone(state)
    for (const command of proposal.commands) next = applyContentAction(next, command, { commit: false, source: 'agent' })
  }
  next = commitRevision(next, 'agent', { proposalId, submissionId: proposal.submissionId });
  const stored = next.proposals.find(item => item.id === proposalId);
  stored.status = 'accepted'; stored.acceptedRevision = next.project.currentRevision; stored.acceptedAt = now();
  const transitioned = transitionReviewSubmission(next, stored.submissionId, 'accepted', { resultProposalId: stored.id })
  const closed = closeReviewTasksForSubmission(transitioned.state, stored.submissionId, '本轮批注已接受')
  return { state: closed, revision: clone(closed.revisions.at(-1)) };
}

function closeReviewTasksForSubmission(state, submissionId, summary) {
  const next = clone(state)
  const at = now()
  for (const run of next.reviewRuns ?? []) {
    if (run.reviewSubmissionId !== submissionId || run.closedAt) continue
    run.phase = 'completed'
    run.summary = String(summary)
    run.finishedAt ??= at
    run.closedAt = at
  }
  return next
}

// New edits commit immediately; legacy Proposal helpers are only transient validators.
function recordAnnotationResults(state, submissionId, result, appliedRevision) {
  const submission = submissionOf(state, submissionId)
  const snapshots = new Map(submission.annotationSnapshots.map(row => [row.annotationId, row]))
  const commands = new Map((result.commands ?? []).map(row => [row.commandId, row]))
  const explicit = new Map()
  for (const row of result.annotationResults ?? []) {
    const snapshot = snapshots.get(row.annotationId)
    if (!snapshot || explicit.has(row.annotationId) || row.annotationVersion !== snapshot.annotationVersion
      || row.commandIds.some(id => !commands.get(id)?.sourceAnnotationIds.includes(row.annotationId))
      || (row.status === 'completed' && !row.commandIds.length)) invalidCommand('批注处理结果必须引用本轮版本及实际落地命令。')
    explicit.set(row.annotationId, row)
  }
  submission.annotationResults = [...snapshots.values()].map(snapshot => {
    const annotation = state.annotations.find(row => row.id === snapshot.annotationId)
    const commandIds = [...commands.values()].filter(row => row.sourceAnnotationIds.includes(snapshot.annotationId)).map(row => row.commandId)
    const supplied = explicit.get(snapshot.annotationId)
    const unchanged = annotation && annotation.version === snapshot.annotationVersion
      && annotation.instruction === snapshot.instruction
      && annotationMatchesSnapshot(annotation, snapshot)
    const status = !unchanged ? 'superseded' : supplied?.status ?? (commandIds.length ? 'completed' : 'unresolved')
    const reason = !unchanged ? '批注提交后已变更，旧结果不关闭新要求。'
      : supplied?.reason ?? (commandIds.length ? result.message : '本次没有执行覆盖此批注的命令。')
    if (annotation) {
      const submissionIndex = state.reviewSubmissions.findIndex(row => row.id === submissionId)
      const inNewerSubmission = state.reviewSubmissions.slice(submissionIndex + 1).some(row =>
        row.annotationSnapshots?.some(item => item.annotationId === annotation.id && item.annotationVersion === annotation.version))
      if (!inNewerSubmission && status === 'completed') annotation.resolution = 'resolved'
      if (!inNewerSubmission && status !== 'completed' && annotation.resolution === 'open') annotation.lifecycle = 'draft'
      annotation.updatedAt = now()
    }
    return { annotationId: snapshot.annotationId, annotationVersion: snapshot.annotationVersion,
      status, reason, commandIds: supplied?.commandIds ?? commandIds, appliedRevision }
  })
  submission.completionStatus = submission.annotationResults.every(row => row.status === 'completed') ? 'completed'
    : (result.commands?.length ? 'partially_completed' : 'no_changes')
  return submission
}

export function applyCommandsFromAgent(state, submissionId, result) {
  const input = assertStudioApplyCommands(result)
  const applicationHash = requestHash(input)
  const existingSubmission = state.reviewSubmissions.find(item => item.id === submissionId)
  if (['accepted', 'no_changes'].includes(existingSubmission?.status)) {
    if (input.submissionId !== submissionId || input.projectId !== state.project.id || existingSubmission.applicationHash !== applicationHash)
      invalidCommand('已完成请求的参数或指纹不同，不能复用成功结果。')
    const revision = state.revisions.find(item => item.number === existingSubmission.appliedRevision)
    return { state: clone(state), revision: clone(revision), summary: existingSubmission.agentMessage, completionStatus: existingSubmission.completionStatus, reused: true }
  }
  if (!input.commands.length) {
    if (!existingSubmission || input.submissionId !== submissionId || input.projectId !== state.project.id
      || existingSubmission.projectId !== input.projectId || existingSubmission.scopeKey !== input.scopeKey)
      invalidCommand('无修改结果也必须匹配当前项目与冻结任务范围。')
    if (input.baseRevision !== state.project.currentRevision || input.baseRevision !== existingSubmission.baseRevision)
      throw new StudioError(ERROR_CODES.STALE_REVIEW_SUBMISSION, '无修改结果的基线已经过期。', undefined, 409)
    const next = completeReviewWithoutChanges(state, submissionId, input.message).state
    const submission = recordAnnotationResults(next, submissionId, input, null)
    submission.applicationHash = applicationHash
    return { state: next, revision: null, summary: input.message, completionStatus: 'no_changes' }
  }
  const proposed = createProposalFromAgent(state, submissionId, input)
  const accepted = acceptProposal(proposed.state, proposed.proposal.id)
  const next = clone(accepted.state)
  next.proposals = next.proposals.filter(item => item.id !== proposed.proposal.id)
  const submission = recordAnnotationResults(next, submissionId, input, next.project.currentRevision)
  submission.applicationHash = applicationHash
  submission.appliedRevision = next.project.currentRevision
  for (const run of next.reviewRuns ?? []) {
    if (run.reviewSubmissionId !== submissionId) continue
    run.resultProposalId = null
    run.phase = submission.completionStatus
  }
  const revision = next.revisions.at(-1)
  if (revision) revision.detail = { ...(revision.detail ?? {}), submissionId,
    summary: String(input.message), commandCount: input.commands.length, applicationHash,
    annotationResults: clone(submission.annotationResults) }
  return { state: next, revision: clone(revision), summary: String(input.message), completionStatus: submission.completionStatus }
}

export function completeReviewWithoutChanges(state, submissionId, message) {
  const next = transitionReviewSubmission(state, submissionId, 'no_changes').state
  recordAnnotationResults(next, submissionId, { commands: [], message }, null)
  const submission = submissionOf(next, submissionId)
  submission.agentMessage = String(message || '本轮未执行修改，批注保持未完成。')
  return { state: updateReviewTask(next, submission.activeReviewRunId, { phase: 'no_changes', summary: submission.agentMessage }).state }
}

export function markReviewApplicationFailure(state, submissionId, { reviewRunId = null, error, at = now() } = {}) {
  const submission = submissionOf(state, submissionId)
  if (!['pending_dispatch', 'dispatched'].includes(submission.status)
    || (reviewRunId && submission.activeReviewRunId !== reviewRunId)) return { state: clone(state) }
  const conflicted = submission.baseRevision !== state.project.currentRevision
    || ['stale_revision', 'stale_review_submission'].includes(error?.code)
  const status = conflicted ? 'conflict' : submission.status === 'pending_dispatch' ? 'dispatch_failed' : 'apply_failed'
  let prepared = state
  if (status === 'conflict' && submission.status === 'pending_dispatch') {
    prepared = transitionReviewSubmission(prepared, submissionId, 'dispatched', {
      reviewRunId: submission.activeReviewRunId, sessionId: submission.activeReviewRunId, at,
    }).state
  }
  const next = transitionReviewSubmission(prepared, submissionId, status, { reviewRunId: submission.activeReviewRunId,
    error: String(error?.message || error || '修改执行失败，可重试。'), at }).state
  return { state: updateReviewTask(next, submission.activeReviewRunId, {
    phase: status === 'conflict' ? 'conflict' : 'failed', summary: String(error?.message || error || '修改执行失败'), at }).state }
}

function closeProposalWithoutRevision(state, proposalId, status) {
  const next = clone(state)
  const proposal = next.proposals.find(item => item.id === proposalId)
  if (!proposal) throw new Error('未找到 Proposal')
  if (proposal.status !== 'pending') throw new Error('Proposal 已处理')
  proposal.status = status
  proposal.updatedAt = now()
  if (status === 'rejected') proposal.rejectedAt = proposal.updatedAt
  if (status === 'returned_to_agent') proposal.returnedAt = proposal.updatedAt
  if (proposal.kind === 'layout') return { state: next, proposal: clone(proposal) }
  const submissionStatus = status === 'returned_to_agent' ? 'rejected' : status
  const transitioned = transitionReviewSubmission(next, proposal.submissionId, submissionStatus, { resultProposalId: proposal.id })
  const closed = status === 'returned_to_agent'
    ? transitioned.state
    : closeReviewTasksForSubmission(transitioned.state, proposal.submissionId, status === 'rejected' ? '本轮批注已拒绝' : '本轮批注已完成')
  return { state: closed, proposal: clone(proposal) }
}

export function rejectProposal(state, proposalId) {
  return closeProposalWithoutRevision(state, proposalId, 'rejected')
}

export function returnProposalToAgent(state, proposalId) {
  return closeProposalWithoutRevision(state, proposalId, 'returned_to_agent')
}

export function markProposalStale(state, proposalId) {
  const next = clone(state)
  const proposal = next.proposals.find(item => item.id === proposalId)
  if (!proposal) throw new Error('未找到 Proposal')
  if (proposal.status !== 'pending') throw new Error('Proposal 已处理')
  proposal.status = 'stale'
  proposal.updatedAt = now()
  proposal.staleAt = proposal.updatedAt
  if (proposal.kind === 'layout') return { state: next, proposal: clone(proposal) }
  const transitioned = transitionReviewSubmission(next, proposal.submissionId, 'stale', { resultProposalId: proposal.id })
  const closed = closeReviewTasksForSubmission(transitioned.state, proposal.submissionId, '本轮批注已过期')
  return { state: closed, proposal: clone(proposal) }
}
