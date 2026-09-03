import { createHash } from 'node:crypto';
import { createStudioId } from '../studio-contracts/index.mjs';

const now = () => new Date().toISOString();
const ID_KINDS = Object.freeze({
  project: 'project', outline: 'outlineNode', page: 'page', revision: 'revision',
  annotation: 'annotation', round: 'reviewRound', submission: 'reviewSubmission', proposal: 'proposal',
});
const id = prefix => createStudioId(ID_KINDS[prefix]);
const clone = value => structuredClone(value);

export function createInitialState() {
  return {
    schemaVersion: 'report-studio.v0.1.0',
    project: { id: id('project'), title: '未命名汇报项目', currentRevision: 0, createdAt: now(), updatedAt: now() },
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
      const node = { id: id('outline'), title, children: [], createdAt: now() };
      if (action.parentId) {
        const parent = findOutlineNode(next.outline, action.parentId);
        if (!parent) throw new Error('未找到父级大纲节点');
        parent.children ??= [];
        parent.children.push(node);
      } else next.outline.push(node);
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
      next.pages = next.pages.filter(page => !removedIds.has(page.outlineNodeId));
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
      break;
    }
    case 'draft.ensurePage': {
      const node = findOutlineNode(next.outline, action.outlineNodeId);
      if (!node) throw new Error('未找到对应大纲节点');
      let page = next.pages.find(item => item.outlineNodeId === action.outlineNodeId);
      if (!page) {
        page = { id: id('page'), outlineNodeId: action.outlineNodeId, heading: node.title, body: '', bullets: [''], script: '', assets: [], createdAt: now(), updatedAt: now() };
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
      page.updatedAt = now();
      break;
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
  const submission = { id: id('submission'), reviewRoundId: round.id, number: previousCount + 1, baseRevision: next.project.currentRevision, annotations: candidates.map(annotation => ({ id: annotation.id, version: annotation.version, target: clone(annotation.target), instruction: annotation.instruction, contentHash: createHash('sha256').update(`${annotation.id}:${annotation.version}:${annotation.instruction}`).digest('hex') })), status: 'created', createdAt: now(), agentMessage: null };
  for (const annotation of candidates) { annotation.lifecycle = 'submitted'; annotation.reviewRoundId = round.id; }
  next.reviewSubmissions.push(submission); round.updatedAt = now();
  return { state: next, round: clone(round), submission: clone(submission) };
}

export function createProposalFromAgent(state, submissionId, result) {
  const next = clone(state);
  const submission = next.reviewSubmissions.find(item => item.id === submissionId);
  if (!submission) throw new Error('未找到 ReviewSubmission');
  const commands = Array.isArray(result?.commands) ? clone(result.commands) : [];
  const proposal = { id: id('proposal'), submissionId, reviewRoundId: submission.reviewRoundId, baseRevision: submission.baseRevision, message: String(result?.message || ''), commands, status: 'pending', createdAt: now() };
  submission.status = 'result_linked'; submission.agentMessage = proposal.message;
  next.proposals.push(proposal); return { state: next, proposal: clone(proposal) };
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
  return { state: next, revision: clone(next.revisions.at(-1)) };
}
