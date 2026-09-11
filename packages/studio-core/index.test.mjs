import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, executeAction, submitReviewRound, createProposalFromAgent, acceptProposal, markSubmissionDispatch, retryReviewSubmission } from './index.mjs';
import { createStudioId } from '../studio-contracts/index.mjs'

function agentCommandInput(state, submission, command) {
  const common = {
    commandId: createStudioId('command'), scopeKey: submission.scopeKey, baseRevision: submission.baseRevision,
    riskLevel: 'ordinary_reversible', sourceAnnotationIds: [submission.annotationSnapshots[0].annotationId],
  }
  return {
    submissionId: submission.id, projectId: state.project.id, baseRevision: submission.baseRevision,
    scopeKey: submission.scopeKey, idempotencyKey: submission.idempotencyKey, message: '结构化修改建议',
    commands: [{ ...common, ...command }],
  }
}

function delivered(submitted) {
  return { ...submitted, state: markSubmissionDispatch(submitted.state, submitted.submission.id, { status: 'dispatched', sessionId: 'core-test' }).state }
}

test('outline nodes receive stable ids and draft page keeps source outline id', () => {
  let state = createInitialState();
  ({ state } = executeAction(state, { type: 'outline.add', parentId: null, title: '项目背景' }));
  const node = state.outline[0]; assert.match(node.id, /^outline_/); const id = node.id;
  ({ state } = executeAction(state, { type: 'outline.rename', nodeId: id, title: '项目背景与目标' }));
  assert.equal(state.outline[0].id, id);
  ({ state } = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: id }));
  assert.equal(state.pages[0].outlineNodeId, id); assert.match(state.pages[0].id, /^page_/);
});

test('manual draft edits create a content revision', () => {
  let state = createInitialState();
  ({ state } = executeAction(state, { type: 'outline.add', parentId: null, title: 'A' }));
  const nodeId = state.outline[0].id;
  ({ state } = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: nodeId }));
  const pageId = state.pages[0].id; const before = state.project.currentRevision;
  ({ state } = executeAction(state, { type: 'draft.update', pageId, patch: { heading: '核心结论', body: '正文内容' } }));
  assert.equal(state.project.currentRevision, before + 1); assert.equal(state.pages[0].heading, '核心结论'); assert.equal(state.revisions.at(-1).number, state.project.currentRevision);
});

