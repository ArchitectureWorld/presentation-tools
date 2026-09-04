import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptProposal,
  createInitialState,
  createProposalFromAgent,
  executeAction,
  markSubmissionDispatch,
  submitReviewRound,
} from './index.mjs'
import { ERROR_CODES, createStudioId } from '../studio-contracts/index.mjs'

function addOutline(state, title) {
  return executeAction(state, { type: 'outline.add', parentId: null, title }).state
}

function addAnnotation(state, { scopeKey, reviewRoundId = null, targetId = scopeKey, instruction = '请调整' }) {
  return executeAction(state, {
    type: 'annotation.add',
    scopeKey,
    reviewRoundId,
    target: { type: 'scope', id: targetId, label: targetId },
    instruction,
  }).state
}

function outlineSubmission() {
  let state = createInitialState()
  state = addOutline(state, '第一章')
  state = addOutline(state, '第二章')
  state = addAnnotation(state, { scopeKey: 'outline:root', targetId: state.outline[0].id })
  return submitReviewRound(state, { scopeKey: 'outline:root' })
}

function commandCommon(submission, overrides = {}) {
  return {
    commandId: createStudioId('command'),
    scopeKey: submission.scopeKey,
    baseRevision: submission.baseRevision,
    riskLevel: 'ordinary_reversible',
    sourceAnnotationIds: [submission.annotationSnapshots[0].annotationId],
    ...overrides,
  }
}

function envelope(state, submission, commands, overrides = {}) {
  return {
    submissionId: submission.reviewSubmissionId,
    projectId: state.project.id,
    baseRevision: submission.baseRevision,
    scopeKey: submission.scopeKey,
    idempotencyKey: submission.idempotencyKey,
    message: 'Agent 修改建议',
    commands,
    ...overrides,
  }
}

function delivered(submitted) {
  return { ...submitted, state: markSubmissionDispatch(submitted.state, submitted.submission.id, { status: 'dispatched', sessionId: 'gateway-test' }).state }
}

function twoPageDraftSubmission() {
  let state = createInitialState()
  state = addOutline(state, '第一页')
  state = addOutline(state, '第二页')
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[1].id }).state
  const [pageA, pageB] = state.pages
  state = executeAction(state, { type: 'ui.setPage', pageId: pageA.id }).state
  state = addAnnotation(state, { scopeKey: `draft:${pageA.id}`, targetId: pageA.id })
  return { ...submitReviewRound(state, { scopeKey: `draft:${pageA.id}` }), pageA, pageB }
}

test('ReviewSubmission freezes project, stage, scope, permissions and annotation snapshots', () => {
  const submitted = outlineSubmission()
  const { submission } = submitted
  assert.equal(submission.reviewSubmissionId, submission.id)
  assert.equal(submission.reviewRoundId, submitted.round.id)
  assert.equal(submission.projectId, submitted.state.project.id)
  assert.equal(submission.stage, 'outline')
  assert.equal(submission.scopeKey, 'outline:root')
  assert.equal(submission.pageId, null)
  assert.equal(submission.baseRevision, submitted.state.project.currentRevision)
  assert.equal(submission.annotationSnapshots[0].annotationId, submitted.state.annotations[0].id)
  assert.ok(submission.allowedCommands.includes('outline.rename'))
  assert.equal(submission.allowedCommands.includes('outline.delete'), false)
  assert.ok(submission.writableIds.includes(submitted.state.project.outlineDocumentId))
  assert.match(submission.idempotencyKey, new RegExp(submission.reviewSubmissionId))
  assert.equal(typeof submission.createdAt, 'string')

  const frozen = structuredClone(submission)
  const dispatched = markSubmissionDispatch(submitted.state, submission.id, { status: 'dispatched' })
  const stored = dispatched.state.reviewSubmissions[0]
  for (const field of ['reviewSubmissionId', 'reviewRoundId', 'projectId', 'stage', 'scopeKey', 'pageId', 'baseRevision', 'annotationSnapshots', 'allowedCommands', 'writableIds', 'idempotencyKey', 'createdAt']) {
    assert.deepEqual(stored[field], frozen[field], `${field} must remain immutable`)
  }
})

