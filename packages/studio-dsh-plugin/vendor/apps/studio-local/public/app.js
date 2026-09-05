let state = null;
let health = null;
let selectedTarget = null;
let selectedRoundId = null;
let commentFilter = 'all';
let toastTimer = null;
let migration = null;
const revealedProposalIds = new Set();
let draftEditBuffer = null;
let draftAutosaveTimer = null;
let draftFlushPromise = null;
let workspaceSyncState = null;
let ignoredWorkspaceCandidateFingerprint = null;
let workspaceAppliedNotice = null;
let workspaceRefreshPromise = null;
const DRAFT_AUTOSAVE_DELAY = 500;
const WORKSPACE_POLL_DELAY = 2500;

const query = selector => document.querySelector(selector);
const queryAll = selector => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.error && typeof data.error === 'object' ? data.error : null;
    const error = new Error(details?.message || data.error || `HTTP ${response.status}`);
    error.code = details?.code || 'request_failed';
    error.details = details?.details;
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function setSaveStatus(label, saving = false) {
  const element = query('#save-status');
  if (!element) return;
  element.textContent = label;
  element.classList.toggle('saving', saving);
}

function toast(message, error = false) {
  const element = query('#toast');
  if (!element) return;
  window.clearTimeout(toastTimer);
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  toastTimer = window.setTimeout(() => { element.hidden = true; }, 2400);
}

async function action(payload, { renderAfter = true } = {}) {
  setSaveStatus('保存中…', true);
  try {
    const contentAction = ['project.', 'outline.', 'draft.'].some(prefix => String(payload.type).startsWith(prefix));
    const request = contentAction ? { ...payload, baseRevision: payload.baseRevision ?? state.project.currentRevision } : payload;
    state = await api('/api/action', { method: 'POST', body: JSON.stringify(request) });
    if (renderAfter) render();
    setSaveStatus('已保存');
    return state;
  } catch (error) {
    setSaveStatus('保存失败');
    throw error;
  }
}

function buildDraftUpdatePatch(page, { heading, body, listInputs = [], scriptInputs = [], script = '' }) {
  const list = page.contentBlocks?.find(block => block.type === 'list');
  const listItems = list ? listInputs.filter(input => input.listItemId).map((input, index) => {
    const current = list.items.find(item => item.listItemId === input.listItemId);
    return { ...current, content: input.value, order: index };
  }) : null;
  const placeholderListContent = listInputs.find(input => !input.listItemId)?.value.trim() || '';
  const scriptBlocks = page.scriptBlocks?.length ? scriptInputs.map((input, index) => {
    const current = page.scriptBlocks.find(block => block.scriptBlockId === input.scriptBlockId);
    return { ...current, content: input.value, order: index };
  }) : null;
  return {
    heading,
    body,
    ...(list ? { listBlockId: list.contentBlockId, listItems } : {}),
    ...(placeholderListContent ? { listCreateContent: placeholderListContent } : {}),
    ...(scriptBlocks ? { scriptBlocks } : { script }),
  };
}

function createDraftEditBuffer(page) {
  const list = page.contentBlocks?.find(block => block.type === 'list');
  return {
    kind: 'DraftEditBuffer',
    pageId: page.id,
    baseRevision: state.project.currentRevision,
    heading: page.heading ?? '',
    body: page.body ?? '',
    listItems: (list?.items ?? []).map(item => ({ listItemId: item.listItemId, value: item.content })),
    placeholderListContent: list ? '' : (page.bullets?.[0] ?? ''),
    scriptBlocks: (page.scriptBlocks ?? []).map(block => ({ scriptBlockId: block.scriptBlockId, value: block.content })),
    script: page.script ?? '',
    assetCaptions: (page.pageAssets ?? []).map(asset => ({ pageAssetId: asset.pageAssetId, caption: asset.caption })),
    editGeneration: 0,
    dirty: false,
    saveState: 'saved',
    conflict: null,
  };
}

function bufferForPage(page = activePage()) {
  if (!page) return null;
  if (!draftEditBuffer || draftEditBuffer.pageId !== page.id) draftEditBuffer = createDraftEditBuffer(page);
  return draftEditBuffer;
}

function updateDraftBufferFromInput(input) {
  const page = activePage();
  if (!page || !input) return false;
  const buffer = bufferForPage(page);
  if (input.id === 'draft-heading') buffer.heading = input.value;
  else if (input.id === 'draft-body') buffer.body = input.value;
  else if (input.id === 'draft-script') buffer.script = input.value;
  else if (input.dataset?.listItemId !== undefined) {
    const item = buffer.listItems.find(value => value.listItemId === input.dataset.listItemId);
    if (item) item.value = input.value;
    else buffer.placeholderListContent = input.value;
  } else if (input.dataset?.scriptBlockId) {
    const block = buffer.scriptBlocks.find(value => value.scriptBlockId === input.dataset.scriptBlockId);
    if (!block) return false;
    block.value = input.value;
  } else if (input.dataset?.assetCaption) {
    const asset = buffer.assetCaptions.find(value => value.pageAssetId === input.dataset.assetCaption);
    if (!asset) return false;
    asset.caption = input.value;
  } else return false;
  buffer.editGeneration += 1;
  buffer.dirty = true;
  buffer.saveState = 'dirty';
  buffer.conflict = null;
  scheduleDraftAutosave();
  setSaveStatus('未保存');
  return true;
}

function scheduleDraftAutosave() {
  window.clearTimeout(draftAutosaveTimer);
  draftAutosaveTimer = window.setTimeout(() => {
    flushDraftBuffer({ reason: '自动保存' }).catch(() => undefined);
  }, DRAFT_AUTOSAVE_DELAY);
}

function draftPatchFromBuffer(page, buffer) {
  const patch = buildDraftUpdatePatch(page, {
    heading: buffer.heading,
    body: buffer.body,
    listInputs: buffer.listItems.length
      ? buffer.listItems
      : [{ listItemId: '', value: buffer.placeholderListContent }],
    scriptInputs: buffer.scriptBlocks,
    script: buffer.script,
  });
  if (page.pageAssets?.length) {
    patch.pageAssets = page.pageAssets.map(asset => ({
      ...asset,
      caption: buffer.assetCaptions.find(value => value.pageAssetId === asset.pageAssetId)?.caption ?? asset.caption,
    }));
  }
  return patch;
}

async function flushDraftBuffer({ reason = '保存草案' } = {}) {
  if (draftFlushPromise) return draftFlushPromise;
  const buffer = draftEditBuffer;
  if (!buffer?.dirty) return true;
  draftFlushPromise = flushDraftBufferNow(buffer, reason);
  try {
    return await draftFlushPromise;
  } finally {
    draftFlushPromise = null;
  }
}

async function flushDraftBufferNow(buffer, reason) {
  const page = state.pages.find(item => item.id === buffer.pageId);
  if (!page) {
    buffer.saveState = 'failed';
    setSaveStatus('保存失败');
    toast('草案页面已不存在，本地编辑仍被保留；可放弃本地修改。', true);
    render();
    return false;
  }

  window.clearTimeout(draftAutosaveTimer);
  buffer.saveState = 'saving';
  const submittedGeneration = buffer.editGeneration;
  const patch = draftPatchFromBuffer(page, buffer);
  try {
    await action({ type: 'draft.update', pageId: page.id, baseRevision: buffer.baseRevision, patch }, { renderAfter: false });
    buffer.baseRevision = state.project.currentRevision;
    if (buffer.editGeneration !== submittedGeneration) {
      buffer.dirty = true;
      buffer.saveState = 'dirty';
      return flushDraftBufferNow(buffer, reason);
    }
    buffer.dirty = false;
    buffer.saveState = 'saved';
    buffer.conflict = null;
    render();
    setSaveStatus('已保存');
    return true;
  } catch (error) {
    if (error.code === 'stale_revision') {
      const latest = await api('/api/state').catch(() => null);
      if (latest) state = latest;
      const serverPage = latest?.pages?.find(item => item.id === buffer.pageId) ?? null;
      buffer.saveState = 'conflict';
      buffer.conflict = { reason, local: structuredClone(buffer), serverRevision: latest?.project?.currentRevision ?? error.details?.currentRevision ?? null, serverPage };
      setSaveStatus('发生冲突');
      toast('草案保存发生冲突；本地输入已保留，可重试或放弃本地修改。', true);
    } else {
      buffer.saveState = 'failed';
      buffer.conflict = { reason, message: error.message };
      setSaveStatus('保存失败');
      toast('草案未保存，本地输入已保留；可重试或放弃本地修改。', true);
    }
    render();
    return false;
  }
}

