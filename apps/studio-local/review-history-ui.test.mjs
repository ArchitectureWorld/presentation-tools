import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

function element(overrides = {}) {
  return {
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    classList: { toggle() {} },
    focus() {},
    ...overrides,
  }
}

async function loadReviewHistory() {
  const appSource = await readFile(new URL('./public/app.js', import.meta.url), 'utf8')
  const htmlSource = await readFile(new URL('./public/index.html', import.meta.url), 'utf8')
  const listeners = new Map()
  let proposalScrollCount = 0
  const proposalNode = element({
    scrollIntoView() { proposalScrollCount += 1 },
  })
  const filters = ['all', 'unfinished', 'completed'].map(value => element({ dataset: { filter: value } }))
  const reviewHistory = element()
  const proposalAttention = element({ hidden: true })
  const elements = new Map([
    ['#toast', element({ hidden: true })],
    ['#project-title', element()],
    ['#save-status', element()],
    ['#page-strip', element({ hidden: true })],
    ['#revision-number', element()],
    ['#outline-stage', element()],
    ['#draft-stage', element()],
    ['#scope-label', element()],
    ['#annotation-count', element()],
    ['#proposal-attention', proposalAttention],
    ['#annotation-target', element()],
    ['#composer-title', element()],
    ['#clear-composer-round', element({ hidden: true })],
    ['#review-history', reviewHistory],
    ['#agent-status', element()],
    ['#agent-context-page', element()],
    ['#agent-context-stage', element()],
    ['#agent-feed', element()],
    ['#agent-modal', element({ hidden: true })],
    ['#annotation-input', element()],
    ['#agent-input', element()],
    ['#migration-gate', element({ hidden: true })],
    ['#migration-detail', element()],
    ['#migration-apply', element()],
  ])

  const annotations = Array.from({ length: 14 }, (_, index) => ({
    id: `annotation_${index + 1}`,
    scopeKey: 'outline:root',
    reviewRoundId: 'round_1',
    target: { type: 'scope', id: 'outline:root', label: '整份大纲' },
    instruction: `批注 ${index + 1}`,
    lifecycle: 'submitted',
    resolution: index < 7 ? 'resolved' : 'open',
    version: 1,
  }))
  const initialState = {
    project: { id: 'project_test', title: '测试项目', currentRevision: 9 },
    ui: { stage: 'outline', activePageId: null },
    outline: [],
    pages: [],
    annotations,
    reviewRounds: [{ id: 'round_1', scopeKey: 'outline:root' }],
    reviewSubmissions: [
      { id: 'submission_1', reviewRoundId: 'round_1', number: 1, baseRevision: 8, status: 'accepted', annotations: annotations.slice(0, 7) },
      { id: 'submission_2', reviewRoundId: 'round_1', number: 2, baseRevision: 9, status: 'proposal_created', annotations: annotations.slice(7) },
      { id: 'submission_3', reviewRoundId: 'round_1', number: 3, baseRevision: 9, status: 'pending_dispatch', annotations: [] },
      { id: 'submission_4', reviewRoundId: 'round_1', number: 4, baseRevision: 9, status: 'dispatch_failed', annotations: [] },
    ],
    proposals: [
      { id: 'proposal_1', submissionId: 'submission_1', reviewRoundId: 'round_1', baseRevision: 8, status: 'accepted', message: '第一批已应用', commands: [] },
      {
        id: 'proposal_2', submissionId: 'submission_2', reviewRoundId: 'round_1', baseRevision: 9, status: 'pending', message: '第二批待确认', commands: [],
        affectedObjectIds: ['outline_node_2'], aggregateRiskLevel: 'structural_review_required', hasDeletion: true,
        diff: {
          before: [{ objectId: 'outline_node_2', value: { title: '旧标题' } }],
          after: [{ objectId: 'outline_node_2', value: { title: '新标题' } }],
          changes: [{ objectId: 'outline_node_2', changeType: 'modified', before: { title: '旧标题' }, after: { title: '新标题' } }],
        },
      },
    ],
    revisions: [],
  }

  const document = {
    querySelector(selector) {
      if (selector === '[data-proposal-id="proposal_2"]' && reviewHistory.innerHTML.includes('data-proposal-id="proposal_2"')) return proposalNode
      return elements.get(selector) ?? null
    },
    querySelectorAll(selector) {
      if (selector === '.filter-tab') return filters
      return []
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? []
      registered.push(listener)
      listeners.set(type, registered)
    },
  }
  const window = {
    setTimeout() {},
    clearTimeout() {},
    requestAnimationFrame(callback) { callback() },
    confirm() { return true },
  }
  const context = {
    document,
    window,
    fetch: async path => ({
      ok: true,
      async json() {
        if (path === '/api/health') return { ok: true, version: 'v0.1.1', agentConfigured: true }
        if (path === '/api/migration/status') return { status: 'ready' }
        return structuredClone(initialState)
      },
    }),
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    confirm: window.confirm,
    FileReader: class {},
    console,
    structuredClone,
  }

  vm.runInNewContext(appSource, context, { filename: 'app.js' })
  await new Promise(resolve => setImmediate(resolve))
  return { htmlSource, listeners, filters, reviewHistory, proposalAttention, getProposalScrollCount: () => proposalScrollCount }
}

