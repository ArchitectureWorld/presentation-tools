(function startReportStudioPrototype() {
  'use strict'

  const Core = window.StudioCore
  const AdapterModule = window.MockStudioAdapter
  if (!Core || !AdapterModule) throw new Error('Report Studio 核心脚本未加载')

  const adapter = AdapterModule.createMockStudioAdapter({ seedComments: true })
  let state = adapter.getState()
  let currentFilter = 'all'
  let toastTimer = null
  let lastPayload = null
  let selectionPopoverTarget = null
  let lastTextSelectionAt = 0
  let dragState = null
  let activeComposerRoundId = null
  let editingCommentId = null
  let pageContentEdit = null
  let renderedCommentScopeKey = null
  let agentChatOpen = false
  let agentChatMessageSeq = 4
  let agentChatMessages = createSeedAgentChatMessages()
  let agentFabDrag = null
  let suppressAgentFabClick = false
  const agentReplyTimers = new Set()
  const commentScrollTopByScope = new Map()
  const AGENT_FAB_STORAGE_KEY = 'report-studio.agent-fab-position.v1'
  const collapsedOutline = new Set(
    state.outline.filter(section => !section.expanded).map(section => section.id),
  )

  const el = {
    projectTitle: document.getElementById('project-title'),
    saveStatus: document.getElementById('save-status'),
    pageStrip: document.getElementById('page-strip'),
    stageWorkspace: document.getElementById('stage-workspace'),
    commentScopeTitle: document.getElementById('comment-scope-title'),
    commentScopeHint: document.getElementById('comment-scope-hint'),
    commentCount: document.getElementById('comment-count'),
    commentScrollRegion: document.querySelector('[data-comment-scroll-region]'),
    commentList: document.getElementById('comment-list'),
    selectedTarget: document.getElementById('selected-target'),
    commentInput: document.getElementById('comment-input'),
    addComment: document.getElementById('add-comment'),
    composerTitle: document.getElementById('composer-title'),
    clearComposerRound: document.getElementById('clear-composer-round'),
    clearTarget: document.getElementById('clear-target'),
    selectionPopover: document.getElementById('selection-popover'),
    assetUpload: document.getElementById('asset-upload'),
    assetModal: document.getElementById('asset-modal'),
    assetModalTitle: document.getElementById('asset-modal-title'),
    assetModalMeta: document.getElementById('asset-modal-meta'),
    assetModalContent: document.getElementById('asset-modal-content'),
    payloadModal: document.getElementById('payload-modal'),
    payloadContent: document.getElementById('payload-content'),
    agentFab: document.getElementById('agent-fab'),
    agentModal: document.getElementById('agent-modal'),
    agentContextPage: document.getElementById('agent-context-page'),
    agentContextStage: document.getElementById('agent-context-stage'),
    agentChatList: document.getElementById('agent-chat-list'),
    agentChatInput: document.getElementById('agent-chat-input'),
    agentSend: document.getElementById('agent-send'),
    agentNewChat: document.getElementById('agent-new-chat'),
    toast: document.getElementById('toast'),
    resetDemo: document.getElementById('reset-demo'),
    exportState: document.getElementById('export-state'),
  }

  function createSeedAgentChatMessages() {
    return [
      {
        id: 'agent-seed-1',
        role: 'agent',
        time: '10:08',
        text: '您好，我是您的智能报告助手，可以帮助您优化页面内容、整理逻辑、补充脚本与生成素材建议。',
      },
      {
        id: 'agent-seed-2',
        role: 'agent',
        time: '10:08',
        text: '您可以直接提出需求，例如：优化本页标题、补充讲解脚本、生成图表思路，或解释当前页面应该如何调整。',
      },
    ]
  }

  function currentTimeLabel() {
    return new Date(Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  function stageLabel(stage) {
    return ({ outline: '大纲阶段', draft: '草案阶段', layout: '排版阶段' })[stage] || stage
  }

  function currentPageLabel() {
    const page = getActivePage()
    return page ? `第${page.number}页（${page.title}）` : '整份大纲'
  }


  function clearPendingAgentTimers() {
    for (const timerId of agentReplyTimers) window.clearTimeout(timerId)
    agentReplyTimers.clear()
  }

  function scheduleAgentTask(callback, delay) {
    const timerId = window.setTimeout(() => {
      agentReplyTimers.delete(timerId)
      callback()
    }, delay)
    agentReplyTimers.add(timerId)
    return timerId
  }

  function scopeKeyFor(stage, pageId) {
    return stage === 'outline' ? 'outline' : `${stage}:${pageId}`
  }

  function getPageById(pageId) {
    return state.pages.find(page => page.id === pageId) || null
  }

  function buildRoundContextLabel(stage, pageId, roundNumber) {
    const page = pageId ? getPageById(pageId) : null
    const pageLabel = page ? `第${page.number}页 · ${page.title}` : '整份大纲'
    return `${stageLabel(stage)} · ${pageLabel} · 第${roundNumber}轮`
  }

  function buildBatchMessageText(payload, round, comments) {
    const labels = [...new Set((comments || []).map(comment => comment.target.label))]
    const preview = labels.slice(0, 3).join('、')
    return {
      summary: buildRoundContextLabel(payload.stage, payload.pageId || '', round.number || 1),
      detail: `本次提交 ${payload.comments.length} 条未完成批注${preview ? ` · ${preview}` : ''}`,
    }
  }

  function createAgentReplyFromResult(submitted, result) {
    const page = submitted.payload.pageId ? getPageById(submitted.payload.pageId) : null
    const pageLabel = page ? `第${page.number}页“${page.title}”` : '当前大纲'
    const changeSummary = (result.changes || []).slice(0, 3).join('；')
    return `${result.summary}${changeSummary ? `

涉及内容：${changeSummary}` : ''}

处理范围：${pageLabel} · 第${submitted.round.number || 1}轮批注。`
  }

  function appendAgentChatMessage(message) {
    agentChatMessages = agentChatMessages.concat({
      id: message.id || `agent-msg-${agentChatMessageSeq++}`,
      createdAt: message.createdAt || new Date().toISOString(),
      time: message.time || currentTimeLabel(),
      ...message,
    })
    renderAgentChatSurface()
  }

  function rememberAgentFabPosition(position) {
    try {
      window.localStorage.setItem(AGENT_FAB_STORAGE_KEY, JSON.stringify(position))
    } catch {}
  }

  function readAgentFabPosition() {
    try {
      const raw = window.localStorage.getItem(AGENT_FAB_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null
      return parsed
    } catch {
      return null
    }
  }

  function defaultAgentFabPosition() {
    const buttonSize = 72
    const margin = 18
    const commentWidth = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--comment-width')) || 360
    const width = window.innerWidth || 1600
    const height = window.innerHeight || 900
    const x = Math.max(margin, width - commentWidth - buttonSize - 28)
    const y = Math.max(margin, height - buttonSize - 26)
    return { x, y }
  }

  function clampAgentFabPosition(position) {
    const buttonSize = el.agentFab.offsetWidth || 72
    const margin = 12
    const x = Math.min(Math.max(margin, position.x), Math.max(margin, window.innerWidth - buttonSize - margin))
    const y = Math.min(Math.max(margin, position.y), Math.max(margin, window.innerHeight - buttonSize - margin))
    return { x, y }
  }

  function snapAgentFabPosition(position) {
    const clamped = clampAgentFabPosition(position)
    const buttonSize = el.agentFab.offsetWidth || 72
    const margin = 12
    const midpoint = window.innerWidth / 2
    const x = clamped.x + buttonSize / 2 < midpoint ? margin : Math.max(margin, window.innerWidth - buttonSize - margin)
    return { x, y: clamped.y }
  }

  function applyAgentFabPosition(position) {
    const next = clampAgentFabPosition(position || readAgentFabPosition() || defaultAgentFabPosition())
    el.agentFab.style.left = `${next.x}px`
    el.agentFab.style.top = `${next.y}px`
    el.agentFab.style.right = 'auto'
    el.agentFab.style.bottom = 'auto'
    rememberAgentFabPosition(next)
    return next
  }

  function openChatAndFocus() {
    agentChatOpen = true
    renderAgentChatSurface()
  }

  function locateRoundFromChat(stage, pageId, roundId) {
    if (guardDraftEditNavigation()) return
    rememberCommentScroll()
    activeComposerRoundId = null
    if (state.stage !== stage) adapter.setStage(stage)
    if (pageId && Core.getActivePageId(state) !== pageId) adapter.setPage(pageId)
    const targetScopeKey = scopeKeyFor(stage, pageId)
    adapter.setRoundExpanded(targetScopeKey, roundId, true)
    window.requestAnimationFrame(() => {
      const roundNode = document.querySelector(`[data-round-id="${roundId}"]`)
      if (roundNode) {
        roundNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        roundNode.classList.add('chat-located')
        window.setTimeout(() => roundNode.classList.remove('chat-located'), 1300)
      }
      closeAgentChat()
    })
  }

  function generateAgentReply(prompt) {
    const page = getActivePage()
    const basePage = page ? `当前页“${page.title}”` : '当前大纲'
    if (/标题|headline|题目/.test(prompt)) {
      return `${basePage}可以进一步压缩为一句结论式表达，突出价值、对象与结果，避免只停留在概念层。`
    }
    if (/脚本|讲解|口播/.test(prompt)) {
      return `建议将讲解拆成“问题—方案—价值”三段，每段一句主句，再补一条支撑说明，这样更适合汇报节奏。`
    }
    if (/素材|图片|图表|视频/.test(prompt)) {
      return `建议补一张结构关系图或流程图，优先服务本页主结论；若是视频素材，应控制时长并明确它证明什么。`
    }
    if (/排版|布局|版式/.test(prompt)) {
      return `版式上建议保留一个主视觉焦点，其余信息按“标题—核心句—支撑信息”展开，减少同层级信息并列。`
    }
    return `已收到。围绕${basePage}，建议先明确这一轮是要优化内容、脚本、素材还是排版，我可以继续按该方向给出更具体的建议。`
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll('`', '&#096;')
  }

  function getActivePage() {
    const pageId = Core.getActivePageId(state)
    return pageId ? Core.findPage(state, pageId) : null
  }

  function createDraftEditSession(page) {
    return {
      pageId: page.id,
      headline: page.headline,
      body: page.body,
      bullets: page.bullets.map(text => String(text)),
      metrics: page.metrics.map(item => ({ value: String(item.value), label: String(item.label) })),
      script: page.script.map(item => ({ time: String(item.time), text: String(item.text) })),
    }
  }

  function isDraftEditing() {
    return state.stage === 'draft'
      && Boolean(pageContentEdit)
      && pageContentEdit.pageId === Core.getActivePageId(state)
  }

  function currentScopeKey() {
    return Core.currentScopeKey(state)
  }

  function getCurrentComments() {
    return state.commentsByScope[currentScopeKey()] || []
  }

  function getCurrentRounds() {
    return state.roundsByScope[currentScopeKey()] || []
  }

  function getCurrentAgentMessages() {
    return state.agentMessagesByScope[currentScopeKey()] || []
  }

  function selected(id) {
    return state.selection?.id === id ? ' selected' : ''
  }

  function statusLabel(status) {
    if (status === 'staged') return '待提交'
    if (status === 'submitted') return '处理中'
    if (status === 'responded') return '待确认'
    if (status === 'processed' || status === 'completed') return '已完成'
    return status
  }

  function isCompletedComment(status) {
    return status === 'processed' || status === 'completed'
  }

  function markerButtons(targetId) {
    const comments = getCurrentComments().filter(comment => comment.target.id === targetId)
    if (comments.length === 0) return ''
    return comments.map(comment => (
      `<button class="annotation-marker" type="button" data-marker-comment-id="${escapeAttr(comment.id)}" title="查看批注 ${comment.number}">${comment.number}</button>`
    )).join('')
  }

  function renderAll() {
    el.projectTitle.textContent = state.project.title
    document.querySelectorAll('.stage-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.stage === state.stage)
      button.setAttribute('aria-current', button.dataset.stage === state.stage ? 'page' : 'false')
    })
    document.querySelectorAll('.filter-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.filter === currentFilter)
    })
    renderPageStrip()
    renderStageWorkspace()
    renderCommentPanel()
    renderSaveStatus()
    renderAgentChatSurface()
  }

  function renderAgentChatSurface() {
    el.agentFab.hidden = agentChatOpen
    el.agentModal.hidden = !agentChatOpen
    el.agentContextPage.textContent = `当前页：${currentPageLabel()}`
    el.agentContextStage.textContent = `阶段：${stageLabel(state.stage)}`
    el.agentChatList.innerHTML = agentChatMessages.map(message => {
      if (message.role === 'system') {
        return `
          <article class="agent-chat-message is-system">
            <div class="agent-chat-system-card">
              <div class="agent-chat-message-head">
                <strong>系统 · 批注批次</strong>
                <time>${escapeHtml(message.time)}</time>
              </div>
              <p class="agent-chat-system-title">${escapeHtml(message.summary || '')}</p>
              <p>${escapeHtml(message.text)}</p>
              <div class="agent-chat-system-actions">
                <button class="text-button" type="button" data-chat-round-jump="${escapeAttr(message.roundId || '')}" data-chat-stage="${escapeAttr(message.stage || '')}" data-chat-page-id="${escapeAttr(message.pageId || '')}">定位到该批次</button>
              </div>
            </div>
          </article>
        `
      }
      return `
        <article class="agent-chat-message ${message.role === 'user' ? 'is-user' : 'is-agent'}">
          <div class="agent-chat-avatar ${message.role === 'user' ? '' : 'is-agent'}" aria-hidden="true">${message.role === 'user' ? '我' : '<span class="agent-orb-image" aria-hidden="true"></span>'}</div>
          <div class="agent-chat-bubble">
            <div class="agent-chat-message-head">
              <strong>${message.role === 'user' ? '我' : 'Agent'}</strong>
              <time>${escapeHtml(message.time)}</time>
            </div>
            <p>${escapeHtml(message.text)}</p>
          </div>
        </article>
      `
    }).join('')
    applyAgentFabPosition(readAgentFabPosition() || defaultAgentFabPosition())
    if (agentChatOpen) {
      window.requestAnimationFrame(() => {
        el.agentChatList.scrollTop = el.agentChatList.scrollHeight
        el.agentChatInput.focus()
      })
    }
  }

  function renderSaveStatus() {
    const stamp = state.lastSavedAt ? new Date(state.lastSavedAt) : null
    el.saveStatus.textContent = stamp && !Number.isNaN(stamp.valueOf())
      ? `已保存 ${stamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
      : '已保存'
  }

  function renderPageStrip() {
    if (state.stage === 'outline') {
      el.pageStrip.hidden = true
      el.pageStrip.innerHTML = ''
      return
    }
    el.pageStrip.hidden = false
    const activePageId = Core.getActivePageId(state)
    el.pageStrip.innerHTML = state.pages.map(page => `
      <button class="page-tab${page.id === activePageId ? ' active' : ''}" type="button" data-page-id="${page.id}">
        <small>PAGE ${page.number}</small>
        <strong>${escapeHtml(page.title)}</strong>
      </button>
    `).join('') + '<button class="page-add" type="button" title="新增页面（原型占位）">＋</button>'
  }

  function renderStageWorkspace() {
    if (state.stage === 'outline') renderOutlineStage()
    else if (state.stage === 'draft') renderDraftStage()
    else renderLayoutStage()
  }

  function renderOutlineStage() {
    const totalChildren = state.outline.reduce((sum, section) => sum + section.children.length, 0)
    el.stageWorkspace.innerHTML = `
      <div class="stage-panel">
        <header class="panel-heading">
          <div>
            <h1>大纲内容</h1>
            <p>整份大纲对应一个批注块；章节和小节均可作为批注定位对象</p>
          </div>
          <div class="panel-actions">
            <button class="ghost-button" type="button" data-expand-all>展开全部</button>
            <button class="ghost-button" type="button">＋ 增加小节</button>
            <button class="ghost-button" type="button">＋ 增加大章</button>
          </div>
        </header>
        <div class="panel-body">
          <div class="outline-table">
            <div class="outline-header"><span>章节与小章节</span><span>批注</span><span>操作</span></div>
            ${state.outline.map(renderOutlineSection).join('')}
          </div>
        </div>
        <footer class="panel-footer">${state.outline.length} 个大章节 · ${totalChildren} 个小章节 · 点击章节后在右侧添加批注</footer>
      </div>
    `
  }

  function renderOutlineSection(section) {
    const isCollapsed = collapsedOutline.has(section.id)
    const target = {
      id: section.id,
      type: 'outline-section',
      label: `${section.number} ${section.title}`,
      excerpt: section.title,
    }
    return `
      <article class="outline-section">
        <div class="outline-row annotatable${selected(section.id)}" data-target-id="${section.id}" data-target-type="${target.type}" data-target-label="${escapeAttr(target.label)}" data-target-excerpt="${escapeAttr(target.excerpt)}">
          <span class="drag-handle">⠿</span>
          <button class="expand-toggle" type="button" data-outline-toggle="${section.id}" aria-label="${isCollapsed ? '展开' : '收起'}">${isCollapsed ? '›' : '⌄'}</button>
          <span class="outline-number">${section.number}</span>
          <span class="outline-title">${escapeHtml(section.title)}</span>
          <span class="outline-meta">${markerButtons(section.id) || `${section.children.length} 个小节`}</span>
          <span class="outline-ops">✎　•••</span>
        </div>
        <div class="outline-children"${isCollapsed ? ' hidden' : ''}>
          ${section.children.map(child => `
            <div class="outline-child annotatable${selected(child.id)}" data-target-id="${child.id}" data-target-type="outline-item" data-target-label="${escapeAttr(`${child.number} ${child.title}`)}" data-target-excerpt="${escapeAttr(child.title)}">
              <span class="outline-number">${child.number}</span>
              <span>${escapeHtml(child.title)}</span>
              <span class="outline-meta">${markerButtons(child.id)}</span>
              <span class="outline-ops">✎　•••</span>
            </div>
          `).join('')}
        </div>
      </article>
    `
  }

  function renderDraftStage() {
    const page = getActivePage()
    const editing = isDraftEditing()
    el.stageWorkspace.innerHTML = `
      <div class="stage-panel${editing ? ' draft-editing' : ''}">
        <header class="panel-heading">
          <div>
            <h1>第${page.number}页 · ${escapeHtml(page.title)}</h1>
            <p>文字内容与本页素材共同构成当前页草案；本页拥有独立批注块</p>
          </div>
          <div class="panel-actions">
            <button class="ghost-button" type="button">版本</button>
            <button class="ghost-button" type="button">页面管理</button>
            <button class="ghost-button" type="button" data-go-layout>进入排版阶段</button>
          </div>
        </header>
        <div class="panel-body">
          <div class="draft-grid">
            <section class="content-column">
              <header class="column-header content-column-header">
                <div class="column-heading-copy">
                  <strong>文字内容</strong>
                  <span>${editing ? '编辑模式 · 保存后同步到排版阶段' : '可选择整块或拖选局部文字'}</span>
                </div>
                <div class="content-edit-actions">
                  ${editing ? `
                    <button class="ghost-button" type="button" data-cancel-page-content data-cancel-draft-content>取消</button>
                    <button class="primary-button content-save-button" type="button" data-save-page-content data-save-draft-content>保存修改</button>
                  ` : '<button class="ghost-button content-edit-button" type="button" data-edit-page-content data-edit-draft-content>编辑内容</button>'}
                </div>
              </header>
              <div class="content-scroll${editing ? ' is-editing' : ''}">
                ${editing ? renderDraftContentEditor(page) : renderDraftContent(page)}
              </div>
            </section>
            <section class="assets-column">
              <header class="column-header">
                <div><strong>本页素材</strong> <span>${page.assets.length} 项</span></div>
                <div class="assets-toolbar">
                  <button class="ghost-button" type="button" data-generate-asset>AI 生成</button>
                  <button class="ghost-button" type="button" data-upload-asset>＋ 添加素材</button>
                </div>
              </header>
              <div class="assets-scroll">
                <div class="asset-grid">
                  ${page.assets.map(asset => renderAssetCard(page, asset)).join('')}
                  <button class="add-asset-card" type="button" data-upload-asset>＋<br>从项目素材 / 本地上传</button>
                </div>
              </div>
            </section>
          </div>
        </div>
        <footer class="panel-footer">第${page.number}页草案 · ${page.assets.length} 项本页素材 · ${editing ? '正在人工编辑文字内容' : '切换页面后批注作用域同步切换'}</footer>
      </div>
    `
  }

  function renderDraftContent(page) {
    const titleId = `draft-${page.id}-title`
    const bodyId = `draft-${page.id}-body`
    const metricsId = `draft-${page.id}-metrics`
    const scriptId = `draft-${page.id}-script`
    return `
      <article class="content-block annotatable annotatable-text${selected(titleId)}" data-target-id="${titleId}" data-target-type="text-block" data-target-label="页面标题" data-target-excerpt="${escapeAttr(page.headline)}">
        <div class="content-block-label"><span>页面标题</span><span>${markerButtons(titleId)}</span></div>
        <h2>${escapeHtml(page.headline)}</h2>
      </article>
      <article class="content-block annotatable annotatable-text${selected(bodyId)}" data-target-id="${bodyId}" data-target-type="text-block" data-target-label="页面正文" data-target-excerpt="${escapeAttr(page.body)}">
        <div class="content-block-label"><span>页面内容</span><span>${markerButtons(bodyId)}</span></div>
        <p>${escapeHtml(page.body)}</p>
        <div class="bullet-list">
          ${page.bullets.map((bullet, index) => {
            const id = `draft-${page.id}-bullet-${index + 1}`
            return `<div class="bullet-item annotatable annotatable-text${selected(id)}" data-target-id="${id}" data-target-type="text-line" data-target-label="正文要点 ${index + 1}" data-target-excerpt="${escapeAttr(bullet)}">${escapeHtml(bullet)}${markerButtons(id)}</div>`
          }).join('')}
        </div>
      </article>
      <article class="content-block annotatable${selected(metricsId)}" data-target-id="${metricsId}" data-target-type="data-block" data-target-label="页面指标" data-target-excerpt="${escapeAttr(page.metrics.map(item => `${item.value} ${item.label}`).join('；'))}">
        <div class="content-block-label"><span>关键指标</span><span>${markerButtons(metricsId)}</span></div>
        <div class="metrics-row">
          ${page.metrics.map(item => `<div class="metric-card"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`).join('')}
        </div>
      </article>
      <article class="content-block annotatable${selected(scriptId)}" data-target-id="${scriptId}" data-target-type="script-block" data-target-label="讲解脚本" data-target-excerpt="${escapeAttr(page.script.map(item => item.text).join(' '))}">
        <div class="content-block-label"><span>讲解脚本</span><span>预计 01:20 ${markerButtons(scriptId)}</span></div>
        ${page.script.map((item, index) => {
          const id = `draft-${page.id}-script-${index + 1}`
          return `<div class="script-row annotatable annotatable-text${selected(id)}" data-target-id="${id}" data-target-type="script-line" data-target-label="讲解脚本 ${item.time}" data-target-excerpt="${escapeAttr(item.text)}"><span class="script-time">${item.time}</span><span>${escapeHtml(item.text)}${markerButtons(id)}</span></div>`
        }).join('')}
      </article>
    `
  }

  function renderDraftContentEditor(page) {
    const draft = pageContentEdit || createDraftEditSession(page)
    return `
      <form class="page-content-editor draft-edit-form" data-draft-editor data-page-id="${escapeAttr(page.id)}">
        <article class="content-block content-edit-block draft-edit-block">
          <label class="draft-field draft-field-headline">
            <span>页面标题</span>
            <textarea rows="2" maxlength="180" data-draft-field="headline">${escapeHtml(draft.headline)}</textarea>
          </label>
        </article>
        <article class="content-block content-edit-block draft-edit-block">
          <label class="draft-field">
            <span>页面正文</span>
            <textarea rows="4" maxlength="1200" data-draft-field="body">${escapeHtml(draft.body)}</textarea>
          </label>
          <div class="draft-field-group">
            <span class="draft-group-label">正文要点</span>
            <div class="draft-bullet-editor">
              ${draft.bullets.map((bullet, index) => `
                <label class="draft-indexed-field">
                  <span>${String(index + 1).padStart(2, '0')}</span>
                  <input type="text" maxlength="260" value="${escapeAttr(bullet)}" data-draft-bullet-index="${index}">
                </label>
              `).join('')}
            </div>
          </div>
        </article>
        <article class="content-block content-edit-block draft-edit-block">
          <div class="draft-field-group">
            <span class="draft-group-label">关键指标</span>
            <div class="draft-metric-edit-grid">
              ${draft.metrics.map((metric, index) => `
                <div class="draft-metric-edit-row">
                  <input type="text" maxlength="32" aria-label="指标 ${index + 1} 数值" value="${escapeAttr(metric.value)}" data-draft-metric-index="${index}" data-draft-metric-part="value">
                  <input type="text" maxlength="80" aria-label="指标 ${index + 1} 名称" value="${escapeAttr(metric.label)}" data-draft-metric-index="${index}" data-draft-metric-part="label">
                </div>
              `).join('')}
            </div>
          </div>
        </article>
        <article class="content-block content-edit-block draft-edit-block">
          <div class="draft-field-group">
            <span class="draft-group-label">讲解脚本</span>
            <div class="draft-script-editor">
              ${draft.script.map((item, index) => `
                <div class="draft-script-edit-row">
                  <input class="draft-script-time-input" type="text" maxlength="8" aria-label="脚本 ${index + 1} 时间" value="${escapeAttr(item.time)}" data-draft-script-index="${index}" data-draft-script-part="time">
                  <textarea rows="2" maxlength="800" aria-label="脚本 ${index + 1} 内容" data-draft-script-index="${index}" data-draft-script-part="text">${escapeHtml(item.text)}</textarea>
                </div>
              `).join('')}
            </div>
          </div>
        </article>
        <p class="draft-edit-hint">编辑状态下暂停文字批注选择。Ctrl / ⌘ + Enter 保存，Esc 取消。</p>
      </form>
    `
  }

  function renderAssetCard(page, asset) {
    const hasData = Boolean(asset.dataUrl)
    const media = hasData
      ? asset.type === 'video'
        ? `<video src="${escapeAttr(asset.dataUrl)}" muted preload="metadata"></video>`
        : `<img src="${escapeAttr(asset.dataUrl)}" alt="${escapeAttr(asset.title)}">`
      : ''
    const typeIcon = asset.type === 'video' ? '<span class="asset-type-icon">▶</span>' : asset.type === 'chart' ? '<span class="asset-type-icon">▥</span>' : ''
    return `
      <article class="asset-card annotatable${selected(asset.id)}" data-target-id="${asset.id}" data-target-type="asset" data-target-label="${escapeAttr(asset.title)}" data-target-excerpt="${escapeAttr(asset.meta)}">
        <button class="asset-thumb${hasData ? ' has-data' : ''}" type="button" data-preview-asset="${asset.id}" data-theme="${escapeAttr(asset.theme)}" aria-label="预览 ${escapeAttr(asset.title)}">
          ${media}${typeIcon}${markerButtons(asset.id)}
        </button>
        <footer class="asset-card-footer">
          <div class="asset-info"><strong>${escapeHtml(asset.title)}</strong><span>${escapeHtml(asset.meta)}</span></div>
          <div class="asset-menu">
            <button type="button" data-preview-asset="${asset.id}" title="预览">⌕</button>
            <button type="button" data-remove-asset="${asset.id}" title="移出本页">×</button>
          </div>
        </footer>
      </article>
    `
  }

  function renderLayoutStage() {
    const page = getActivePage()
    el.stageWorkspace.innerHTML = `
      <div class="layout-stage">
        <div class="layout-toolbar">
          <button class="tool-button active" type="button">选择</button>
          <button class="tool-button" type="button">撤销</button>
          <button class="tool-button" type="button">重做</button>
          <button class="tool-button" type="button">布局⌄</button>
          <span style="flex:1"></span>
          <button class="tool-button" type="button">对齐</button>
          <button class="tool-button" type="button">组合</button>
          <button class="tool-button" type="button">动画</button>
          <button class="tool-button" type="button">预览</button>
        </div>
        <div class="layout-workspace">
          <div class="layout-side-tools" aria-label="排版工具">
            <button class="active" type="button">↖</button><button type="button">T</button><button type="button">▧</button><button type="button">◫</button><button type="button">⌁</button><button type="button">✦</button>
          </div>
          <div class="layout-canvas-wrap">
            <div class="layout-canvas annotatable${selected(page.id)}" data-target-id="${page.id}" data-target-type="page" data-target-label="第${page.number}页整页版式" data-target-excerpt="${escapeAttr(page.headline)}">
              ${page.layout.map(item => renderLayoutElement(page, item)).join('')}
            </div>
          </div>
          ${renderPropertiesPanel(page)}
        </div>
        <div class="layout-statusbar"><span>网格已开启 · 参考线已开启 · 自动吸附</span><span>第${page.number}页 · 75%</span></div>
      </div>
    `
  }

  function renderLayoutElement(page, item) {
    const style = `left:${item.x}%;top:${item.y}%;width:${item.w}%;height:${item.h}%;`
    const marker = markerButtons(item.id)
    if (item.type === 'text') {
      const bodyClass = item.id.includes('body') ? ' body-element' : ''
      return `<div class="layout-element layout-text${bodyClass} annotatable${selected(item.id)}" style="${style}" data-layout-element-id="${item.id}" data-element-kind="text" data-target-id="${item.id}" data-target-type="layout-element" data-target-label="${escapeAttr(item.label)}" data-target-excerpt="${escapeAttr(item.text)}">${escapeHtml(item.text)}${marker}</div>`
    }
    if (item.theme === 'metrics') {
      return `<div class="layout-element layout-metrics annotatable${selected(item.id)}" style="${style}" data-layout-element-id="${item.id}" data-element-kind="chart" data-target-id="${item.id}" data-target-type="layout-element" data-target-label="${escapeAttr(item.label)}" data-target-excerpt="页面指标区">${page.metrics.map(metric => `<div><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>`).join('')}${marker}</div>`
    }
    return `<div class="layout-element ${item.type === 'chart' ? 'layout-chart' : 'layout-visual'} annotatable${selected(item.id)}" style="${style}" data-layout-element-id="${item.id}" data-element-kind="${item.type}" data-target-id="${item.id}" data-target-type="layout-element" data-target-label="${escapeAttr(item.label)}" data-target-excerpt="${escapeAttr(item.type === 'chart' ? '图表元素' : '图像元素')}"><div class="visual-placeholder" data-theme="${escapeAttr(item.theme)}"></div>${marker}</div>`
  }

  function renderPropertiesPanel(page) {
    const selection = state.selection
    const item = selection ? page.layout.find(layoutItem => layoutItem.id === selection.id) : null
    return `
      <aside class="properties-panel">
        <h3>元素属性</h3>
        <div class="property-group">
          <strong>当前选择</strong>
          <div class="property-field">${escapeHtml(selection?.label || '未选择元素')}</div>
        </div>
        <div class="property-group">
          <strong>位置与尺寸</strong>
          <div class="property-grid">
            <div class="property-field">X　${item ? Math.round(item.x) : '—'}</div>
            <div class="property-field">Y　${item ? Math.round(item.y) : '—'}</div>
            <div class="property-field">W　${item ? Math.round(item.w) : '—'}</div>
            <div class="property-field">H　${item ? Math.round(item.h) : '—'}</div>
          </div>
        </div>
        <div class="property-group">
          <strong>对齐</strong>
          <div class="property-grid"><button class="tool-button">⇤</button><button class="tool-button">↔</button><button class="tool-button">⇥</button><button class="tool-button">↕</button></div>
        </div>
        <div class="property-group">
          <strong>样式</strong>
          <div class="property-grid"><div class="property-field">圆角 12</div><div class="property-field">透明度 100%</div></div>
        </div>
        <div class="property-group">
          <strong>动画</strong>
          <div class="property-field">进入方式　淡入⌄</div>
        </div>
      </aside>
    `
  }

  function scopePresentation() {
    if (state.stage === 'outline') return { title: '批注 · 整份大纲', hint: '整份大纲一个批注块' }
    const page = getActivePage()
    return {
      title: `批注 · 第${page.number}页`,
      hint: `${state.stage === 'draft' ? '草案' : '排版'}阶段 · 当前页独立批注`,
    }
  }

  function formatBatchTime(value) {
    const stamp = new Date(value)
    if (Number.isNaN(stamp.valueOf())) return '时间未知'
    const now = new Date()
    const sameDate = (left, right) => (
      left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate()
    )
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const time = stamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    if (sameDate(stamp, now)) return `今天 ${time}`
    if (sameDate(stamp, yesterday)) return `昨天 ${time}`
    return `${stamp.getMonth() + 1}月${stamp.getDate()}日 ${time}`
  }

  function filteredComments(comments) {
    if (currentFilter === 'completed') return comments.filter(comment => isCompletedComment(comment.status))
    if (currentFilter === 'unfinished') return comments.filter(comment => !isCompletedComment(comment.status))
    return comments
  }

  function roundStatusPresentation(round, stats, comments) {
    if (round.status === 'processing') return { label: '处理中', className: 'processing' }
    if (round.status === 'failed') return { label: '提交失败', className: 'failed' }
    if (stats.unfinished === 0) return { label: '已完成', className: 'completed' }
    if (comments.some(comment => comment.status === 'staged')) return { label: '待提交', className: 'staged' }
    return { label: '待确认', className: 'review' }
  }

  function renderBatchSubmitButton(roundId, stats, isProcessing) {
    if (stats.unfinished === 0) return ''
    const disabled = isProcessing || stats.submittable === 0
    const key = roundId || 'current'
    return `<button class="batch-submit primary-button" type="button" data-submit-batch="${escapeAttr(key)}" data-submit-round-id="${escapeAttr(roundId || '')}" ${disabled ? 'disabled' : ''} title="${disabled ? (isProcessing ? '该轮正在处理中' : '该轮没有可提交批注') : `提交该轮 ${stats.submittable} 条未完成批注`}">提给Agent</button>`
  }

  function renderStagedBatch(comments) {
    if (currentFilter === 'completed' || comments.length === 0) return ''
    const latest = comments.reduce((value, comment) => (
      new Date(comment.updatedAt || comment.createdAt).valueOf() > new Date(value.updatedAt || value.createdAt).valueOf() ? comment : value
    ), comments[0])
    const progress = Core.getBatchProgress(comments)
    const stats = Core.getBatchStats(state, currentScopeKey(), null)
    return `
      <section class="comment-batch comment-batch-current is-expanded" data-batch-kind="staged">
        <div class="comment-batch-header comment-batch-header-static">
          <div class="batch-toggle batch-toggle-static">
            <span class="batch-chevron" aria-hidden="true">⌄</span>
            <span class="batch-heading">
              <strong>本轮未提交</strong>
              <small>${formatBatchTime(latest.updatedAt || latest.createdAt)} · 已完成 ${progress.completed} · 未完成 ${progress.unfinished}</small>
            </span>
          </div>
          <div class="batch-actions">
            <span class="batch-status batch-status-staged">待提交</span>
            ${renderBatchSubmitButton(null, stats, false)}
          </div>
        </div>
        <div class="comment-batch-body">
          ${filteredComments(comments).map(comment => renderCommentCard(comment, null)).join('')}
        </div>
      </section>
    `
  }

  function renderRoundBatch(round, roundNumber, comments, messages) {
    const visibleComments = filteredComments(comments)
    if (visibleComments.length === 0) return ''
    const expanded = Core.isRoundExpanded(state, round.scopeKey, round)
    const counts = Core.getRoundCommentCounts(state, round.id)
    const stats = Core.getBatchStats(state, round.scopeKey, round.id)
    const status = roundStatusPresentation(round, stats, comments)
    const processingHtml = round.status === 'processing' ? `
      <div class="round-card">
        <span class="processing-dot"></span>
        <span>Agent 正在读取该轮结构化文档…</span>
        <button class="text-button" type="button" data-view-payload>查看包</button>
      </div>
    ` : ''
    const messageHtml = (messages || []).map(message => `
      <article class="agent-card">
        <header><span>AI　Agent · 第${message.submissionNumber || 1}次提交</span><span>已返回</span></header>
        <p>${escapeHtml(message.summary)}</p>
        ${message.changes.length ? `<ul>${message.changes.map(change => `<li>${escapeHtml(change)}</li>`).join('')}</ul>` : ''}
      </article>
    `).join('')
    const failedHtml = round.status === 'failed' ? `
      <div class="batch-failure">${escapeHtml(round.result?.summary || '该轮提交失败，批注已恢复为待提交。')}</div>
    ` : ''
    return `
      <section class="comment-batch${expanded ? ' is-expanded' : ''}" data-round-id="${escapeAttr(round.id)}" data-batch-expanded="${expanded}">
        <div class="comment-batch-header">
          <button class="batch-toggle" type="button" data-toggle-round="${escapeAttr(round.id)}" aria-expanded="${expanded}" aria-controls="batch-body-${escapeAttr(round.id)}">
            <span class="batch-chevron" aria-hidden="true">${expanded ? '⌄' : '›'}</span>
            <span class="batch-heading">
              <strong>第${roundNumber}轮</strong>
              <small>${formatBatchTime(round.lastSubmittedAt || round.submittedAt)} · 已完成 ${counts.completed} · 未完成 ${counts.unfinished}</small>
            </span>
          </button>
          <div class="batch-actions">
            <span class="batch-status batch-status-${status.className}">${status.label}</span>
            ${renderBatchSubmitButton(round.id, stats, round.status === 'processing')}
          </div>
        </div>
        ${expanded ? `
          <div class="comment-batch-body" id="batch-body-${escapeAttr(round.id)}">
            ${visibleComments.map(comment => renderCommentCard(comment, round.id)).join('')}
            ${processingHtml}
            ${messageHtml}
            ${failedHtml}
            ${round.status === 'processing' ? '' : `<div class="batch-footer"><button class="text-button batch-continue" type="button" data-continue-batch="${escapeAttr(round.id)}" data-continue-round="${escapeAttr(round.id)}">＋ 继续批注</button></div>`}
          </div>
        ` : ''}
      </section>
    `
  }

  function rememberCommentScroll(scopeKey = renderedCommentScopeKey) {
    if (!scopeKey) return
    commentScrollTopByScope.set(scopeKey, el.commentList.scrollTop)
  }

  function updateCommentScrollHints() {
    const threshold = 2
    const canScrollUp = el.commentList.scrollTop > threshold
    const canScrollDown = el.commentList.scrollTop + el.commentList.clientHeight < el.commentList.scrollHeight - threshold
    el.commentScrollRegion.classList.toggle('can-scroll-up', canScrollUp)
    el.commentScrollRegion.classList.toggle('can-scroll-down', canScrollDown)
  }

  function restoreCommentScroll(scopeKey) {
    const storedTop = commentScrollTopByScope.get(scopeKey) || 0
    const maxTop = Math.max(0, el.commentList.scrollHeight - el.commentList.clientHeight)
    el.commentList.scrollTop = Math.min(storedTop, maxTop)
    updateCommentScrollHints()
  }

  function renderCommentPanel() {
    const scopeKey = currentScopeKey()
    if (renderedCommentScopeKey === scopeKey) rememberCommentScroll(scopeKey)
    const presentation = scopePresentation()
    const comments = getCurrentComments()
    const rounds = getCurrentRounds()
    const agentMessages = getCurrentAgentMessages()
    const stagedComments = comments.filter(comment => comment.status === 'staged' && !comment.submittedRoundId)
    const roundNumberById = new Map(rounds.map((round, index) => [round.id, index + 1]))
    const messagesByRoundId = new Map()
    for (const message of agentMessages) {
      if (!messagesByRoundId.has(message.roundId)) messagesByRoundId.set(message.roundId, [])
      messagesByRoundId.get(message.roundId).push(message)
    }

    if (activeComposerRoundId && !rounds.some(round => round.id === activeComposerRoundId)) activeComposerRoundId = null

    el.commentScopeTitle.textContent = presentation.title
    el.commentScopeHint.textContent = presentation.hint
    el.commentCount.textContent = String(comments.length)

    const stagedHtml = renderStagedBatch(stagedComments)
    const roundHtml = [...rounds].reverse().map(round => {
      const roundComments = comments.filter(comment => round.commentIds.includes(comment.id))
      return renderRoundBatch(round, roundNumberById.get(round.id), roundComments, messagesByRoundId.get(round.id) || [])
    }).join('')
    el.commentList.innerHTML = stagedHtml + roundHtml || '<div class="empty-comments">当前筛选下没有批注。<br>选择左侧内容后，可在下方添加新批注。</div>'
    renderedCommentScopeKey = scopeKey
    window.requestAnimationFrame(() => restoreCommentScroll(scopeKey))

    if (activeComposerRoundId) {
      const number = roundNumberById.get(activeComposerRoundId)
      el.composerTitle.textContent = `单条批注（加入第${number}轮）`
      el.clearComposerRound.hidden = false
    } else {
      el.composerTitle.textContent = '单条批注（加入本轮）'
      el.clearComposerRound.hidden = true
    }

    if (state.selection) {
      el.selectedTarget.textContent = `已定位：${state.selection.label}${state.selection.excerpt ? ` · ${state.selection.excerpt}` : ''}`
      el.selectedTarget.classList.add('has-target')
    } else {
      el.selectedTarget.textContent = state.stage === 'outline' ? '未选择对象，将批注整份大纲' : '未选择对象，将批注当前页面'
      el.selectedTarget.classList.remove('has-target')
    }
  }

  function renderCommentCard(comment, roundId) {
    const editable = comment.status !== 'submitted'
    const isEditing = editable && editingCommentId === comment.id
    const completionAction = roundId && editable
      ? `<button class="text-button" type="button" data-toggle-comment-complete="${escapeAttr(comment.id)}">${isCompletedComment(comment.status) ? '标记未完成' : '标记完成'}</button>`
      : ''
    const content = isEditing
      ? `<div class="comment-inline-editor" data-comment-inline-editor="${escapeAttr(comment.id)}">
          <textarea data-edit-comment-input="${escapeAttr(comment.id)}" maxlength="500" aria-label="编辑批注内容">${escapeHtml(comment.text)}</textarea>
          <div class="comment-inline-actions">
            <span>Ctrl / ⌘ + Enter 保存 · Esc 取消</span>
            <div class="comment-inline-buttons">
              <button class="ghost-button" type="button" data-cancel-comment-edit="${escapeAttr(comment.id)}">取消</button>
              <button class="primary-button" type="button" data-save-comment-edit="${escapeAttr(comment.id)}">保存修改</button>
            </div>
          </div>
        </div>`
      : `<p>${escapeHtml(comment.text)}</p>
        ${editable ? `<div class="comment-actions"><button class="text-button" type="button" data-edit-comment="${escapeAttr(comment.id)}">编辑</button>${completionAction}</div>` : ''}`
    return `
      <article class="comment-card${isEditing ? ' editing' : ''}" id="comment-${comment.id}" data-comment-id="${comment.id}" data-target-id="${escapeAttr(comment.target.id)}">
        <div class="comment-meta">
          <span class="comment-author"><span class="avatar">我</span>我的批注</span>
          <span class="comment-status status-${comment.status}">${statusLabel(comment.status)}</span>
        </div>
        <div class="comment-target"><span class="comment-number">${comment.number}</span><span>关联：${escapeHtml(comment.target.label)}</span></div>
        ${content}
      </article>
    `
  }

  function handleAddComment() {
    const text = el.commentInput.value.trim()
    try {
      adapter.addComment({ text, roundId: activeComposerRoundId || undefined })
      el.commentInput.value = ''
      showToast(activeComposerRoundId ? '已补充到指定批次；尚未提给 Agent。' : '已添加到本轮批注；尚未提给 Agent。')
    } catch (error) {
      showToast(error.message, true)
      el.commentInput.focus()
    }
  }

  function handleSubmitBatch(batchKey) {
    const roundId = batchKey && batchKey !== 'current' ? batchKey : null
    try {
      const submitted = adapter.submitRound(roundId)
      lastPayload = submitted.payload
      activeComposerRoundId = null
      showToast(`已将该轮 ${submitted.payload.comments.length} 条未完成批注提给 Agent。`)
      pushRoundSubmissionIntoAgentChat(submitted)
      openChatAndFocus()
      scheduleRoundAgentResult(submitted)
    } catch (error) {
      showToast(error.message, true)
    }
  }

  function handleSubmitRound(roundId) {
    handleSubmitBatch(roundId || 'current')
  }

  function handleContinueBatch(roundId) {
    const round = getCurrentRounds().find(item => item.id === roundId)
    if (!round || round.status === 'processing') return
    activeComposerRoundId = roundId
    adapter.setRoundExpanded(currentScopeKey(), roundId, true)
    window.requestAnimationFrame(() => el.commentInput.focus())
  }

  function handleStartCommentEdit(commentId) {
    const comment = getCurrentComments().find(item => item.id === commentId)
    if (!comment) return
    if (comment.status === 'submitted') {
      showToast('该批注正在处理中，暂时不能编辑。', true)
      return
    }
    editingCommentId = commentId
    renderCommentPanel()
    window.requestAnimationFrame(() => {
      const input = el.commentList.querySelector(`[data-edit-comment-input="${commentId}"]`)
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
  }

  function handleCancelCommentEdit(commentId) {
    if (commentId && editingCommentId !== commentId) return
    editingCommentId = null
    renderCommentPanel()
  }

  function handleSaveCommentEdit(commentId) {
    const comment = getCurrentComments().find(item => item.id === commentId)
    const input = el.commentList.querySelector(`[data-edit-comment-input="${commentId}"]`)
    if (!comment || !input) return
    const text = input.value.trim()
    try {
      editingCommentId = null
      adapter.editComment(commentId, { text })
      if (comment.submittedRoundId) activeComposerRoundId = comment.submittedRoundId
      showToast('批注已修改，并标记为未完成。')
    } catch (error) {
      editingCommentId = commentId
      showToast(error.message, true)
      window.requestAnimationFrame(() => {
        const restoredInput = el.commentList.querySelector(`[data-edit-comment-input="${commentId}"]`)
        restoredInput?.focus()
      })
    }
  }

  function handleToggleCommentComplete(commentId) {
    const comment = getCurrentComments().find(item => item.id === commentId)
    if (!comment) return
    try {
      const shouldComplete = !isCompletedComment(comment.status)
      adapter.setCommentCompleted(commentId, shouldComplete)
      showToast(shouldComplete ? '该批注已标记完成。' : '该批注已标记未完成。')
    } catch (error) {
      showToast(error.message, true)
    }
  }

  function startDraftEdit() {
    const page = getActivePage()
    if (!page || state.stage !== 'draft') return
    pageContentEdit = createDraftEditSession(page)
    selectionPopoverTarget = null
    el.selectionPopover.hidden = true
    adapter.selectTarget(null)
    window.requestAnimationFrame(() => {
      el.stageWorkspace.querySelector('[data-draft-field="headline"]')?.focus()
    })
  }

  function cancelDraftEdit() {
    if (!isDraftEditing()) return
    pageContentEdit = null
    el.selectionPopover.hidden = true
    renderAll()
    showToast('已取消文字修改。')
  }

  function saveDraftEdit() {
    if (!isDraftEditing()) return
    const session = pageContentEdit
    try {
      pageContentEdit = null
      adapter.updatePageContent(session.pageId, {
        headline: session.headline,
        body: session.body,
        bullets: session.bullets,
        metrics: session.metrics,
        script: session.script,
      })
      showToast('文字内容已保存，并同步到排版阶段。')
    } catch (error) {
      pageContentEdit = session
      showToast(error.message, true)
      window.requestAnimationFrame(() => {
        el.stageWorkspace.querySelector('[data-draft-field="headline"]')?.focus()
      })
    }
  }

  function handleDraftEditorInput(event) {
    if (!isDraftEditing()) return
    const input = event.target.closest('[data-draft-editor] input, [data-draft-editor] textarea')
    if (!input || !pageContentEdit) return

    const field = input.dataset.draftField
    if (field === 'headline' || field === 'body') {
      pageContentEdit[field] = input.value
      return
    }

    if (input.dataset.draftBulletIndex !== undefined) {
      const index = Number(input.dataset.draftBulletIndex)
      if (Number.isInteger(index) && pageContentEdit.bullets[index] !== undefined) {
        pageContentEdit.bullets[index] = input.value
      }
      return
    }

    if (input.dataset.draftMetricIndex !== undefined) {
      const index = Number(input.dataset.draftMetricIndex)
      const part = input.dataset.draftMetricPart
      if (Number.isInteger(index) && pageContentEdit.metrics[index] && (part === 'value' || part === 'label')) {
        pageContentEdit.metrics[index][part] = input.value
      }
      return
    }

    if (input.dataset.draftScriptIndex !== undefined) {
      const index = Number(input.dataset.draftScriptIndex)
      const part = input.dataset.draftScriptPart
      if (Number.isInteger(index) && pageContentEdit.script[index] && (part === 'time' || part === 'text')) {
        pageContentEdit.script[index][part] = input.value
      }
    }
  }

  function guardDraftEditNavigation() {
    if (!isDraftEditing()) return false
    showToast('请先保存或取消当前文字修改。', true)
    return true
  }

  function handleTextSelection(event) {
    if (pageContentEdit) return
    const selection = window.getSelection()
    const text = selection ? selection.toString().trim() : ''
    if (text.length < 2) return
    const node = selection.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode
    const container = node?.closest?.('.annotatable-text[data-target-id]')
    if (!container || !el.stageWorkspace.contains(container)) return

    const target = {
      id: container.dataset.targetId,
      type: 'text-selection',
      label: `${container.dataset.targetLabel || '文字'} · 选中文本`,
      excerpt: text.slice(0, 120),
    }
    adapter.selectTarget(target)
    selectionPopoverTarget = target
    lastTextSelectionAt = Date.now()
    el.selectionPopover.hidden = false
    el.selectionPopover.style.left = `${Math.min(event.clientX + 8, window.innerWidth - 145)}px`
    el.selectionPopover.style.top = `${Math.max(80, event.clientY - 42)}px`
  }

  function openAssetPreview(assetId) {
    const page = getActivePage()
    const asset = page?.assets.find(item => item.id === assetId)
    if (!asset) return
    el.assetModalTitle.textContent = asset.title
    el.assetModalMeta.textContent = asset.meta
    if (asset.dataUrl) {
      el.assetModalContent.innerHTML = asset.type === 'video'
        ? `<video src="${escapeAttr(asset.dataUrl)}" controls autoplay></video>`
        : `<img src="${escapeAttr(asset.dataUrl)}" alt="${escapeAttr(asset.title)}">`
    } else {
      el.assetModalContent.innerHTML = `<div class="asset-large-placeholder"><div class="visual-placeholder" data-theme="${escapeAttr(asset.theme)}"></div></div>`
    }
    el.assetModal.hidden = false
  }

  function closeAssetPreview() {
    el.assetModal.hidden = true
    el.assetModalContent.innerHTML = ''
  }

  function handleAssetUpload(file) {
    if (!file) return
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      showToast('原型仅支持图片和视频文件。', true)
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      showToast('原型演示文件请控制在 12 MB 以内。', true)
      return
    }
    const page = getActivePage()
    const reader = new FileReader()
    reader.onerror = () => showToast('文件读取失败。', true)
    reader.onload = () => {
      adapter.addAsset(page.id, {
        type: file.type.startsWith('video/') ? 'video' : 'image',
        title: file.name,
        meta: `${file.type.startsWith('video/') ? '视频' : '图片'} · ${(file.size / 1024 / 1024).toFixed(1)} MB`,
        dataUrl: reader.result,
        theme: 'uploaded',
      })
      showToast('素材已加入当前页。')
      el.assetUpload.value = ''
    }
    reader.readAsDataURL(file)
  }

  function handleGenerateAsset() {
    const page = getActivePage()
    const sequence = page.assets.filter(asset => asset.theme === 'ai').length + 1
    adapter.addAsset(page.id, {
      type: 'image',
      title: `AI 概念素材 ${sequence}`,
      meta: 'AI 生成 · 概念表达',
      theme: 'ai',
    })
    showToast('已模拟生成一张新的本页概念素材。')
  }

  function removeAsset(assetId) {
    const page = getActivePage()
    const asset = page?.assets.find(item => item.id === assetId)
    if (!asset) return
    if (!window.confirm(`将“${asset.title}”移出当前页面？原始项目素材不会被永久删除。`)) return
    try {
      adapter.removeAsset(page.id, assetId)
      showToast('素材已移出当前页面。')
    } catch (error) {
      showToast(error.message, true)
    }
  }

  function locateTarget(targetId) {
    const target = el.stageWorkspace.querySelector(`[data-target-id="${CSS.escape(targetId)}"]`)
    if (!target) return
    const type = target.dataset.targetType || 'target'
    adapter.selectTarget({
      id: targetId,
      type,
      label: target.dataset.targetLabel || '批注对象',
      excerpt: target.dataset.targetExcerpt || '',
    })
    window.requestAnimationFrame(() => {
      const refreshed = el.stageWorkspace.querySelector(`[data-target-id="${CSS.escape(targetId)}"]`)
      refreshed?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function focusComment(commentId) {
    const comment = getCurrentComments().find(item => item.id === commentId)
    if (!comment) return
    currentFilter = 'all'
    if (comment.submittedRoundId) {
      adapter.setRoundExpanded(comment.scopeKey, comment.submittedRoundId, true)
    } else {
      renderAll()
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const card = document.getElementById(`comment-${commentId}`)
      if (!card) return
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      card.classList.remove('flash')
      void card.offsetWidth
      card.classList.add('flash')
    }))
  }

  function showPayloadModal() {
    if (!lastPayload) return
    el.payloadContent.textContent = JSON.stringify(lastPayload, null, 2)
    el.payloadModal.hidden = false
  }

  function showToast(message, isError) {
    window.clearTimeout(toastTimer)
    el.toast.textContent = message
    el.toast.classList.toggle('error', Boolean(isError))
    el.toast.hidden = false
    toastTimer = window.setTimeout(() => { el.toast.hidden = true }, 2500)
  }

  function exportState() {
    const blob = new Blob([adapter.exportSnapshot()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'report-studio-prototype-state.json'
    link.click()
    URL.revokeObjectURL(url)
  }


  function openAgentChat() {
    openChatAndFocus()
  }

  function closeAgentChat() {
    agentChatOpen = false
    renderAgentChatSurface()
  }

  function resetAgentChat() {
    clearPendingAgentTimers()
    agentChatMessages = createSeedAgentChatMessages()
    agentChatMessageSeq = 4
    renderAgentChatSurface()
  }

  function handleAgentChatSubmit() {
    const value = el.agentChatInput.value.trim()
    if (!value) return
    appendAgentChatMessage({
      role: 'user',
      text: value,
    })
    el.agentChatInput.value = ''
    scheduleAgentTask(() => {
      appendAgentChatMessage({
        role: 'agent',
        text: generateAgentReply(value),
      })
    }, 420)
  }

  function pushRoundSubmissionIntoAgentChat(submitted) {
    const comments = submitted.payload.comments || []
    const meta = buildBatchMessageText(submitted.payload, submitted.round, comments)
    appendAgentChatMessage({
      role: 'system',
      stage: submitted.payload.stage,
      pageId: submitted.payload.pageId || '',
      roundId: submitted.round.id,
      summary: meta.summary,
      text: meta.detail,
    })
  }

  function scheduleRoundAgentResult(submitted) {
    scheduleAgentTask(() => {
      const labels = submitted.payload.comments.map(comment => comment.target.label)
      const uniqueLabels = [...new Set(labels)].slice(0, 3)
      const submittedPage = submitted.payload.pageId
        ? Core.findPage(state, submitted.payload.pageId) || submitted.payload.context.page
        : null
      const submittedPageNumber = submittedPage?.number || ''
      const result = {
        summary: submitted.payload.stage === 'outline'
          ? '已根据该轮批注生成大纲结构调整建议。'
          : submitted.payload.stage === 'draft'
            ? `已根据第${submittedPageNumber}页该轮批注生成内容与素材修改建议。`
            : `已根据第${submittedPageNumber}页该轮批注生成版式调整建议。`,
        changes: uniqueLabels.map(label => `已分析：${label}`).concat('修改结果已返回该轮批注流'),
      }
      adapter.completeRound(submitted.round.id, result)
      appendAgentChatMessage({
        role: 'agent',
        roundId: submitted.round.id,
        text: createAgentReplyFromResult(submitted, result),
      })
      showToast('Agent 已完成该轮处理，结果已返回。')
    }, 1200)
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const stageButton = event.target.closest('[data-stage]')
      if (stageButton) {
        if (guardDraftEditNavigation()) return
        rememberCommentScroll()
        activeComposerRoundId = null
        adapter.setStage(stageButton.dataset.stage)
        return
      }

      const pageButton = event.target.closest('[data-page-id]')
      if (pageButton) {
        if (guardDraftEditNavigation()) return
        rememberCommentScroll()
        activeComposerRoundId = null
        adapter.setPage(pageButton.dataset.pageId)
        return
      }

      const filterButton = event.target.closest('[data-filter]')
      if (filterButton) {
        currentFilter = filterButton.dataset.filter
        renderAll()
        return
      }

      if (event.target.closest('[data-edit-page-content], [data-edit-draft-content]')) {
        event.stopPropagation()
        startDraftEdit()
        return
      }

      if (event.target.closest('[data-save-page-content], [data-save-draft-content]')) {
        event.stopPropagation()
        saveDraftEdit()
        return
      }

      if (event.target.closest('[data-cancel-page-content], [data-cancel-draft-content]')) {
        event.stopPropagation()
        cancelDraftEdit()
        return
      }

      const marker = event.target.closest('[data-marker-comment-id]')
      if (marker) {
        event.stopPropagation()
        focusComment(marker.dataset.markerCommentId)
        return
      }

      const submitBatch = event.target.closest('[data-submit-batch]')
      if (submitBatch) {
        event.stopPropagation()
        handleSubmitBatch(submitBatch.dataset.submitBatch)
        return
      }

      const continueBatch = event.target.closest('[data-continue-batch]')
      if (continueBatch) {
        event.stopPropagation()
        handleContinueBatch(continueBatch.dataset.continueBatch)
        return
      }

      const editComment = event.target.closest('[data-edit-comment]')
      if (editComment) {
        event.stopPropagation()
        handleStartCommentEdit(editComment.dataset.editComment)
        return
      }

      const saveCommentEdit = event.target.closest('[data-save-comment-edit]')
      if (saveCommentEdit) {
        event.stopPropagation()
        handleSaveCommentEdit(saveCommentEdit.dataset.saveCommentEdit)
        return
      }

      const cancelCommentEdit = event.target.closest('[data-cancel-comment-edit]')
      if (cancelCommentEdit) {
        event.stopPropagation()
        handleCancelCommentEdit(cancelCommentEdit.dataset.cancelCommentEdit)
        return
      }

      const toggleCommentComplete = event.target.closest('[data-toggle-comment-complete]')
      if (toggleCommentComplete) {
        event.stopPropagation()
        handleToggleCommentComplete(toggleCommentComplete.dataset.toggleCommentComplete)
        return
      }

      const roundToggle = event.target.closest('[data-toggle-round]')
      if (roundToggle) {
        event.stopPropagation()
        const scopeKey = currentScopeKey()
        const round = getCurrentRounds().find(item => item.id === roundToggle.dataset.toggleRound)
        if (round) adapter.setRoundExpanded(scopeKey, round.id, !Core.isRoundExpanded(state, scopeKey, round))
        return
      }

      const preview = event.target.closest('[data-preview-asset]')
      if (preview) {
        event.stopPropagation()
        openAssetPreview(preview.dataset.previewAsset)
        return
      }

      const remove = event.target.closest('[data-remove-asset]')
      if (remove) {
        event.stopPropagation()
        removeAsset(remove.dataset.removeAsset)
        return
      }

      if (event.target.closest('[data-upload-asset]')) {
        el.assetUpload.click()
        return
      }

      if (event.target.closest('[data-generate-asset]')) {
        handleGenerateAsset()
        return
      }

      const toggle = event.target.closest('[data-outline-toggle]')
      if (toggle) {
        event.stopPropagation()
        const id = toggle.dataset.outlineToggle
        if (collapsedOutline.has(id)) collapsedOutline.delete(id)
        else collapsedOutline.add(id)
        renderOutlineStage()
        return
      }

      if (event.target.closest('[data-expand-all]')) {
        collapsedOutline.clear()
        renderOutlineStage()
        return
      }

      if (event.target.closest('[data-go-layout]')) {
        if (guardDraftEditNavigation()) return
        rememberCommentScroll()
        const currentPageId = Core.getActivePageId(state)
        activeComposerRoundId = null
        adapter.setStage('layout')
        adapter.setPage(currentPageId)
        return
      }

      if (event.target.closest('[data-comment-inline-editor], [data-draft-editor]')) return

      const commentCard = event.target.closest('[data-comment-id]')
      if (commentCard) {
        locateTarget(commentCard.dataset.targetId)
        return
      }

      if (event.target.closest('[data-view-payload]')) {
        showPayloadModal()
        return
      }

      if (event.target.closest('[data-close-modal]')) {
        closeAssetPreview()
        return
      }

      if (event.target.closest('[data-close-payload]')) {
        el.payloadModal.hidden = true
        return
      }

      if (event.target.closest('[data-close-agent-modal]')) {
        closeAgentChat()
        return
      }

      const chatRoundJump = event.target.closest('[data-chat-round-jump]')
      if (chatRoundJump) {
        event.stopPropagation()
        locateRoundFromChat(chatRoundJump.dataset.chatStage, chatRoundJump.dataset.chatPageId || '', chatRoundJump.dataset.chatRoundJump)
        return
      }

      const target = event.target.closest('.annotatable[data-target-id]')
      if (target && Date.now() - lastTextSelectionAt > 350) {
        adapter.selectTarget({
          id: target.dataset.targetId,
          type: target.dataset.targetType || 'target',
          label: target.dataset.targetLabel || '批注对象',
          excerpt: target.dataset.targetExcerpt || '',
        })
      }
    })

    el.addComment.addEventListener('click', handleAddComment)
    el.agentFab.addEventListener('click', event => {
      if (suppressAgentFabClick) {
        suppressAgentFabClick = false
        event.preventDefault()
        return
      }
      openAgentChat()
    })
    el.agentSend.addEventListener('click', handleAgentChatSubmit)
    el.agentNewChat.addEventListener('click', resetAgentChat)
    el.stageWorkspace.addEventListener('input', handleDraftEditorInput)
    el.stageWorkspace.addEventListener('keydown', event => {
      if (!event.target.closest('[data-draft-editor]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelDraftEdit()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        saveDraftEdit()
      }
    })
    el.commentList.addEventListener('keydown', event => {
      const input = event.target.closest('[data-edit-comment-input]')
      if (!input) return
      const commentId = input.dataset.editCommentInput
      if (event.key === 'Escape') {
        event.preventDefault()
        handleCancelCommentEdit(commentId)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSaveCommentEdit(commentId)
      }
    })
    el.commentList.addEventListener('scroll', () => {
      rememberCommentScroll()
      updateCommentScrollHints()
    }, { passive: true })
    el.commentInput.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') handleAddComment()
    })
    el.agentChatInput.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAgentChat()
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleAgentChatSubmit()
      }
    })
    el.clearComposerRound.addEventListener('click', () => {
      activeComposerRoundId = null
      renderAll()
      el.commentInput.focus()
    })
    el.clearTarget.addEventListener('click', () => adapter.selectTarget(null))
    el.selectionPopover.addEventListener('click', () => {
      if (selectionPopoverTarget) adapter.selectTarget(selectionPopoverTarget)
      el.selectionPopover.hidden = true
      el.commentInput.focus()
    })
    el.stageWorkspace.addEventListener('mouseup', handleTextSelection)
    el.assetUpload.addEventListener('change', () => handleAssetUpload(el.assetUpload.files?.[0]))
    el.resetDemo.addEventListener('click', () => {
      if (!window.confirm('重置当前交互原型并恢复示例数据？')) return
      activeComposerRoundId = null
      editingCommentId = null
      pageContentEdit = null
      resetAgentChat()
      closeAgentChat()
      adapter.reset({ seedComments: true })
      showToast('演示数据已重置。')
    })
    el.exportState.addEventListener('click', exportState)

    el.agentFab.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      const rect = el.agentFab.getBoundingClientRect()
      agentFabDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rect.left,
        originY: rect.top,
        moved: false,
      }
      el.agentFab.setPointerCapture?.(event.pointerId)
    })

    document.addEventListener('pointermove', event => {
      if (!agentFabDrag || event.pointerId !== agentFabDrag.pointerId) return
      const dx = event.clientX - agentFabDrag.startX
      const dy = event.clientY - agentFabDrag.startY
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) agentFabDrag.moved = true
      const next = clampAgentFabPosition({ x: agentFabDrag.originX + dx, y: agentFabDrag.originY + dy })
      el.agentFab.style.left = `${next.x}px`
      el.agentFab.style.top = `${next.y}px`
      el.agentFab.style.right = 'auto'
      el.agentFab.style.bottom = 'auto'
    })

    document.addEventListener('pointerup', event => {
      if (agentFabDrag && event.pointerId === agentFabDrag.pointerId) {
        const rect = el.agentFab.getBoundingClientRect()
        if (agentFabDrag.moved) {
          suppressAgentFabClick = true
          const snapped = snapAgentFabPosition({ x: rect.left, y: rect.top })
          applyAgentFabPosition(snapped)
        }
        agentFabDrag = null
      }
    })

    document.addEventListener('pointercancel', event => {
      if (!agentFabDrag || event.pointerId !== agentFabDrag.pointerId) return
      const rect = el.agentFab.getBoundingClientRect()
      applyAgentFabPosition(snapAgentFabPosition({ x: rect.left, y: rect.top }))
      agentFabDrag = null
    })

    document.addEventListener('pointerdown', event => {
      const item = event.target.closest('[data-layout-element-id]')
      if (!item || state.stage !== 'layout' || event.button !== 0) return
      const page = getActivePage()
      const model = page.layout.find(entry => entry.id === item.dataset.layoutElementId)
      const canvas = item.closest('.layout-canvas')
      if (!model || !canvas) return
      dragState = {
        elementId: model.id,
        pageId: page.id,
        node: item,
        canvasRect: canvas.getBoundingClientRect(),
        startX: event.clientX,
        startY: event.clientY,
        originalX: model.x,
        originalY: model.y,
        currentX: model.x,
        currentY: model.y,
      }
      item.setPointerCapture?.(event.pointerId)
    })

    document.addEventListener('pointermove', event => {
      if (!dragState) return
      const dx = (event.clientX - dragState.startX) / dragState.canvasRect.width * 100
      const dy = (event.clientY - dragState.startY) / dragState.canvasRect.height * 100
      dragState.currentX = Math.max(0, Math.min(95, dragState.originalX + dx))
      dragState.currentY = Math.max(0, Math.min(92, dragState.originalY + dy))
      dragState.node.style.left = `${dragState.currentX}%`
      dragState.node.style.top = `${dragState.currentY}%`
    })

    document.addEventListener('pointerup', () => {
      if (!dragState) return
      const finished = dragState
      dragState = null
      adapter.updateLayoutElement(finished.pageId, finished.elementId, {
        x: Number(finished.currentX.toFixed(2)),
        y: Number(finished.currentY.toFixed(2)),
      })
    })

    window.addEventListener('resize', () => {
      el.selectionPopover.hidden = true
      updateCommentScrollHints()
      applyAgentFabPosition(readAgentFabPosition() || defaultAgentFabPosition())
    })
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && agentChatOpen) closeAgentChat()
    })
  }

  adapter.subscribe(nextState => {
    state = nextState
    renderAll()
  })

  bindEvents()
  renderAll()
})()