async function runAfterDraftFlush(reason, operation) {
  if (!await flushDraftBuffer({ reason })) return null;
  return operation();
}

function discardDraftBuffer() {
  window.clearTimeout(draftAutosaveTimer);
  draftEditBuffer = null;
  setSaveStatus('已放弃本地修改');
  render();
}

function createBrowserUuidV7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) { bytes[index] = Number(timestamp & 255n); timestamp >>= 8n; }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value = '') {
  return escapeHtml(value).replaceAll("'", '&#39;');
}

function workspaceHasDirtyEdits() {
  return Boolean(draftEditBuffer?.dirty || draftFlushPromise || draftEditBuffer?.saveState === 'saving');
}

function workspaceCandidateRevision(status = workspaceSyncState) {
  return status?.candidateSourceRevision ?? status?.sourceRevision ?? null;
}

function workspaceStatusView(status = workspaceSyncState) {
  const code = status?.status || 'watcher_disconnected';
  const candidateRevision = workspaceCandidateRevision(status);
  if (code === 'connected' && workspaceAppliedNotice && status?.appliedFingerprint === workspaceAppliedNotice.fingerprint) {
    return { label: workspaceAppliedNotice.label, tone: 'connected' };
  }
  if (status?.hasUpstreamCandidate && workspaceHasDirtyEdits()) return { label: '本地存在未保存修改', tone: 'dirty' };
  if (code === 'connected') return { label: '已连接', tone: 'connected' };
  if (code === 'validating') return { label: '正在验证', tone: 'validating' };
  if (code === 'upstream_update_available') return { label: candidateRevision == null ? '上游有更新' : `上游有更新 · Pre Revision ${candidateRevision}`, tone: 'upstream' };
  if (code === 'local_dirty_conflict') return { label: '本地存在未保存修改', tone: 'dirty' };
  if (code === 'workspace_contract_invalid') return { label: 'Contract 校验失败', tone: 'error' };
  if (code === 'workspace_project_missing') return { label: 'Workspace 不包含标准项目', tone: 'disconnected' };
  if (code === 'workspace_unavailable') return { label: 'Workspace 不可用', tone: 'disconnected' };
  if (code === 'watcher_disconnected' || code === 'request_failed') return { label: '监听不可用', tone: 'disconnected' };
  return { label: '上游写入尚未完成', tone: 'error' };
}

function shortWorkspaceFingerprint(value) {
  return typeof value === 'string' && value ? value.slice(0, 12) : '—';
}

function workspaceSourceRevisionHtml(status) {
  const revisions = Array.isArray(status?.sourceRevisions) ? status.sourceRevisions : [];
  if (!revisions.length) return '—';
  return revisions.map(item => `${escapeHtml(item.provider || 'unknown')} · ${escapeHtml(item.sourceProjectId || 'unknown')} · Revision ${escapeHtml(item.sourceRevision ?? '—')}`).join('<br>');
}

function workspaceValidationHtml(status) {
  const errors = Array.isArray(status?.validation?.errors) ? status.validation.errors : [];
  if (!errors.length) return '<span>无</span>';
  return `<ul class="workspace-sync-errors">${errors.map(error => {
    const location = [error.filePath, error.instancePath].filter(Boolean).join(' ');
    return `<li><strong>${escapeHtml(error.code || 'validation_error')}</strong>${location ? ` · ${escapeHtml(location)}` : ''}<br>${escapeHtml(error.message || '校验失败')}</li>`;
  }).join('')}</ul>`;
}

function renderWorkspaceStatus(status = workspaceSyncState) {
  const toggle = query('#workspace-sync-toggle');
  const label = query('#workspace-sync-label');
  const details = query('#workspace-sync-details');
  const conflict = query('#workspace-conflict-banner');
  const summary = query('#workspace-update-summary');
  if (!toggle && !label && !details && !conflict) return;

  const view = workspaceStatusView(status);
  if (label) label.textContent = view.label;
  if (toggle) {
    toggle.dataset.status = view.tone;
    toggle.setAttribute('title', view.label);
  }

  const candidateFingerprint = status?.candidateFingerprint ?? null;
  const candidateRevision = workspaceCandidateRevision(status);
  const hasUnignoredDirtyConflict = Boolean(
    status?.hasUpstreamCandidate
    && workspaceHasDirtyEdits()
    && candidateFingerprint
    && ignoredWorkspaceCandidateFingerprint !== candidateFingerprint
  );
  if (conflict) conflict.hidden = !hasUnignoredDirtyConflict;
  if (summary) summary.textContent = candidateRevision == null
    ? `候选快照 ${shortWorkspaceFingerprint(candidateFingerprint)}`
    : `检测到 Pre Revision ${candidateRevision} · 候选快照 ${shortWorkspaceFingerprint(candidateFingerprint)}`;

  if (!details) return;
  const watcherActive = !['watcher_disconnected', 'workspace_unavailable', 'request_failed'].includes(status?.status);
  details.innerHTML = `
    <div class="workspace-sync-row"><span>Workspace</span><span>${escapeHtml(status?.workspaceRoot || '当前页面未绑定 DSH Workspace')}</span></div>
    <div class="workspace-sync-row"><span>Project ID</span><span>${escapeHtml(status?.projectId || '—')}</span></div>
    <div class="workspace-sync-row"><span>标准版本</span><span>${escapeHtml(status?.standardVersion || '0.1.0')}</span></div>
    <div class="workspace-sync-row"><span>当前快照指纹</span><span>${escapeHtml(shortWorkspaceFingerprint(status?.appliedFingerprint ?? status?.fingerprint))}</span></div>
    <div class="workspace-sync-row"><span>候选快照指纹</span><span>${escapeHtml(shortWorkspaceFingerprint(candidateFingerprint))}</span></div>
    <div class="workspace-sync-row"><span>上游 Pre Revision</span><span>${escapeHtml(candidateRevision ?? '—')}</span></div>
    <div class="workspace-sync-row"><span>来源明细</span><span>${workspaceSourceRevisionHtml(status)}</span></div>
    <div class="workspace-sync-row"><span>最近读取时间</span><span>${escapeHtml(status?.readAt || '—')}</span></div>
    <div class="workspace-sync-row"><span>Watcher</span><span>${watcherActive ? '监听中' : '监听已断开'}</span></div>
    <div class="workspace-sync-row"><span>Contract 错误</span><span>${workspaceValidationHtml(status)}</span></div>
  `;
}

function setWorkspacePanel(open) {
  const panel = query('#workspace-sync-panel');
  const toggle = query('#workspace-sync-toggle');
  if (panel) panel.hidden = !open;
  if (toggle) toggle.setAttribute('aria-expanded', String(Boolean(open)));
}

function captureWorkspaceViewport() {
  return {
    pageStripLeft: query('#page-strip')?.scrollLeft ?? 0,
    stageScrollTop: query('#stage-workspace')?.scrollTop ?? 0,
    reviewScrollTop: query('#review-history')?.scrollTop ?? 0,
    annotationScrollTop: query('#annotation-panel')?.scrollTop ?? 0,
  };
}

function restoreWorkspaceViewport(viewport) {
  const restore = () => {
    const strip = query('#page-strip');
    const stage = query('#stage-workspace');
    const review = query('#review-history');
    const annotation = query('#annotation-panel');
    if (strip) strip.scrollLeft = viewport.pageStripLeft;
    if (stage) stage.scrollTop = viewport.stageScrollTop;
    if (review) review.scrollTop = viewport.reviewScrollTop;
    if (annotation) annotation.scrollTop = viewport.annotationScrollTop;
  };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restore);
  else restore();
}

async function adoptWorkspaceResult(result, { revision = workspaceCandidateRevision(workspaceSyncState), label = null } = {}) {
  const viewport = captureWorkspaceViewport();
  state = await api('/api/state');
  draftEditBuffer = null;
  workspaceSyncState = result;
  ignoredWorkspaceCandidateFingerprint = null;
  const fingerprint = result?.appliedFingerprint ?? result?.fingerprint ?? null;
  workspaceAppliedNotice = fingerprint ? {
    fingerprint,
    label: label || (revision == null ? 'Workspace 已更新' : `已更新至 Pre Revision ${revision}`),
  } : null;
  render();
  restoreWorkspaceViewport(viewport);
  return result;
}