test('annotations autosave without increasing content revision', () => {
  let state = createInitialState(); const before = state.project.currentRevision;
  ({ state } = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', target: { type: 'outline-document', id: 'outline:root', label: '整份大纲' }, instruction: '先补充目标。' }));
  assert.equal(state.project.currentRevision, before); assert.equal(state.annotations.length, 1); assert.equal(state.annotations[0].lifecycle, 'draft'); assert.equal(state.annotations[0].resolution, 'open');
});

test('one review round can create multiple immutable submissions', () => {
  let state = createInitialState();
  ({ state } = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', target: { type: 'outline-document', id: 'outline:root', label: '整份大纲' }, instruction: '第一次意见' }));
  let first = submitReviewRound(state, { scopeKey: 'outline:root' }); state = first.state; const roundId = first.round.id;
  assert.equal(first.submission.number, 1); const firstSnapshot = structuredClone(first.submission.annotations);
  ({ state } = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', reviewRoundId: roundId, target: { type: 'outline-document', id: 'outline:root', label: '整份大纲' }, instruction: '第二次补充' }));
  const second = submitReviewRound(state, { scopeKey: 'outline:root', reviewRoundId: roundId });
  assert.equal(second.round.id, roundId); assert.equal(second.submission.number, 2); assert.deepEqual(second.state.reviewSubmissions[0].annotations, firstSnapshot); assert.equal(second.state.reviewSubmissions.length, 2);
});

test('agent proposal is explicit and acceptance creates revision without auto resolving annotations', () => {
  let state = createInitialState();
  ({ state } = executeAction(state, { type: 'outline.add', parentId: null, title: 'A' })); const nodeId = state.outline[0].id;
  ({ state } = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', target: { type: 'outline-node', id: nodeId, label: 'A' }, instruction: '标题更明确' }));
  const submitted = delivered(submitReviewRound(state, { scopeKey: 'outline:root' })); state = submitted.state;
  const proposalResult = createProposalFromAgent(state, submitted.submission.id, agentCommandInput(state, submitted.submission, { type: 'outline.rename', nodeId, title: 'A：明确目标' }));
  state = proposalResult.state; assert.equal(state.outline[0].title, 'A'); const before = state.project.currentRevision;
  const accepted = acceptProposal(state, proposalResult.proposal.id);
  assert.equal(accepted.state.outline[0].title, 'A：明确目标'); assert.equal(accepted.state.project.currentRevision, before + 1); assert.equal(accepted.state.annotations[0].resolution, 'open');
});

function stateWithList() {
  let state = createInitialState()
  ;({ state } = executeAction(state, { type: 'outline.add', parentId: null, title: '列表页' }))
  ;({ state } = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }))
  const pageId = state.pages[0].id
  ;({ state } = executeAction(state, { type: 'draft.update', pageId, patch: { bullets: ['甲', '乙', '丙'] } }))
  return { state, pageId }
}

test('draft.list.insert gives the new item an identity without replacing existing list items', () => {
  let { state, pageId } = stateWithList()
  const originalIds = state.pages[0].contentBlocks.find(block => block.type === 'list').items.map(item => item.listItemId)
  ;({ state } = executeAction(state, { type: 'draft.list.insert', pageId, afterListItemId: originalIds[0], content: '新项' }))
  const items = state.pages[0].contentBlocks.find(block => block.type === 'list').items
  assert.deepEqual(items.map(item => item.content), ['甲', '新项', '乙', '丙'])
  assert.equal(items[0].listItemId, originalIds[0])
  assert.equal(items[2].listItemId, originalIds[1])
  assert.equal(items[3].listItemId, originalIds[2])
  assert.match(items[1].listItemId, /^list_item_/)
})

test('draft.list.insert creates the first list item for a new page', () => {
  let state = createInitialState()
  ;({ state } = executeAction(state, { type: 'outline.add', parentId: null, title: '空列表页' }))
  ;({ state } = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }))
  const pageId = state.pages[0].id
  ;({ state } = executeAction(state, { type: 'draft.list.insert', pageId, content: '首项' }))
  const list = state.pages[0].contentBlocks.find(block => block.type === 'list')
  assert.equal(list.items[0].content, '首项')
  assert.match(list.items[0].listItemId, /^list_item_/)
})

test('draft.list.delete removes only the selected list item identity', () => {
  let { state, pageId } = stateWithList()
  const originalIds = state.pages[0].contentBlocks.find(block => block.type === 'list').items.map(item => item.listItemId)
  ;({ state } = executeAction(state, { type: 'draft.list.delete', pageId, listItemId: originalIds[1] }))
  const items = state.pages[0].contentBlocks.find(block => block.type === 'list').items
  assert.deepEqual(items.map(item => item.listItemId), [originalIds[0], originalIds[2]])
})

test('draft.list.move reorders by list item identity while retaining every identity', () => {
  let { state, pageId } = stateWithList()
  const originalIds = state.pages[0].contentBlocks.find(block => block.type === 'list').items.map(item => item.listItemId)
  ;({ state } = executeAction(state, { type: 'draft.list.move', pageId, listItemId: originalIds[2], direction: 'up' }))
  const items = state.pages[0].contentBlocks.find(block => block.type === 'list').items
  assert.deepEqual(items.map(item => item.listItemId), [originalIds[0], originalIds[2], originalIds[1]])
})

