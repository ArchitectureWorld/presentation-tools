import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, executeAction, submitReviewRound, createProposalFromAgent, acceptProposal, markSubmissionDispatch, retryReviewSubmission } from './index.mjs';

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
  const submitted = submitReviewRound(state, { scopeKey: 'outline:root' }); state = submitted.state;
  const proposalResult = createProposalFromAgent(state, submitted.submission.id, { message: '建议修改标题', commands: [{ type: 'outline.rename', nodeId, title: 'A：明确目标' }] });
  state = proposalResult.state; assert.equal(state.outline[0].title, 'A'); const before = state.project.currentRevision;
  const accepted = acceptProposal(state, proposalResult.proposal.id);
  assert.equal(accepted.state.outline[0].title, 'A：明确目标'); assert.equal(accepted.state.project.currentRevision, before + 1); assert.equal(accepted.state.annotations[0].resolution, 'open');
});

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
  const submitted = submitReviewRound(state, { scopeKey: 'outline:root' })
  const input = { message: '同一结果', commands: [{ type: 'project.rename', title: '幂等项目' }], idempotencyKey: submitted.submission.idempotencyKey }
  const first = createProposalFromAgent(submitted.state, submitted.submission.id, input)
  const repeated = createProposalFromAgent(first.state, submitted.submission.id, input)
  assert.equal(repeated.proposal.id, first.proposal.id)
  assert.equal(repeated.state.proposals.length, 1)
})