async function applyWorkspaceUpdate({ endpoint = '/api/workspace/apply', body = {}, label = null } = {}) {
  const revision = workspaceCandidateRevision(workspaceSyncState);
  setSaveStatus('同步中…', true);
  const result = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
  await adoptWorkspaceResult(result, { revision, label });
  setSaveStatus('已保存');
  return result;
}

async function refreshWorkspaceStatusNow({ allowAutoApply = true } = {}) {
  try {
    const status = await api('/api/workspace/status');
    workspaceSyncState = status;
    if (workspaceAppliedNotice && status?.appliedFingerprint !== workspaceAppliedNotice.fingerprint) workspaceAppliedNotice = null;
    const mayAutoApply = allowAutoApply
      && status?.status === 'upstream_update_available'
      && status?.hasUpstreamCandidate
      && !workspaceHasDirtyEdits();
    if (mayAutoApply) return await applyWorkspaceUpdate();
    renderWorkspaceStatus(status);
    return status;
  } catch (error) {
    workspaceSyncState = {
      status: error.code === 'request_failed' ? 'watcher_disconnected' : error.code,
      workspaceRoot: null,
      projectId: null,
      standardVersion: '0.1.0',
      validation: {
        valid: false,
        errors: [{ code: error.code || 'request_failed', filePath: '', instancePath: '', message: error.message }],
        warnings: [],
      },
      hasUpstreamCandidate: false,
    };
    renderWorkspaceStatus(workspaceSyncState);
    return workspaceSyncState;
  }
}

async function refreshWorkspaceStatus(options = {}) {
  if (workspaceRefreshPromise) return workspaceRefreshPromise;
  workspaceRefreshPromise = refreshWorkspaceStatusNow(options);
  try {
    return await workspaceRefreshPromise;
  } finally {
    workspaceRefreshPromise = null;
  }
}

function stageLabel(stage = state?.ui?.stage) {
  return ({ outline: '大纲阶段', draft: '草案阶段', layout: '排版阶段' })[stage] || stage;
}

function activePage() {
  return state.pages.find(page => page.id === state.ui.activePageId) || state.pages[0] || null;
}

function currentScopeKey() {
  return state.ui.stage === 'draft' && state.ui.activePageId
    ? `draft:${state.ui.activePageId}`
    : 'outline:root';
}

function currentScopeLabel() {
  if (state.ui.stage === 'draft') {
    const page = activePage();
    return page ? `草案 · ${page.heading || '未命名页面'}` : '草案';
  }
  return '整份大纲';
}

function currentPageLabel() {
  const page = activePage();
  if (state.ui.stage !== 'draft' || !page) return '整份大纲';
  const index = state.pages.findIndex(item => item.id === page.id);
  return `第 ${String(index + 1).padStart(2, '0')} 页 · ${page.heading || '未命名页面'}`;
}

function flattenOutline(nodes, depth = 0, result = []) {
  for (const node of nodes) {
    result.push({ node, depth });
    flattenOutline(node.children || [], depth + 1, result);
  }
  return result;
}

function renderPageStrip() {
  const strip = query('#page-strip');
  const visible = ['draft', 'layout'].includes(state.ui.stage) && state.pages.length > 0;
  strip.hidden = !visible;
  if (!visible) {
    strip.innerHTML = '';
    return;
  }

  const page = activePage();
  strip.innerHTML = state.pages.map((item, index) => `
    <button class="page-tab ${item.id === page?.id ? 'active' : ''}" data-page-id="${escapeAttr(item.id)}" type="button" title="${escapeAttr(item.heading || '未命名页面')}">
      <small>PAGE ${String(index + 1).padStart(2, '0')}</small>
      <strong>${escapeHtml(item.heading || '未命名页面')}</strong>
    </button>
  `).join('');
}

function outlineNodeHtml(node, indexPath, depth = 0) {
  const children = (node.children || [])
    .map((child, index) => outlineNodeHtml(child, `${indexPath}.${index + 1}`, depth + 1))
    .join('');
  const linkedPage = state.pages.find(page => page.outlineNodeId === node.id);

  return `
    <article class="outline-node" data-node-id="${escapeAttr(node.id)}" data-depth="${depth}">
      <div class="outline-row">
        <span class="outline-index">${escapeHtml(indexPath)}</span>
        <div class="outline-title-wrap">
          <input class="outline-title" value="${escapeAttr(node.title)}" data-rename-node="${escapeAttr(node.id)}" aria-label="章节 ${escapeAttr(indexPath)} 标题">
          <span class="outline-meta">${linkedPage ? '已生成草案页' : '尚未生成草案页'} · ${(node.children || []).length} 个子级</span>
        </div>
        <div class="node-actions">
          <button class="small-button" data-add-child="${escapeAttr(node.id)}" type="button">＋ 子级</button>
          <button class="small-button" data-create-page="${escapeAttr(node.id)}" type="button">${linkedPage ? '打开草案' : '生成草案'}</button>
          <button class="small-button" data-comment-node="${escapeAttr(node.id)}" data-label="${escapeAttr(node.title)}" type="button">批注</button>
          <button class="small-button" data-move-node="${escapeAttr(node.id)}" data-direction="up" type="button" title="上移">↑</button>
          <button class="small-button" data-move-node="${escapeAttr(node.id)}" data-direction="down" type="button" title="下移">↓</button>
          <button class="small-button danger" data-delete-node="${escapeAttr(node.id)}" type="button">删除</button>
        </div>
      </div>
      ${children ? `<div class="outline-children">${children}</div>` : ''}
    </article>
  `;
}

function renderOutline() {
  const element = query('#outline-stage');
  element.hidden = state.ui.stage !== 'outline';
  if (element.hidden) return;

  const allNodes = flattenOutline(state.outline);
  const linkedPages = state.pages.length;
  const pendingPages = Math.max(0, allNodes.length - linkedPages);

  element.innerHTML = `
    <div class="stage-shell">
      <header class="stage-header">
        <div class="stage-heading">
          <span class="stage-eyebrow">REPORT STRUCTURE</span>
          <h1>大纲阶段</h1>
          <p>先稳定整份汇报的章节关系，再按节点生成草案页面。</p>
        </div>
        <div class="stage-header-actions">
          <button id="add-root" class="primary-button" type="button">＋ 一级章节</button>
        </div>
      </header>

      <div class="outline-body">
        <div class="outline-summary" aria-label="大纲摘要">
          <div class="summary-card"><strong>${allNodes.length}</strong><span>大纲节点</span></div>
          <div class="summary-card"><strong>${linkedPages}</strong><span>已生成草案页</span></div>
          <div class="summary-card"><strong>${pendingPages}</strong><span>待生成页面</span></div>
        </div>
        ${state.outline.length
          ? `<div class="outline-list">${state.outline.map((node, index) => outlineNodeHtml(node, String(index + 1))).join('')}</div>`
          : `<div class="empty-state"><div><strong>从汇报骨架开始</strong><p>点击“一级章节”建立第一条内容主线。章节标题可以直接编辑，随后可生成对应草案页。</p></div></div>`}
      </div>
    </div>
  `;
}

function renderAsset(asset, index) {
  const caption = draftEditBuffer?.assetCaptions.find(item => item.pageAssetId === asset.pageAssetId)?.caption ?? asset.caption ?? '';
  const preview = asset.id && String(asset.mimeType || asset.type || '').startsWith('image/')
    ? `<img src="${escapeAttr(assetContentUrl(asset.id))}" alt="${escapeAttr(asset.name || `素材 ${index + 1}`)}">`
    : `<div class="empty-state" style="min-height:110px;padding:18px"><div><strong>素材预览</strong><p>当前文件没有可显示的图片预览。</p></div></div>`;

  return `
    <article class="asset-item">
      ${preview}
      <div class="asset-item-footer">
        <div class="asset-item-copy">
          <strong>${escapeHtml(asset.name || `素材 ${index + 1}`)}</strong>
          <small>${escapeHtml(asset.type || 'image')}</small>
          <input class="asset-caption-input" data-asset-caption="${escapeAttr(asset.pageAssetId || '')}" value="${escapeAttr(caption)}" aria-label="素材 ${index + 1} 说明">
        </div>
        <button class="small-button" data-remove-asset="${escapeAttr(asset.pageAssetId || '')}" type="button">移出本页</button>
      </div>
    </article>
  `;
}

