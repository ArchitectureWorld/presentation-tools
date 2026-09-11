import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState, executeAction, submitReviewRound, markSubmissionDispatch, applyCommandsFromAgent } from './index.mjs'
import { createStudioId } from '../studio-contracts/index.mjs'
import { reviewSubmissionContext } from '../../apps/studio-local/agent-context.mjs'

function fixture() {
  let state = createInitialState()
  state = executeAction(state, { type: 'outline.add', parentId: null, title: '页面标题' }).state
  state = executeAction(state, { type: 'draft.ensurePage', outlineNodeId: state.outline[0].id }).state
  state = executeAction(state, { type: 'draft.update', pageId: state.pages[0].id, patch: { body: '前文😀待修改后文', bullets: ['第一条', '第二条'], script: '保留讲解稿' } }).state
  const page = state.pages[0]
  const body = page.contentBlocks.find(block => block.type === 'text' && block.role === 'body')
  const list = page.contentBlocks.find(block => block.type === 'list')
  return { state, page, body, list, scopeKey: `draft:${page.id}` }
}

function annotation(fx, target) {
  return executeAction(fx.state, { type: 'annotation.add', scopeKey: fx.scopeKey, target, instruction: '只改选定内容' })
}

function submit(fx, targets) {
  for (const target of targets) fx.state = annotation(fx, target).state
  const result = submitReviewRound(fx.state, { scopeKey: fx.scopeKey })
  return { ...fx, ...result, state: markSubmissionDispatch(result.state, result.submission.id, { status: 'dispatched', sessionId: 'targeted-test' }).state }
}

function input(fx, commands) {
  const s = fx.submission
  return { submissionId: s.id, projectId: s.projectId, baseRevision: s.baseRevision, scopeKey: s.scopeKey, idempotencyKey: s.idempotencyKey,
    message: '已按目标修改', commands: commands.map(command => ({ commandId: createStudioId('command'), scopeKey: s.scopeKey, baseRevision: s.baseRevision,
      riskLevel: 'ordinary_reversible', sourceAnnotationIds: [s.annotationSnapshots[0].annotationId], ...command })) }
}

function apply(fx, commands) { return applyCommandsFromAgent(fx.state, fx.submission.id, input(fx, commands)) }
const textTarget = fx => ({ type: 'draft-text', id: fx.body.contentBlockId, pageId: fx.page.id, blockId: fx.body.contentBlockId, label: '正文' })
const titleTarget = fx => ({ type: 'draft-title', id: fx.page.titleBlockId, pageId: fx.page.id, blockId: fx.page.titleBlockId, label: '标题' })
const itemTarget = (fx, index = 0) => ({ type: 'draft-list-item', id: fx.list.items[index].listItemId, pageId: fx.page.id, blockId: fx.list.contentBlockId, label: `要点${index + 1}` })
const invalidTarget = error => error.code === 'invalid_command' && /target|目标|选区/iu.test(error.message)

test('legacy draft-page annotations still apply and close as whole-page requests', () => {
  const fx = fixture()
  const submitted = submit(fx, [{ type: 'draft-page', id: fx.page.id, label: '旧整页批注' }])
  const result = apply(submitted, [{ type: 'draft.update', pageId: fx.page.id, patch: { heading: '兼容旧标题修改' } }])
  assert.equal(result.state.pages[0].heading, '兼容旧标题修改')
  assert.equal(result.state.annotations[0].resolution, 'resolved')
})

test('targeted annotations reject foreign pages, wrong body blocks and stale text selections on creation', () => {
  const fx = fixture()
  for (const target of [
    { ...textTarget(fx), pageId: createStudioId('page') },
    { ...textTarget(fx), blockId: fx.page.titleBlockId },
    { ...textTarget(fx), selection: { start: 4, end: 7, quote: '过期文字' } },
    { ...textTarget(fx), selection: { start: 3, end: 7, quote: '\ude00待修改' } },
    { ...itemTarget(fx), id: createStudioId('listItem') },
  ]) assert.throws(() => annotation(fx, target), invalidTarget)
})