test('pending Proposal is grouped under its exact ReviewSubmission and exposed in the panel header', async () => {
  const { htmlSource, reviewHistory, proposalAttention } = await loadReviewHistory()
  assert.match(htmlSource, /id="proposal-attention"/)
  assert.equal(proposalAttention.hidden, false)
  assert.equal(proposalAttention.textContent, '待确认 1')
  assert.equal(proposalAttention.dataset.focusProposal, 'proposal_2')

  const firstSubmission = reviewHistory.innerHTML.indexOf('data-submission-id="submission_1"')
  const firstProposal = reviewHistory.innerHTML.indexOf('data-proposal-id="proposal_1"')
  const secondSubmission = reviewHistory.innerHTML.indexOf('data-submission-id="submission_2"')
  const secondProposal = reviewHistory.innerHTML.indexOf('data-proposal-id="proposal_2"')
  assert.ok(firstSubmission >= 0 && firstProposal > firstSubmission)
  assert.ok(secondSubmission > firstProposal && secondProposal > secondSubmission)
  assert.match(reviewHistory.innerHTML, /Agent 修改建议/)
  assert.match(reviewHistory.innerHTML, /待确认/)
  for (const metadata of ['基于 Revision 9', '影响对象', 'outline_node_2', 'Before', '旧标题', 'After', '新标题', '结构性变更', '包含删除', '拒绝', '返回 Agent 调整']) {
    assert.match(reviewHistory.innerHTML, new RegExp(metadata))
  }
})

test('pending Proposal stays visible under every annotation filter and can be focused again', async () => {
  const { listeners, filters, reviewHistory, proposalAttention, getProposalScrollCount } = await loadReviewHistory()
  assert.equal(getProposalScrollCount(), 1, 'newest pending Proposal should be revealed once after render')

  const unfinished = filters.find(filter => filter.dataset.filter === 'unfinished')
  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { closest: selector => selector === '[data-filter]' ? unfinished : null } })
  }
  assert.match(reviewHistory.innerHTML, /data-proposal-id="proposal_2"/)
  assert.doesNotMatch(reviewHistory.innerHTML, /data-proposal-id="proposal_1"/)
  assert.equal(getProposalScrollCount(), 1, 'ordinary re-render must not steal the scroll position')

  const completed = filters.find(filter => filter.dataset.filter === 'completed')
  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { closest: selector => selector === '[data-filter]' ? completed : null } })
  }
  assert.match(reviewHistory.innerHTML, /data-proposal-id="proposal_2"/, 'pending Proposal must not disappear under annotation filtering')

  for (const listener of listeners.get('click') ?? []) {
    await listener({ target: { closest: selector => selector === '[data-focus-proposal]' ? proposalAttention : null } })
  }
  assert.equal(getProposalScrollCount(), 2, 'header attention control should reveal the pending Proposal on demand')
})

test('persisted pending and failed submissions both render a continue-dispatch action after reload', async () => {
  const { reviewHistory } = await loadReviewHistory()
  assert.match(reviewHistory.innerHTML, /data-retry-submission="submission_3"[^>]*>继续投递</)
  assert.match(reviewHistory.innerHTML, /data-retry-submission="submission_4"[^>]*>继续投递</)
})