function renderDraft() {
  const element = query('#draft-stage');
  element.hidden = state.ui.stage !== 'draft';
  if (element.hidden) return;

  const page = activePage();
  if (!page) {
    element.innerHTML = `
      <div class="stage-shell">
        <header class="stage-header">
          <div class="stage-heading"><span class="stage-eyebrow">DRAFT PAGE</span><h1>草案阶段</h1><p>请先在大纲阶段为一个节点生成草案页。</p></div>
        </header>
        <div class="empty-state"><div><strong>暂无草案页面</strong><p>回到大纲阶段，选择一个章节节点并点击“生成草案”。</p></div></div>
      </div>`;
    return;
  }

  const buffer = bufferForPage(page);
  const pageIndex = state.pages.findIndex(item => item.id === page.id);
  const canonicalList = page.contentBlocks?.find(block => block.type === 'list');
  const bulletItems = canonicalList?.items?.length
    ? [...canonicalList.items].sort((left, right) => left.order - right.order).map(item => ({ ...item, content: buffer.listItems.find(value => value.listItemId === item.listItemId)?.value ?? item.content }))
    : (page.bullets?.length ? page.bullets : ['']).map(content => ({ content, listItemId: null }));
  const bullets = bulletItems.map((item, index) => `
    <div class="bullet-row">
      <span class="bullet-index">${String(index + 1).padStart(2, '0')}</span>
      <input data-bullet-index="${index}" data-list-item-id="${escapeAttr(item.listItemId || '')}" value="${escapeAttr(item.content)}" aria-label="第 ${index + 1} 条要点">
      ${item.listItemId ? `<button class="small-button" data-remove-bullet="${escapeAttr(item.listItemId)}" type="button">移除</button>` : ''}
    </div>
  `).join('');
  const scripts = page.scriptBlocks?.length
    ? [...page.scriptBlocks].sort((left, right) => left.order - right.order).map((block, index) => `
      <textarea data-script-block-id="${escapeAttr(block.scriptBlockId)}" class="draft-textarea" rows="7" aria-label="第 ${index + 1} 段讲解稿">${escapeHtml(buffer.scriptBlocks.find(value => value.scriptBlockId === block.scriptBlockId)?.value ?? block.content)}</textarea>`).join('')
    : `<textarea id="draft-script" class="draft-textarea" rows="7">${escapeHtml(buffer.script)}</textarea>`;
  const assets = (page.assets || []).map(renderAsset).join('');

  element.innerHTML = `
    <div class="stage-shell">
      <header class="stage-header">
        <div class="stage-heading">
          <span class="stage-eyebrow">PAGE CONTENT</span>
          <h1>草案阶段</h1>
          <p>完善页面展示内容、讲解稿和本页素材；排版将在 v0.2.0 接入。</p>
        </div>
        <div class="stage-header-actions">
          <button class="ghost-button" data-comment-page="${escapeAttr(page.id)}" type="button">批注本页</button>
        </div>
      </header>

      <div class="draft-body">
        <div class="draft-grid">
          <section class="draft-card">
            <div class="page-content-header">
              <div class="page-content-title">
                <span class="page-number">${String(pageIndex + 1).padStart(2, '0')}</span>
                <div><strong>${escapeHtml(buffer.heading || '未命名页面')}</strong><span>来源节点 ${escapeHtml(page.outlineNodeId)}</span></div>
              </div>
              <span class="version-chip">Revision ${state.project.currentRevision}</span>
            </div>

            <div class="field-block">
              <div class="field-heading"><label for="draft-heading">页面标题</label><span>本页核心结论</span></div>
              <input id="draft-heading" class="draft-input" value="${escapeAttr(buffer.heading)}">
            </div>

            <div class="field-block">
              <div class="field-heading"><label for="draft-body">正文</label><span>页面展示内容</span></div>
              <textarea id="draft-body" class="draft-textarea" rows="8">${escapeHtml(buffer.body)}</textarea>
            </div>

            <div class="field-block">
              <div class="field-heading"><label>要点</label><span>支持逐条编辑</span></div>
              <div id="bullet-list" class="bullet-list">${bullets}</div>
              <button id="add-bullet" class="small-button" type="button" style="margin-top:8px">＋ 增加要点</button>
            </div>

            <div class="field-block">
              <div class="field-heading"><label for="draft-script">讲解稿</label><span>不进入页面展示正文</span></div>
              ${scripts}
            </div>

            <div class="draft-actions">
              <button id="save-draft" class="primary-button" type="button">保存草案</button>
              ${buffer.saveState === 'failed' || buffer.saveState === 'conflict' ? '<button class="small-button" data-retry-draft-buffer type="button">重试保存</button><button class="small-button danger" data-discard-draft-buffer type="button">放弃本地修改</button>' : ''}
            </div>
          </section>

          <aside class="asset-card">
            <header class="asset-card-header"><strong>本页素材</strong><p>图片、图表和其他页面参考素材在同一层级管理。</p></header>
            <label class="asset-upload-label">＋ 上传图片素材<input id="asset-upload" type="file" accept="image/*"></label>
            <div class="asset-list">${assets || '<div class="empty-comments">当前页还没有素材。</div>'}</div>
          </aside>
        </div>
      </div>
    </div>
  `;
}

function filteredAnnotations(annotations) {
  if (commentFilter === 'unfinished') return annotations.filter(item => item.resolution === 'open');
  if (commentFilter === 'completed') return annotations.filter(item => item.resolution === 'resolved');
  return annotations;
}

function annotationHtml(annotation) {
  const resolutionLabel = annotation.resolution === 'resolved' ? '已完成' : '未完成';
  return `
    <article class="comment-card" data-annotation-id="${escapeAttr(annotation.id)}">
      <div class="comment-meta">
        <span class="comment-author"><span class="avatar">我</span>人工批注</span>
        <span class="comment-resolution ${annotation.resolution}">${resolutionLabel}</span>
      </div>
      <div class="comment-target">${escapeHtml(annotation.target?.label || currentScopeLabel())}</div>
      <div class="comment-text">${escapeHtml(annotation.instruction)}</div>
      <div class="comment-card-actions">
        <button class="small-button" data-toggle-resolution="${escapeAttr(annotation.id)}" data-next="${annotation.resolution === 'open' ? 'resolved' : 'open'}" type="button">
          ${annotation.resolution === 'open' ? '标记完成' : '重新打开'}
        </button>
      </div>
    </article>
  `;
}

function submissionHtml(submission) {
  const labels = {
    pending_dispatch: '等待投递', dispatched: '已投递', dispatch_failed: '投递失败',
    proposal_created: 'Proposal 已返回', accepted: '已接受', stale: '已过期',
    rejected: '已拒绝', returned_to_agent: '已返回 Agent',
  };
  return `
    <div class="submission-card">
      <span class="submission-number">${submission.number}</span>
      <div>
        <strong>第 ${submission.number} 次提交</strong>
        <span>baseRevision ${submission.baseRevision} · ${escapeHtml(labels[submission.status] || submission.status)}</span>
        ${submission.lastDispatchError ? `<small class="submission-error">${escapeHtml(submission.lastDispatchError)}</small>` : ''}
        ${['pending_dispatch', 'dispatch_failed'].includes(submission.status) ? `<button class="small-button" data-retry-submission="${escapeAttr(submission.id)}" type="button">继续投递</button>` : ''}
      </div>
    </div>
  `;
}

function assetContentUrl(assetId) {
  const nativePrefix = window.location.pathname.startsWith('/report-studio') ? '/report-studio' : '';
  const url = new URL(`${nativePrefix}/api/assets/${encodeURIComponent(assetId)}/content`, window.location.origin);
  const sessionId = new URLSearchParams(window.location.search).get('sessionId');
  if (nativePrefix && sessionId) url.searchParams.set('sessionId', sessionId);
  return `${url.pathname}${url.search}`;
}