test('submission rejects a text anchor made stale by a later manual edit', () => {
  const fx = fixture()
  fx.state = annotation(fx, { ...textTarget(fx), selection: { start: 4, end: 7, quote: '待修改' } }).state
  fx.state = executeAction(fx.state, { type: 'draft.update', pageId: fx.page.id, patch: { body: '已完全替换正文' } }).state
  assert.throws(() => submitReviewRound(fx.state, { scopeKey: fx.scopeKey }), invalidTarget)
})

test('frozen target and agent context retain body anchors with only safe target fields', () => {
  const fx = fixture()
  const target = { ...textTarget(fx), selection: { start: 4, end: 7, quote: '待修改', binaryPayload: 'private' }, privateData: 'private' }
  const submitted = submit(fx, [target])
  const projected = reviewSubmissionContext(submitted.state, submitted.submission)
  assert.deepEqual(projected.annotations[0].target, { ...textTarget(fx), selection: { start: 4, end: 7, quote: '待修改' } })
  target.selection.quote = '被外部修改'
  assert.equal(submitted.submission.annotationSnapshots[0].target.selection.quote, '待修改')
})

test('text selection changes retain their original UTF-16 prefix and suffix', () => {
  const fx = fixture()
  const submitted = submit(fx, [{ ...textTarget(fx), selection: { start: 4, end: 7, quote: '待修改' } }])
  for (const patch of [{ heading: '不应改标题' }, { script: '不应改讲解稿' }, { body: '越界😀完成后文' }, { body: '前文😀完成丢失后缀' }]) {
    assert.throws(() => apply(submitted, [{ type: 'draft.update', pageId: fx.page.id, patch }]), invalidTarget)
  }
  const result = apply(submitted, [{ type: 'draft.update', pageId: fx.page.id, patch: { body: '前文😀已完成局部修改后文' } }])
  assert.equal(result.state.pages[0].body, '前文😀已完成局部修改后文')
  assert.equal(result.state.pages[0].heading, '页面标题')
  assert.equal(result.state.pages[0].script, '保留讲解稿')
  assert.deepEqual(result.state.pages[0].bullets, ['第一条', '第二条'])
})

test('single list item edits preserve its stable identity and every other item', () => {
  const fx = fixture()
  const submitted = submit(fx, [itemTarget(fx)])
  const result = apply(submitted, [{ type: 'draft.list.update', pageId: fx.page.id, listItemId: fx.list.items[0].listItemId, content: '第一条已修改' }])
  const items = result.state.pages[0].contentBlocks.find(block => block.type === 'list').items
  assert.deepEqual(items.map(item => item.content), ['第一条已修改', '第二条'])
  assert.deepEqual(items.map(item => item.listItemId), fx.list.items.map(item => item.listItemId))
  for (const command of [
    { type: 'draft.list.update', pageId: fx.page.id, listItemId: fx.list.items[1].listItemId, content: '越界' },
    { type: 'draft.list.delete', pageId: fx.page.id, listItemId: fx.list.items[0].listItemId, riskLevel: 'structural_review_required' },
    { type: 'draft.update', pageId: fx.page.id, patch: { body: '越界正文' } },
  ]) assert.throws(() => apply(submitted, [command]), invalidTarget)
})

test('each command source annotation must match its target even within a mixed submission', () => {
  const fx = fixture()
  const submitted = submit(fx, [titleTarget(fx), textTarget(fx)])
  const [titleId, bodyId] = submitted.submission.annotationSnapshots.map(row => row.annotationId)
  assert.throws(() => apply(submitted, [{ type: 'draft.update', pageId: fx.page.id, patch: { body: '正文新内容' }, sourceAnnotationIds: [titleId] }]), invalidTarget)
  assert.throws(() => apply(submitted, [{ type: 'draft.update', pageId: fx.page.id, patch: { body: '正文新内容' }, sourceAnnotationIds: [titleId, bodyId] }]), invalidTarget)
  const result = apply(submitted, [
    { type: 'draft.update', pageId: fx.page.id, patch: { heading: '标题新内容' }, sourceAnnotationIds: [titleId] },
    { type: 'draft.update', pageId: fx.page.id, patch: { body: '正文新内容' }, sourceAnnotationIds: [bodyId] },
  ])
  assert.equal(result.state.pages[0].heading, '标题新内容')
  assert.equal(result.state.pages[0].body, '正文新内容')
})