test('ReviewRound reuse rejects cross-scope and leaves the input state untouched', () => {
  const first = outlineSubmission()
  const state = addAnnotation(first.state, { scopeKey: 'outline:other', reviewRoundId: first.round.id })
  const before = structuredClone(state)
  assert.throws(() => submitReviewRound(state, { scopeKey: 'outline:other', reviewRoundId: first.round.id }), error => error.code === ERROR_CODES.INVALID_COMMAND)
  assert.deepEqual(state, before)
})

test('ReviewRound reuse rejects a different stage', () => {
  const first = outlineSubmission()
  const state = addAnnotation(first.state, { scopeKey: 'outline:root', reviewRoundId: first.round.id })
  assert.throws(() => submitReviewRound(state, { scopeKey: 'outline:root', stage: 'draft', reviewRoundId: first.round.id }), error => error.code === ERROR_CODES.INVALID_COMMAND)
})

test('ReviewRound reuse rejects a different draft page', () => {
  const first = twoPageDraftSubmission()
  let state = executeAction(first.state, { type: 'ui.setPage', pageId: first.pageB.id }).state
  state = addAnnotation(state, { scopeKey: `draft:${first.pageB.id}`, reviewRoundId: first.round.id, targetId: first.pageB.id })
  assert.throws(() => submitReviewRound(state, { scopeKey: `draft:${first.pageB.id}`, reviewRoundId: first.round.id }), error => error.code === ERROR_CODES.INVALID_COMMAND)
})

test('ReviewRound reuse rejects a closed round', () => {
  const first = outlineSubmission()
  const closed = structuredClone(first.state)
  closed.reviewRounds[0].status = 'closed'
  const state = addAnnotation(closed, { scopeKey: 'outline:root', reviewRoundId: first.round.id })
  assert.throws(() => submitReviewRound(state, { scopeKey: 'outline:root', reviewRoundId: first.round.id }), error => error.code === ERROR_CODES.INVALID_COMMAND)
})

test('valid multi-command ChangeSet is preflighted in one isolated Candidate and persists structured diff', () => {
  const submitted = delivered(outlineSubmission())
  const [first, second] = submitted.state.outline
  const commands = [
    { ...commandCommon(submitted.submission), type: 'outline.rename', nodeId: first.id, title: '第一章（新）' },
    { ...commandCommon(submitted.submission), type: 'outline.rename', nodeId: second.id, title: '第二章（新）' },
  ]
  const result = createProposalFromAgent(submitted.state, submitted.submission.id, envelope(submitted.state, submitted.submission, commands))
  assert.equal(result.state.outline[0].title, '第一章')
  assert.equal(result.state.outline[1].title, '第二章')
  assert.deepEqual(result.proposal.affectedObjectIds, [first.id, second.id].sort())
  assert.equal(result.proposal.aggregateRiskLevel, 'ordinary_reversible')
  assert.equal(result.proposal.hasDeletion, false)
  assert.deepEqual(result.proposal.sourceAnnotationIds, [submitted.submission.annotationSnapshots[0].annotationId])
  assert.equal(result.proposal.diff.changes.length, 2)
  assert.equal(result.proposal.diff.before.length, 2)
  assert.equal(result.proposal.diff.after.length, 2)
  assert.equal(result.proposal.diff.changes[0].changeType, 'modified')

  const accepted = acceptProposal(result.state, result.proposal.id)
  assert.deepEqual(accepted.state.outline.map(node => node.title), ['第一章（新）', '第二章（新）'])
})

test('acceptance publishes the exact preflighted Candidate identities shown by the Proposal diff', () => {
  const submitted = delivered(twoPageDraftSubmission())
  const command = {
    ...commandCommon(submitted.submission),
    type: 'draft.update',
    pageId: submitted.pageA.id,
    patch: { body: '新增正文块' },
  }
  const proposed = createProposalFromAgent(submitted.state, submitted.submission.id, envelope(submitted.state, submitted.submission, [command]))
  const addedBlock = proposed.proposal.diff.changes.find(change => change.changeType === 'added' && change.objectId.startsWith('content_block_'))
  assert.ok(addedBlock)
  const accepted = acceptProposal(proposed.state, proposed.proposal.id)
  assert.ok(accepted.state.pages[0].contentBlocks.some(block => block.contentBlockId === addedBlock.objectId))
})

