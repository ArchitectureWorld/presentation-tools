import { createHash } from 'node:crypto';
import { ERROR_CODES, StudioError, createStudioId } from '../studio-contracts/index.mjs';

const now = () => new Date().toISOString();
const ID_KINDS = Object.freeze({
  project: 'project', projectRules: 'projectRules', outlineDocument: 'outlineDocument', outline: 'outlineNode', page: 'page', draftDocument: 'draftDocument', contentBlock: 'contentBlock', listItem: 'listItem', scriptBlock: 'scriptBlock', pageAsset: 'pageAsset', revision: 'revision',
  annotation: 'annotation', round: 'reviewRound', submission: 'reviewSubmission', proposal: 'proposal',
});
const id = prefix => createStudioId(ID_KINDS[prefix]);
const clone = value => structuredClone(value);

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
    outline: [], pages: [], annotations: [], reviewRounds: [], reviewSubmissions: [], proposals: [], revisions: [],
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
      const node = { id: id('outline'), outlineNodeId: null, parentOutlineNodeId: action.parentId ?? null, title, order: 0, sourceRefs: [], opaqueExtension: null, children: [], createdAt: now() };
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
        page = { id: id('page'), pageId: null, outlineNodeId: action.outlineNodeId, draftDocumentId: null, titleBlockId: null, order: next.pages.length, heading: node.title, body: '', bullets: [''], script: '', assets: [], createdAt: now(), updatedAt: now() };
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
    case 'draft.list.insert': {
      const page = next.pages.find(item => item.id === action.pageId)
      if (!page) throw new Error('未找到草案页面')
      const list = listBlockForPage(page)
      const afterIndex = action.afterListItemId == null ? -1 : list.items.findIndex(item => item.listItemId === action.afterListItemId)
      if (afterIndex < -1) throw new Error('未找到列表项')
      if (action.afterListItemId != null && afterIndex < 0) throw new Error('未找到列表项')
      list.items.splice(afterIndex + 1, 0, { listItemId: id('listItem'), content: String(action.content ?? ''), order: 0, sourceRefs: [] })
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
  const scopeKey = input.scopeKey;
  if (!scopeKey) throw new Error('缺少 scopeKey');
  let round = input.reviewRoundId ? next.reviewRounds.find(item => item.id === input.reviewRoundId) : null;
  if (input.reviewRoundId && !round) throw new Error('未找到批注轮次');
  if (!round) { round = { id: id('round'), scopeKey, status: 'open', createdAt: now(), updatedAt: now() }; next.reviewRounds.push(round); }
  const candidates = next.annotations.filter(annotation => annotation.scopeKey === scopeKey && annotation.resolution === 'open' && annotation.lifecycle === 'draft' && (annotation.reviewRoundId === null || annotation.reviewRoundId === round.id));
  if (!candidates.length) throw new Error('当前轮次没有待提交批注');
  const previousCount = next.reviewSubmissions.filter(item => item.reviewRoundId === round.id).length;
  const submissionId = id('submission');
  const submission = { id: submissionId, reviewRoundId: round.id, number: previousCount + 1, baseRevision: next.project.currentRevision, annotations: candidates.map(annotation => ({ id: annotation.id, version: annotation.version, target: clone(annotation.target), instruction: annotation.instruction, contentHash: createHash('sha256').update(`${annotation.id}:${annotation.version}:${annotation.instruction}`).digest('hex') })), status: 'pending_dispatch', idempotencyKey: `review:${submissionId}`, dispatchAttempts: 0, lastDispatchError: null, createdAt: now(), agentMessage: null };
  for (const annotation of candidates) { annotation.lifecycle = 'submitted'; annotation.reviewRoundId = round.id; }
  next.reviewSubmissions.push(submission); round.updatedAt = now();
  return { state: next, round: clone(round), submission: clone(submission) };
}

export function createProposalFromAgent(state, submissionId, result) {
  const next = clone(state);
  const submission = next.reviewSubmissions.find(item => item.id === submissionId);
  if (!submission) throw new Error('未找到 ReviewSubmission');
  const idempotencyKey = String(result?.idempotencyKey || submission.idempotencyKey || `review:${submission.id}`);
  const existing = next.proposals.find(item => item.submissionId === submissionId);
  if (existing) {
    if (existing.idempotencyKey !== idempotencyKey) throw new StudioError(ERROR_CODES.PROPOSAL_ALREADY_EXISTS, '该 ReviewSubmission 已存在 Proposal。', { proposalId: existing.id }, 409);
    return { state: next, proposal: clone(existing), reused: true };
  }
  const commands = Array.isArray(result?.commands) ? clone(result.commands) : [];
  const proposal = { id: id('proposal'), submissionId, reviewRoundId: submission.reviewRoundId, baseRevision: submission.baseRevision, idempotencyKey, message: String(result?.message || ''), commands, status: 'pending', createdAt: now() };
  submission.status = 'proposal_created'; submission.agentMessage = proposal.message; submission.lastDispatchError = null;
  next.proposals.push(proposal); return { state: next, proposal: clone(proposal) };
}

export function markSubmissionDispatch(state, submissionId, { status, error = null } = {}) {
  if (!['dispatched', 'dispatch_failed'].includes(status)) throw new Error('无效投递状态');
  const next = clone(state);
  const submission = next.reviewSubmissions.find(item => item.id === submissionId);
  if (!submission) throw new Error('未找到 ReviewSubmission');
  submission.status = status;
  submission.dispatchAttempts = Number(submission.dispatchAttempts || 0) + 1;
  submission.lastDispatchError = status === 'dispatch_failed' ? String(error || '投递失败') : null;
  submission.lastDispatchAt = now();
  return { state: next, submission: clone(submission) };
}

export function retryReviewSubmission(state, submissionId) {
  const next = clone(state);
  const submission = next.reviewSubmissions.find(item => item.id === submissionId);
  if (!submission) throw new Error('未找到 ReviewSubmission');
  if (submission.status !== 'dispatch_failed') throw new Error('仅投递失败的 ReviewSubmission 可以重投');
  submission.status = 'pending_dispatch';
  submission.lastDispatchError = null;
  return { state: next, submission: clone(submission) };
}

export function acceptProposal(state, proposalId) {
  const proposal = state.proposals.find(item => item.id === proposalId);
  if (!proposal) throw new Error('未找到 Proposal');
  if (proposal.status !== 'pending') throw new Error('Proposal 已处理');
  if (state.project.currentRevision !== proposal.baseRevision) throw new Error('stale_revision');
  let next = clone(state);
  for (const command of proposal.commands) next = applyContentAction(next, command, { commit: false, source: 'agent' });
  next = commitRevision(next, 'agent', { proposalId, submissionId: proposal.submissionId });
  const stored = next.proposals.find(item => item.id === proposalId);
  stored.status = 'accepted'; stored.acceptedRevision = next.project.currentRevision; stored.acceptedAt = now();
  const submission = next.reviewSubmissions.find(item => item.id === stored.submissionId);
  if (submission) submission.status = 'accepted';
  return { state: next, revision: clone(next.revisions.at(-1)) };
}