test('legacy page annotations retain page-wide edit support', () => {
  const fx = fixture()
  const submitted = submit(fx, [{ type: 'page', id: fx.page.id, label: '整页' }])
  const result = apply(submitted, [{ type: 'draft.update', pageId: fx.page.id, patch: { script: '新的讲解稿' } }])
  assert.equal(result.state.pages[0].script, '新的讲解稿')
})

test('adding a page-wide source cannot bypass a selected text source boundary', () => {
  const fx = fixture()
  const submitted = submit(fx, [{ ...textTarget(fx), selection: { start: 4, end: 7, quote: '待修改' } }, { type: 'page', id: fx.page.id, label: '整页' }])
  assert.throws(() => apply(submitted, [{ type: 'draft.update', pageId: fx.page.id, patch: { body: '整页任意替换' },
    sourceAnnotationIds: submitted.submission.annotationSnapshots.map(row => row.annotationId) }]), invalidTarget)
})

test('two selected spans can share one command only while the unselected gap remains', () => {
  const fx = fixture()
  fx.state = executeAction(fx.state, { type: 'draft.update', pageId: fx.page.id, patch: { body: '前甲中间乙后' } }).state
  const submitted = submit(fx, [
    { ...textTarget(fx), selection: { start: 1, end: 2, quote: '甲' } },
    { ...textTarget(fx), selection: { start: 4, end: 5, quote: '乙' } },
  ])
  const command = { type: 'draft.update', pageId: fx.page.id, sourceAnnotationIds: submitted.submission.annotationSnapshots.map(row => row.annotationId) }
  assert.throws(() => apply(submitted, [{ ...command, patch: { body: '前一破坏间隔二后' } }]), invalidTarget)
  assert.equal(apply(submitted, [{ ...command, patch: { body: '前新的甲中间新的乙后' } }]).state.pages[0].body, '前新的甲中间新的乙后')
})

test('a selection within one list item also preserves unselected text', () => {
  const fx = fixture()
  const submitted = submit(fx, [{ ...itemTarget(fx), selection: { start: 1, end: 2, quote: '一' } }])
  const command = { type: 'draft.list.update', pageId: fx.page.id, listItemId: fx.list.items[0].listItemId }
  assert.throws(() => apply(submitted, [{ ...command, content: '完全改写' }]), invalidTarget)
  assert.deepEqual(apply(submitted, [{ ...command, content: '第一个条' }]).state.pages[0].bullets, ['第一个条', '第二条'])
})

test('two full-field commands cannot silently overwrite separately selected edits', () => {
  const fx = fixture()
  fx.state = executeAction(fx.state, { type: 'draft.update', pageId: fx.page.id, patch: { body: 'A1B2C' } }).state
  const submitted = submit(fx, [
    { ...textTarget(fx), selection: { start: 1, end: 2, quote: '1' } },
    { ...textTarget(fx), selection: { start: 3, end: 4, quote: '2' } },
  ])
  const [first, second] = submitted.submission.annotationSnapshots.map(row => row.annotationId)
  assert.throws(() => apply(submitted, [
    { type: 'draft.update', pageId: fx.page.id, patch: { body: 'AxB2C' }, sourceAnnotationIds: [first] },
    { type: 'draft.update', pageId: fx.page.id, patch: { body: 'A1ByC' }, sourceAnnotationIds: [second] },
  ]), error => error.code === 'invalid_command' && /同一|重复|合并/.test(error.message))
  assert.equal(submitted.state.pages[0].body, 'A1B2C')
  assert.ok(submitted.state.annotations.every(row => row.resolution === 'open'))
})