function outlineRenameFixture() {
  const submitted = delivered(outlineSubmission())
  const command = {
    ...commandCommon(submitted.submission),
    type: 'outline.rename',
    nodeId: submitted.state.outline[0].id,
    title: '有效标题',
  }
  return { submitted, command }
}

for (const [name, mutate] of [
  ['unknown command type', command => ({ ...command, type: 'unknown.command' })],
  ['extra command field', command => ({ ...command, extra: true })],
  ['wrong stable id type', command => ({ ...command, nodeId: 42 })],
  ['outline.delete in an ordinary task', command => ({ ...command, type: 'outline.delete' })],
  ['risk escalation', command => ({ ...command, riskLevel: 'structural_review_required' })],
]) {
  test(`gateway rejects ${name} before Proposal persistence`, () => {
    const { submitted, command } = outlineRenameFixture()
    const input = envelope(submitted.state, submitted.submission, [mutate(command)])
    assert.throws(() => createProposalFromAgent(submitted.state, submitted.submission.id, input), error => error.code === ERROR_CODES.INVALID_COMMAND)
    assert.equal(submitted.state.proposals.length, 0)
  })
}

test('gateway rejects project, revision and scope mismatches before Proposal persistence', () => {
  const { submitted, command } = outlineRenameFixture()
  for (const mismatch of [
    { projectId: createStudioId('project') },
    { baseRevision: submitted.submission.baseRevision + 1 },
    { scopeKey: `draft:${createStudioId('page')}` },
  ]) {
    assert.throws(
      () => createProposalFromAgent(submitted.state, submitted.submission.id, envelope(submitted.state, submitted.submission, [command], mismatch)),
      error => error.code === ERROR_CODES.INVALID_COMMAND || error.code === ERROR_CODES.STALE_REVIEW_SUBMISSION,
    )
  }
  assert.equal(submitted.state.proposals.length, 0)
})

test('gateway rejects a schema-valid command not allowed for the Submission', () => {
  const submitted = twoPageDraftSubmission()
  const command = {
    ...commandCommon(submitted.submission),
    type: 'outline.rename',
    nodeId: submitted.state.outline[0].id,
    title: '越权标题',
  }
  assert.throws(() => createProposalFromAgent(submitted.state, submitted.submission.id, envelope(submitted.state, submitted.submission, [command])), error => error.code === ERROR_CODES.INVALID_COMMAND)
  assert.equal(submitted.state.proposals.length, 0)
})

test('gateway rejects out-of-page and unknown writable ids', () => {
  const submitted = twoPageDraftSubmission()
  for (const pageId of [submitted.pageB.id, createStudioId('page')]) {
    const command = {
      ...commandCommon(submitted.submission),
      type: 'draft.update',
      pageId,
      patch: { body: '越权正文' },
    }
    assert.throws(() => createProposalFromAgent(submitted.state, submitted.submission.id, envelope(submitted.state, submitted.submission, [command])), error => error.code === ERROR_CODES.INVALID_COMMAND)
  }
  assert.equal(submitted.state.proposals.length, 0)
})

test('one invalid command rejects the full mixed ChangeSet without a partial Proposal', () => {
  const { submitted, command } = outlineRenameFixture()
  const invalid = { ...command, commandId: createStudioId('command'), nodeId: createStudioId('outlineNode'), title: '不存在' }
  assert.throws(() => createProposalFromAgent(submitted.state, submitted.submission.id, envelope(submitted.state, submitted.submission, [command, invalid])), error => error.code === ERROR_CODES.INVALID_COMMAND)
  assert.equal(submitted.state.proposals.length, 0)
  assert.equal(submitted.state.outline[0].title, '第一章')
})

test('idempotent repeat returns the same Proposal while conflicting reuse is rejected', () => {
  const { submitted, command } = outlineRenameFixture()
  const input = envelope(submitted.state, submitted.submission, [command])
  const first = createProposalFromAgent(submitted.state, submitted.submission.id, input)
  const repeated = createProposalFromAgent(first.state, submitted.submission.id, input)
  assert.equal(repeated.proposal.id, first.proposal.id)
  assert.equal(repeated.state.proposals.length, 1)
  assert.throws(
    () => createProposalFromAgent(first.state, submitted.submission.id, { ...input, message: '同键但不同内容' }),
    error => error.code === ERROR_CODES.PROPOSAL_ALREADY_EXISTS,
  )
})