function proposalHtml(proposal) {
  const stale = proposal.status === 'pending' && proposal.baseRevision !== state.project.currentRevision;
  const statusLabel = stale ? '已过期' : ({ pending: '待确认', accepted: '已应用', rejected: '已拒绝', returned_to_agent: '已返回 Agent' })[proposal.status] || proposal.status;
  const riskLabel = ({ ordinary_reversible: '普通可逆', structural_review_required: '结构性变更', protected_or_deferred: '受保护或暂缓' })[proposal.aggregateRiskLevel] || proposal.aggregateRiskLevel || '未标注';
  const affectedObjectIds = proposal.affectedObjectIds ?? [];
  const before = proposal.diff?.before ?? [];
  const after = proposal.diff?.after ?? [];
  return `
    <article class="proposal-card ${proposal.status === 'accepted' ? 'proposal-card-accepted' : ''}" data-proposal-id="${escapeAttr(proposal.id)}" data-proposal-status="${escapeAttr(stale ? 'stale' : proposal.status)}">
      <header><strong>Agent 修改建议</strong><span class="batch-status ${proposal.status === 'accepted' ? 'batch-status-completed' : 'batch-status-review'}">${escapeHtml(statusLabel)}</span></header>
      <p>${escapeHtml(proposal.message || 'Agent 已返回结构化修改建议。')}</p>
      <dl class="proposal-metadata">
        <div><dt>风险</dt><dd>${escapeHtml(riskLabel)}</dd></div>
        <div><dt>影响对象</dt><dd>${affectedObjectIds.length ? affectedObjectIds.map(escapeHtml).join('、') : '无'}</dd></div>
      </dl>
      ${proposal.hasDeletion ? '<p class="proposal-deletion-warning">包含删除：接受前请确认对象移除范围。</p>' : ''}
      <div class="proposal-diff">
        <section><strong>Before</strong><pre>${escapeHtml(JSON.stringify(before, null, 2))}</pre></section>
        <section><strong>After</strong><pre>${escapeHtml(JSON.stringify(after, null, 2))}</pre></section>
      </div>
      <details><summary>查看 Command</summary><pre>${escapeHtml(JSON.stringify(proposal.commands, null, 2))}</pre></details>
      <small class="proposal-revision">基于 Revision ${proposal.baseRevision}${stale ? ' · 当前项目已前进，不能应用' : ''}</small>
      ${proposal.status === 'pending'
        ? `<div class="proposal-actions"><button class="primary-button batch-submit" data-accept-proposal="${escapeAttr(proposal.id)}" type="button" ${stale ? 'disabled' : ''}>${stale ? 'Proposal 已过期' : '确认应用'}</button><button class="small-button danger" data-reject-proposal="${escapeAttr(proposal.id)}" type="button">拒绝</button><button class="small-button" data-return-proposal="${escapeAttr(proposal.id)}" type="button">返回 Agent 调整</button></div>`
        : ''}
    </article>
  `;
}

function proposalVisibleForFilter(proposal) {
  if (proposal.status === 'pending') return true;
  if (commentFilter === 'all') return true;
  if (commentFilter === 'unfinished') return proposal.status !== 'accepted';
  return proposal.status === 'accepted';
}

function submissionVisibleForFilter(submission, proposal) {
  if (commentFilter === 'all') return true;
  if (proposal) return proposalVisibleForFilter(proposal);
  const unfinished = ['pending_dispatch', 'dispatched', 'dispatch_failed', 'proposal_created', 'stale'].includes(submission.status);
  return commentFilter === 'unfinished' ? unfinished : submission.status === 'accepted';
}

function submissionGroupHtml(submission, proposal) {
  return `
    <section class="submission-group" data-submission-id="${escapeAttr(submission.id)}">
      ${submissionHtml(submission)}
      ${proposal ? proposalHtml(proposal) : ''}
    </section>
  `;
}

function revealProposal(proposalId, force = false) {
  if (!proposalId || (!force && revealedProposalIds.has(proposalId))) return;
  revealedProposalIds.add(proposalId);
  window.requestAnimationFrame(() => {
    const proposal = query(`[data-proposal-id="${proposalId}"]`);
    if (!proposal) return;
    const focusTarget = proposal.querySelector('[data-accept-proposal]') ?? proposal;
    focusTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    proposal.classList.toggle('proposal-revealed', true);
    window.setTimeout(() => proposal.classList.toggle('proposal-revealed', false), 1600);
  });
}

function batchStats(annotations) {
  return {
    completed: annotations.filter(item => item.resolution === 'resolved').length,
    unfinished: annotations.filter(item => item.resolution === 'open').length,
  };
}

function renderAnnotations() {
  const scopeKey = currentScopeKey();
  const scopeRounds = state.reviewRounds.filter(round => round.scopeKey === scopeKey);
  if (selectedRoundId && !scopeRounds.some(round => round.id === selectedRoundId)) selectedRoundId = null;

  const annotations = state.annotations.filter(annotation => annotation.scopeKey === scopeKey);
  const visibleAnnotations = filteredAnnotations(annotations);
  const unfinishedCount = annotations.filter(annotation => annotation.resolution === 'open').length;
  const scopeRoundIds = new Set(scopeRounds.map(round => round.id));
  const pendingProposals = state.proposals.filter(proposal => scopeRoundIds.has(proposal.reviewRoundId) && proposal.status === 'pending');
  const newestPendingProposal = pendingProposals.at(-1) ?? null;

  query('#scope-label').textContent = currentScopeLabel();
  query('#annotation-count').textContent = unfinishedCount;
  const proposalAttention = query('#proposal-attention');
  proposalAttention.hidden = pendingProposals.length === 0;
  proposalAttention.textContent = `待确认 ${pendingProposals.length}`;
  proposalAttention.dataset.focusProposal = newestPendingProposal?.id ?? '';
  query('#annotation-target').textContent = selectedTarget
    ? `已定位：${selectedTarget.label}`
    : `未选择对象，将批注${currentScopeLabel()}`;
  query('#composer-title').textContent = selectedRoundId ? '单条批注（继续当前轮次）' : '单条批注（加入本轮）';
  query('#clear-composer-round').hidden = !selectedRoundId;
  queryAll('.filter-tab').forEach(button => button.classList.toggle('active', button.dataset.filter === commentFilter));

  const html = [];
  const currentAll = annotations.filter(annotation => !annotation.reviewRoundId && annotation.resolution === 'open');
  const currentVisible = filteredAnnotations(currentAll);
  if (currentVisible.length) {
    html.push(`
      <section class="comment-batch comment-batch-current">
        <header class="comment-batch-header">
          <div class="batch-heading"><strong>本轮未提交</strong><small>${currentAll.length} 条未完成批注，提交后将创建新的 ReviewRound。</small></div>
          <div class="batch-actions">
            <span class="batch-status batch-status-staged">待提交</span>
            <button id="submit-review" class="primary-button batch-submit" data-submit-round="" type="button">提给Agent</button>
          </div>
        </header>
        <div class="comment-batch-body">${currentVisible.map(annotationHtml).join('')}</div>
      </section>
    `);
  }

  for (const round of scopeRounds.slice().reverse()) {
    const roundAnnotations = annotations.filter(annotation => annotation.reviewRoundId === round.id);
    const visibleRoundAnnotations = visibleAnnotations.filter(annotation => annotation.reviewRoundId === round.id);
    const submissions = state.reviewSubmissions
      .filter(submission => submission.reviewRoundId === round.id)
      .sort((left, right) => left.number - right.number);
    const proposals = state.proposals.filter(proposal => proposal.reviewRoundId === round.id);
    const proposalsBySubmission = new Map(proposals.map(proposal => [proposal.submissionId, proposal]));
    const visibleSubmissionGroups = submissions
      .map(submission => ({ submission, proposal: proposalsBySubmission.get(submission.id) ?? null }))
      .filter(({ submission, proposal }) => submissionVisibleForFilter(submission, proposal));
    const orphanProposals = proposals.filter(proposal => !submissions.some(submission => submission.id === proposal.submissionId) && proposalVisibleForFilter(proposal));
    const pendingDrafts = roundAnnotations.filter(annotation => annotation.lifecycle === 'draft' && annotation.resolution === 'open');
    const stats = batchStats(roundAnnotations);
    const completed = stats.unfinished === 0 && roundAnnotations.length > 0;
    if (commentFilter !== 'all' && !visibleRoundAnnotations.length && !visibleSubmissionGroups.length && !orphanProposals.length) continue;

    html.push(`
      <section class="comment-batch">
        <header class="comment-batch-header">
          <div class="batch-heading">
            <strong>批注轮次 · ${escapeHtml(round.id.slice(-5))}</strong>
            <small>已完成 ${stats.completed} · 未完成 ${stats.unfinished} · 已提交 ${submissions.length} 次</small>
          </div>
          <div class="batch-actions">
            <span class="batch-status ${completed ? 'batch-status-completed' : 'batch-status-review'}">${completed ? '已完成' : '处理中'}</span>
            ${pendingDrafts.length
              ? `<button class="primary-button batch-submit" data-submit-round="${escapeAttr(round.id)}" type="button">提给Agent</button>`
              : `<button class="small-button" data-continue-round="${escapeAttr(round.id)}" type="button">继续本轮</button>`}
          </div>
        </header>
        <div class="comment-batch-body">
          ${visibleRoundAnnotations.map(annotationHtml).join('') || '<div class="empty-comments">当前筛选下没有批注。</div>'}
          ${visibleSubmissionGroups.map(({ submission, proposal }) => submissionGroupHtml(submission, proposal)).join('')}
          ${orphanProposals.map(proposal => `<section class="submission-group submission-group-orphan"><small>未找到对应的提交记录</small>${proposalHtml(proposal)}</section>`).join('')}
        </div>
      </section>
    `);
  }

  query('#review-history').innerHTML = html.join('') || '<div class="empty-comments">当前作用域在此筛选下没有批注。</div>';
  if (newestPendingProposal) revealProposal(newestPendingProposal.id);
}