test('draft.update edits list and script nodes by their stable ids and preserves empty content', () => {
  let { state, pageId } = stateWithList()
  ;({ state } = executeAction(state, { type: 'draft.update', pageId, patch: { body: '待清空正文' } }))
  const page = state.pages[0]
  const list = page.contentBlocks.find(block => block.type === 'list')
  const firstScript = { scriptBlockId: createStudioId('scriptBlock'), order: 0, content: '第一段', estimatedDurationSeconds: null, referencedContentBlockIds: [page.titleBlockId], referencedAssetIds: [], sourceRefs: [] }
  const secondScript = { ...structuredClone(firstScript), scriptBlockId: createStudioId('scriptBlock'), order: 1, content: '第二段' }
  page.scriptBlocks = [firstScript, secondScript]
  ;({ state } = executeAction(state, {
    type: 'draft.update', pageId,
    patch: {
      body: '',
      listBlockId: list.contentBlockId,
      listItems: [
        { ...list.items[2], content: '丙已编辑', order: 0 },
        { ...list.items[0], content: '', order: 1 },
      ],
      scriptBlocks: [{ ...firstScript, content: '' }, { ...secondScript, content: '第二段已编辑' }],
    },
  }))
  const updated = state.pages[0]
  assert.equal(updated.contentBlocks.find(block => block.type === 'text' && block.role === 'body').content, '')
  assert.deepEqual(updated.contentBlocks.find(block => block.contentBlockId === list.contentBlockId).items.map(item => [item.listItemId, item.content]), [[list.items[2].listItemId, '丙已编辑'], [list.items[0].listItemId, '']])
  assert.deepEqual(updated.scriptBlocks.map(script => [script.scriptBlockId, script.content]), [[firstScript.scriptBlockId, ''], [secondScript.scriptBlockId, '第二段已编辑']])
})

test('deleting an outline parent removes descendant pages and repairs active page', () => {
  let state = createInitialState()
  ;({ state } = executeAction(state, { type: 'outline.add', parentId: null, title: '父章节' }))
  const parentId = state.outline[0].id
  ;({ state } = executeAction(state, { type: 'outline.add', parentId, title: '子章节' }))
  const childId = state.outline[0].children[0].id
  ;({ state } = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: childId }))
  assert.equal(state.pages.length, 1)
  ;({ state } = executeAction(state, { type: 'outline.delete', nodeId: parentId }))
  assert.equal(state.outline.length, 0)
  assert.equal(state.pages.length, 0)
  assert.equal(state.ui.activePageId, null)
})

test('ReviewSubmission delivery failure can retry the same immutable submission', () => {
  let state = createInitialState()
  ;({ state } = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', instruction: '重试意见' }))
  const submitted = submitReviewRound(state, { scopeKey: 'outline:root' })
  assert.equal(submitted.submission.status, 'pending_dispatch')
  const failed = markSubmissionDispatch(submitted.state, submitted.submission.id, { status: 'dispatch_failed', error: 'network down' })
  assert.equal(failed.state.reviewSubmissions[0].status, 'dispatch_failed')
  const retried = retryReviewSubmission(failed.state, submitted.submission.id)
  assert.equal(retried.submission.id, submitted.submission.id)
  assert.equal(retried.submission.idempotencyKey, submitted.submission.idempotencyKey)
  assert.equal(retried.submission.status, 'pending_dispatch')
})

test('repeating Agent commands for one submission returns the existing Proposal', () => {
  let state = createInitialState()
  ;({ state } = executeAction(state, { type: 'annotation.add', scopeKey: 'outline:root', instruction: '幂等意见' }))
  const submitted = delivered(submitReviewRound(state, { scopeKey: 'outline:root' }))
  const input = agentCommandInput(submitted.state, submitted.submission, { type: 'project.rename', projectId: submitted.state.project.id, title: '幂等项目' })
  const first = createProposalFromAgent(submitted.state, submitted.submission.id, input)
  const repeated = createProposalFromAgent(first.state, submitted.submission.id, input)
  assert.equal(repeated.proposal.id, first.proposal.id)
  assert.equal(repeated.state.proposals.length, 1)
})