function renderAgent() {
  query('#agent-status').textContent = health?.agentConfigured
    ? 'DSH Bridge 已配置'
    : 'DSH Bridge 未配置 · 可正常人工编辑';
  query('#agent-context-stage').textContent = stageLabel();
  query('#agent-context-page').textContent = currentPageLabel();
  const projectContext = query('#agent-context-project');
  if (projectContext) projectContext.textContent = state.project.title;

  const reviewStatus = status => ({
    pending_dispatch: '等待投递',
    dispatched: '已投递',
    dispatch_failed: '投递失败',
    proposal_created: 'Proposal 已返回',
    accepted: 'Proposal 已接受',
    rejected: 'Proposal 已拒绝',
    stale: 'Proposal 已过期',
  })[status] || status || '状态未知';

  const taskPhase = phase => ({
    queued: '排队中',
    reading_context: '读取基线',
    processing: '处理中',
    proposal_created: '等待确认',
    completed: '已完成',
    failed: '处理失败',
    timed_out: '已超时',
  })[phase] || phase || '未启动';

  const items = [
    ...state.reviewSubmissions.slice(-12).map(submission => ({
      time: submission.createdAt,
      html: `<div class="agent-message system"><strong>系统 · 批注提交 #${submission.number}</strong><br>Round ${escapeHtml(submission.reviewRoundId.slice(-5))} · Revision ${submission.baseRevision}${submission.agentMessage ? `<br>${escapeHtml(submission.agentMessage)}` : ''}<span class="agent-message-meta">结构化 ReviewSubmission · ${escapeHtml(reviewStatus(submission.status))}</span></div>`,
    })),
    ...(state.reviewRuns ?? []).slice(-12).map(run => ({
      time: run.createdAt || '',
      html: `<div class="agent-message ${run.integrationState === 'dispatch_failed' ? 'error' : 'system'}"><strong>批注任务 · ${escapeHtml(run.taskId || `第 ${Number(run.dispatchAttempt || 1)} 次投递`)}</strong><br>${escapeHtml(taskPhase(run.phase))} · ${escapeHtml(reviewStatus(run.integrationState))}${run.summary ? `<br>${escapeHtml(run.summary)}` : ''}${run.lastError ? `<br>${escapeHtml(run.lastError)}` : ''}<span class="agent-message-meta">${run.closedAt ? '任务已结束' : run.integrationState === 'dispatch_failed' ? '可重试' : '等待本轮确认'}</span></div>`,
    })),
    ...state.proposals.slice(-12).map(proposal => ({
      time: proposal.createdAt,
      html: `<div class="agent-message proposal"><strong>Agent · ${escapeHtml(proposal.message || '已返回修改建议')}</strong><br>Proposal ${escapeHtml(proposal.id.slice(-5))}<span class="agent-message-meta">${escapeHtml(proposal.status)}</span></div>`,
    })),
  ].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));

  const welcome = `
    <div class="agent-welcome">
      <strong>项目级 Agent 会话</strong>
      <p>${escapeHtml(state.project.title)} · ${health?.agentConfigured
        ? '普通提问和批注任务进入当前 DSH Session。此处只显示持久化的评审状态；完整对话请在 DSH 原生时间线查看。'
        : '当前未配置 DSH Bridge。大纲、草案、批注、Revision 与持久化仍可正常人工使用。'}</p>
    </div>`;
  query('#agent-feed').innerHTML = welcome + items.map(item => item.html).join('');
}

function render() {
  query('#project-title').value = state.project.title;
  query('#revision-number').textContent = state.project.currentRevision;
  queryAll('.stage-tab').forEach(button => button.classList.toggle('active', button.dataset.stage === state.ui.stage));
  query('#stage-workspace')?.classList.toggle('layout-workspace-active', state.ui.stage === 'layout');
  renderPageStrip();
  renderOutline();
  renderDraft();
  renderAnnotations();
  renderAgent();
  renderWorkspaceStatus();
  window.reportStudioLayoutSync?.(structuredClone(state));
}

window.reportStudioApplyExternalState = nextState => {
  if (!nextState?.project || !Array.isArray(nextState.pages)) return;
  state = nextState;
  render();
};

async function saveDraft() {
  const saved = await flushDraftBuffer({ reason: '显式保存' });
  if (saved) toast('草案已保存');
}

async function submitReview(reviewRoundId = selectedRoundId) {
  if (!await flushDraftBuffer({ reason: '提交 ReviewSubmission' })) return;
  try {
    setSaveStatus('提交中…', true);
    const result = await api('/api/review/submit', {
      method: 'POST',
      body: JSON.stringify({ scopeKey: currentScopeKey(), reviewRoundId: reviewRoundId || null }),
    });
    state = result.state;
    selectedRoundId = result.round.id;
    if (result.bridgeResult?.proposalId) toast('Agent 已返回 Proposal');
    else if (!health.agentConfigured) toast('批注已冻结；DSH Bridge 未配置');
    else toast('已提给 Agent');
    setSaveStatus('已保存');
    render();
  } catch (error) {
    if (error.code === 'dispatch_failed') state = error.payload?.state ?? await api('/api/state');
    setSaveStatus('提交失败');
    toast(error.message, true);
    render();
  }
}

function appendTransientAgentStatus({ kind, title, text, status }) {
  const feed = query('#agent-feed');
  const className = kind === 'user' ? 'user' : kind === 'error' ? 'error' : 'system';
  feed.innerHTML += `<div class="agent-message ${className}" data-agent-transient="true"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(text)}<span class="agent-message-meta">${escapeHtml(status)}</span></div>`;
}

function setAgentBackgroundBlocked(blocked) {
  for (const selector of ['#app', '#agent-fab']) {
    const node = query(selector);
    if (!node) continue;
    node.inert = blocked;
    if (blocked) node.setAttribute('aria-hidden', 'true');
    else node.removeAttribute('aria-hidden');
  }
}

function agentModalFocusableElements() {
  const modal = query('#agent-modal');
  if (!modal) return [];
  return [...modal.querySelectorAll('button:not(.modal-backdrop):not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(node => !node.hidden);
}

function openAgent() {
  query('#agent-modal').hidden = false;
  query('#agent-fab').setAttribute('aria-expanded', 'true');
  setAgentBackgroundBlocked(true);
  renderAgent();
  window.requestAnimationFrame(() => query('#agent-input')?.focus());
}

function closeAgent() {
  query('#agent-modal').hidden = true;
  setAgentBackgroundBlocked(false);
  query('#agent-fab').setAttribute('aria-expanded', 'false');
  query('#agent-fab').focus();
}

document.addEventListener('click', async event => {
  if (event.target.closest('#workspace-sync-toggle')) {
    setWorkspacePanel(query('#workspace-sync-panel')?.hidden !== false);
    return;
  }

  if (event.target.closest('[data-workspace-close-panel]')) {
    setWorkspacePanel(false);
    return;
  }

  if (event.target.closest('[data-workspace-view-update]')) {
    setWorkspacePanel(true);
    return;
  }

  if (event.target.closest('[data-workspace-keep-current]')) {
    ignoredWorkspaceCandidateFingerprint = workspaceSyncState?.candidateFingerprint ?? null;
    renderWorkspaceStatus();
    toast('已暂时保留当前版本；新的上游快照仍会再次提示。');
    return;
  }

  if (event.target.closest('[data-workspace-save-reload]')) {
    if (!await flushDraftBuffer({ reason: '保存后重新加载 Workspace' })) return;
    try {
      await applyWorkspaceUpdate({ endpoint: '/api/workspace/reload', body: { dirty: false } });
      toast('本地编辑已保存，Workspace 已重新加载。');
    } catch (error) {
      setSaveStatus('同步失败');
      toast(error.message, true);
      await refreshWorkspaceStatus({ allowAutoApply: false });
    }
    return;
  }

  if (event.target.closest('[data-workspace-discard-reload]')) {
    window.clearTimeout(draftAutosaveTimer);
    draftEditBuffer = null;
    try {
      await applyWorkspaceUpdate();
      toast('本地未保存修改已放弃，Workspace 已重新加载。');
    } catch (error) {
      setSaveStatus('同步失败');
      toast(error.message, true);
      await refreshWorkspaceStatus({ allowAutoApply: false });
    }
    return;
  }

  if (event.target.closest('[data-workspace-reload]')) {
    try {
      const dirty = workspaceHasDirtyEdits();
      if (dirty) {
        workspaceSyncState = await api('/api/workspace/reload', { method: 'POST', body: JSON.stringify({ dirty: true }) });
        workspaceAppliedNotice = null;
        renderWorkspaceStatus();
        toast(workspaceSyncState.hasUpstreamCandidate ? '检测到上游更新，请先处理未保存修改。' : 'Workspace 已重新读取。');
      } else {
        await applyWorkspaceUpdate({ endpoint: '/api/workspace/reload', body: { dirty: false }, label: 'Workspace 已重新读取' });
        toast('Workspace 已重新读取。');
      }
    } catch (error) {
      setSaveStatus('同步失败');
      toast(error.message, true);
      await refreshWorkspaceStatus({ allowAutoApply: false });
    }
    return;
  }

  const stage = event.target.closest('[data-stage]:not(:disabled)');
  if (stage) {
    await runAfterDraftFlush('切换阶段', async () => {
      selectedTarget = null;
      selectedRoundId = null;
      await action({ type: 'ui.setStage', stage: stage.dataset.stage });
    });
    return;
  }

  const pageTab = event.target.closest('[data-page-id]');
  if (pageTab) {
    await runAfterDraftFlush('切换页面', async () => {
      selectedTarget = null;
      selectedRoundId = null;
      await action({ type: 'ui.setPage', pageId: pageTab.dataset.pageId });
    });
    return;
  }

  const filter = event.target.closest('[data-filter]');
  if (filter) {
    commentFilter = filter.dataset.filter;
    renderAnnotations();
    return;
  }

  const proposalAttention = event.target.closest('[data-focus-proposal]');
  if (proposalAttention?.dataset.focusProposal) {
    revealProposal(proposalAttention.dataset.focusProposal, true);
    return;
  }

  if (event.target.id === 'add-root') {
    await runAfterDraftFlush('结构操作', () => action({ type: 'outline.add', parentId: null, title: '新章节' }));
    return;
  }

  const addChild = event.target.closest('[data-add-child]');
  if (addChild) {
    await runAfterDraftFlush('结构操作', () => action({ type: 'outline.add', parentId: addChild.dataset.addChild, title: '新子章节' }));
    return;
  }

  const createPage = event.target.closest('[data-create-page]');
  if (createPage) {
    await runAfterDraftFlush('打开或生成草案', async () => {
      selectedTarget = null;
      selectedRoundId = null;
      const existingPage = state.pages.find(page => page.outlineNodeId === createPage.dataset.createPage);
      if (existingPage) {
        await action({ type: 'ui.setPage', pageId: existingPage.id });
        await action({ type: 'ui.setStage', stage: 'draft' });
      } else {
        await action({ type: 'draft.ensurePage', outlineNodeId: createPage.dataset.createPage });
      }
    });
    return;
  }

  const move = event.target.closest('[data-move-node]');
  if (move) {
    await runAfterDraftFlush('结构操作', () => action({ type: 'outline.move', nodeId: move.dataset.moveNode, direction: move.dataset.direction }));
    return;
  }

  const deleteNode = event.target.closest('[data-delete-node]');
  if (deleteNode && window.confirm('删除该章节、全部子章节及其关联草案页？此操作会生成新的 Revision。')) {
    await runAfterDraftFlush('结构操作', () => action({ type: 'outline.delete', nodeId: deleteNode.dataset.deleteNode }));
    return;
  }

  if (event.target.id === 'save-draft') {
    await saveDraft();
    return;
  }

  if (event.target.closest('[data-retry-draft-buffer]')) {
    if (draftEditBuffer) {
      draftEditBuffer.baseRevision = state.project.currentRevision;
      draftEditBuffer.dirty = true;
      draftEditBuffer.saveState = 'dirty';
    }
    await flushDraftBuffer({ reason: '重试草案保存' });
    return;
  }

  if (event.target.closest('[data-discard-draft-buffer]')) {
    discardDraftBuffer();
    return;
  }

  if (event.target.id === 'add-bullet') {
    const page = activePage();
    const items = page.contentBlocks?.find(block => block.type === 'list')?.items ?? [];
    await runAfterDraftFlush('编辑要点结构', () => action({ type: 'draft.list.insert', pageId: page.id, afterListItemId: items.at(-1)?.listItemId ?? null, content: '' }));
    return;
  }

  const removeBullet = event.target.closest('[data-remove-bullet]');
  if (removeBullet) {
    const page = activePage();
    await runAfterDraftFlush('编辑要点结构', () => action({ type: 'draft.list.delete', pageId: page.id, listItemId: removeBullet.dataset.removeBullet }));
    return;
  }

  const commentNode = event.target.closest('[data-comment-node]');
  if (commentNode) {
    selectedTarget = {
      type: 'outline-node',
      id: commentNode.dataset.commentNode,
      label: commentNode.dataset.label,
    };
    renderAnnotations();
    query('#annotation-input').focus();
    return;
  }

  const commentPage = event.target.closest('[data-comment-page]');
  if (commentPage) {
    const page = activePage();
    selectedTarget = { type: 'page', id: page.id, label: page.heading || '当前页' };
    renderAnnotations();
    query('#annotation-input').focus();
    return;
  }

  const continueRound = event.target.closest('[data-continue-round]');
  if (continueRound) {
    selectedRoundId = continueRound.dataset.continueRound;
    selectedTarget = null;
    renderAnnotations();
    query('#annotation-input').focus();
    toast('后续批注将继续加入该轮');
    return;
  }

  if (event.target.id === 'clear-composer-round') {
    selectedRoundId = null;
    selectedTarget = null;
    renderAnnotations();
    return;
  }

  const toggleResolution = event.target.closest('[data-toggle-resolution]');
  if (toggleResolution) {
    await action({
      type: 'annotation.update',
      annotationId: toggleResolution.dataset.toggleResolution,
      resolution: toggleResolution.dataset.next,
    });
    return;
  }

  const acceptProposal = event.target.closest('[data-accept-proposal]');
  if (acceptProposal) {
    if (!await flushDraftBuffer({ reason: '应用 Proposal' })) return;
    try {
      setSaveStatus('应用中…', true);
      const result = await api(`/api/proposal/${acceptProposal.dataset.acceptProposal}/accept`, {
        method: 'POST',
        body: '{}',
      });
      state = result.state;
      setSaveStatus('已保存');
      toast(`已应用到 Revision ${result.revision.number}`);
      render();
    } catch (error) {
      setSaveStatus('应用失败');
      toast(error.message, true);
    }
    return;
  }

  const retrySubmission = event.target.closest('[data-retry-submission]');
  if (retrySubmission) {
    if (!await flushDraftBuffer({ reason: '刷新 Proposal' })) return;
    try {
      setSaveStatus('重新投递中…', true);
      const result = await api(`/api/review/${retrySubmission.dataset.retrySubmission}/retry`, { method: 'POST', body: '{}' });
      state = result.state ?? await api('/api/state');
      setSaveStatus('已保存');
      toast(result.bridgeResult?.message || '已重新投递');
      render();
    } catch (error) {
      state = error.payload?.state ?? await api('/api/state');
      setSaveStatus('投递失败');
      toast(error.message, true);
      render();
    }
    return;
  }

  const rejectProposal = event.target.closest('[data-reject-proposal]');
  const returnProposal = event.target.closest('[data-return-proposal]');
  if (rejectProposal || returnProposal) {
    if (!await flushDraftBuffer({ reason: rejectProposal ? '拒绝 Proposal' : '返回 Agent 调整' })) return;
    const proposalId = (rejectProposal || returnProposal).dataset[rejectProposal ? 'rejectProposal' : 'returnProposal'];
    const operation = rejectProposal ? 'reject' : 'return';
    try {
      setSaveStatus('处理中…', true);
      const result = await api(`/api/proposal/${proposalId}/${operation}`, { method: 'POST', body: '{}' });
      state = result.state;
      setSaveStatus('已保存');
      toast(rejectProposal ? '已拒绝 Proposal' : '已返回 Agent 调整');
      render();
    } catch (error) {
      setSaveStatus('处理失败');
      toast(error.message, true);
    }
    return;
  }

  if (event.target.id === 'standard-project-open') {
    query('#standard-project-modal').hidden = false;
    return;
  }

  if (event.target.closest('[data-close-standard-modal]')) {
    query('#standard-project-modal').hidden = true;
    return;
  }

  if (event.target.id === 'standard-import') {
    const projectRoot = query('#standard-import-path').value.trim();
    if (!projectRoot) return toast('请输入标准项目绝对路径。', true);
    if (!await flushDraftBuffer({ reason: '导入标准项目' })) return;
    try {
      const result = await api('/api/standard/import', { method: 'POST', body: JSON.stringify({ projectRoot }) });
      state = result.state;
      query('#standard-project-result').textContent = `导入完成 · Revision ${state.project.currentRevision} · Contract 校验通过`;
      toast('标准项目已导入');
      render();
    } catch (error) {
      query('#standard-project-result').textContent = `导入失败：${error.message}`;
      toast(error.message, true);
    }
    return;
  }

  if (event.target.id === 'standard-export') {
    if (!await flushDraftBuffer({ reason: '导出标准项目' })) return;
    try {
      const result = await api('/api/standard/export', { method: 'POST', body: '{}' });
      query('#standard-project-result').textContent = `导出完成 · Revision ${result.revision} · ${result.projectRoot}`;
      toast('标准项目已导出并通过 Contract 校验');
    } catch (error) {
      query('#standard-project-result').textContent = `导出失败：${error.message}`;
      toast(error.message, true);
    }
    return;
  }

  if (event.target.id === 'migration-apply') {
    const button = event.target;
    button.disabled = true;
    query('#migration-detail').textContent = '正在备份、迁移并校验…';
    try {
      const result = await api('/api/migration/apply', { method: 'POST', body: '{}' });
      query('#migration-detail').textContent = `升级完成 · 备份：${result.backupPath}`;
      await load();
      toast('旧项目已安全升级');
    } catch (error) {
      button.disabled = false;
      query('#migration-detail').textContent = `升级失败：${error.message}`;
      toast(error.message, true);
    }
    return;
  }

  if (event.target.id === 'add-annotation') {
    const text = query('#annotation-input').value.trim();
    if (!text) return;
    try {
      if (!await flushDraftBuffer({ reason: '创建批注' })) return;
      await action({
        type: 'annotation.add',
        scopeKey: currentScopeKey(),
        reviewRoundId: selectedRoundId,
        target: selectedTarget || { type: 'scope', id: currentScopeKey(), label: currentScopeLabel() },
        instruction: text,
      });
      query('#annotation-input').value = '';
      selectedTarget = null;
      toast('批注已自动保存');
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const submitRound = event.target.closest('[data-submit-round]');
  if (submitRound) {
    await submitReview(submitRound.dataset.submitRound || null);
    return;
  }

  if (event.target.closest('#agent-fab')) {
    openAgent();
    return;
  }

  if (event.target.id === 'agent-close' || event.target.closest('[data-close-agent-modal]')) {
    closeAgent();
    return;
  }

  if (event.target.id === 'agent-send') {
    const text = query('#agent-input').value.trim();
    if (!text) return;
    appendTransientAgentStatus({ kind: 'user', title: '你', text, status: '本次窗口临时显示' });
    try {
      await api('/api/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ text, stage: state.ui.stage, pageId: state.ui.activePageId }),
      });
      query('#agent-input').value = '';
      appendTransientAgentStatus({
        kind: 'system',
        title: '系统 · 已排队',
        text: '已交给当前 DSH Session 处理。',
        status: '完整对话请在 DSH 原生时间线查看',
      });
      toast('已排队到当前 DSH Session');
    } catch (error) {
      appendTransientAgentStatus({
        kind: 'error',
        title: '错误',
        text: error.message,
        status: '普通聊天投递失败 · 可重试',
      });
      toast(error.message, true);
    }
    return;
  }

  const removeAsset = event.target.closest('[data-remove-asset]');
  if (removeAsset) {
    const page = activePage();
    const pageAssets = (page.pageAssets || []).filter(asset => asset.pageAssetId !== removeAsset.dataset.removeAsset);
    const removed = await runAfterDraftFlush('移除素材', () => action({ type: 'draft.update', pageId: page.id, patch: { pageAssets } }));
    if (removed) toast('素材已移出本页');
  }
});

document.addEventListener('change', async event => {
  const renameNode = event.target.closest('[data-rename-node]');
  if (renameNode) {
    try {
      await runAfterDraftFlush('结构操作', () => action({ type: 'outline.rename', nodeId: renameNode.dataset.renameNode, title: renameNode.value }));
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  if (event.target.id === 'project-title') {
    try {
      await runAfterDraftFlush('修改项目名称', () => action({ type: 'project.rename', title: event.target.value }));
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  if (event.target.id === 'asset-upload' && event.target.files?.[0]) {
    const file = event.target.files[0];
    if (file.size > 20 * 1024 * 1024) {
      toast('单个素材请控制在 20 MiB 以内', true);
      return;
    }
    const page = activePage();
    try {
      if (!await flushDraftBuffer({ reason: '上传素材' })) return;
      setSaveStatus('上传素材中…', true);
      await api(`/api/assets/ingest?pageId=${encodeURIComponent(page.id)}`, { method: 'POST', headers: { 'content-type': file.type, 'x-file-name': file.name }, body: file });
      state = await api('/api/state');
      setSaveStatus('已保存');
      toast('素材已加入本页');
      render();
    } catch (error) { setSaveStatus('上传失败'); toast(error.message, true); }
  }
});

document.addEventListener('input', event => {
  updateDraftBufferFromInput(event.target);
});

window.addEventListener?.('beforeunload', event => {
  if (!draftEditBuffer?.dirty) return undefined;
  event.preventDefault?.();
  event.returnValue = '草案尚未保存。';
  return event.returnValue;
});

document.addEventListener('keydown', async event => {
  if (!query('#agent-modal').hidden) {
    if (event.key === 'Escape') {
      event.preventDefault?.();
      closeAgent();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = agentModalFocusableElements();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      const outside = !focusable.includes(document.activeElement);
      if ((event.shiftKey && (document.activeElement === first || outside)) || (!event.shiftKey && (document.activeElement === last || outside))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
      return;
    }
  }

  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    if (state.ui.stage === 'draft' && query('#draft-heading')) {
      event.preventDefault();
      await saveDraft();
    }
  }
});

async function load() {
  [health, migration, state] = await Promise.all([api('/api/health'), api('/api/migration/status'), api('/api/state')]);
  const migrationGate = query('#migration-gate');
  migrationGate.hidden = migration.status !== 'migration_required';
  if (!migrationGate.hidden) {
    query('#migration-detail').textContent = `来源：${migration.sourcePath} · 原数据保持只读`;
    query('#migration-apply').disabled = false;
  }
  render();
  setSaveStatus(migration.status === 'migration_required' ? '等待升级' : '已保存');
  await refreshWorkspaceStatus();
}

load()
  .then(() => window.setInterval?.(() => { void refreshWorkspaceStatus(); }, WORKSPACE_POLL_DELAY))
  .catch(error => toast(`启动失败：${error.message}`, true));
