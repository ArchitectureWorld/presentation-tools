(function universalStudioCore(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.StudioCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStudioCore() {
  'use strict'

  const VALID_STAGES = new Set(['outline', 'draft', 'layout'])

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function makePages() {
    return [
      {
        id: 'page-01',
        number: '01',
        title: '封面',
        eyebrow: 'SMART PARK · FEASIBILITY STUDY',
        headline: '智慧园区建设可行性研究报告',
        body: '以统一数据底座连接空间、设备与业务，形成可持续演进的园区数字能力。',
        bullets: ['项目定位', '建设范围', '预期成果'],
        metrics: [{ value: '1', label: '统一数据底座' }, { value: '3', label: '技术能力层级' }, { value: '20+', label: '扩展业务场景' }],
        script: [
          { time: '00:00', text: '本次汇报聚焦智慧园区建设的必要性、技术路径与实施计划。' },
          { time: '00:18', text: '核心不是增加孤立系统，而是建立可持续演进的统一底座。' },
        ],
        assets: [
          { id: 'asset-01-a', type: 'image', title: '园区鸟瞰概念图', meta: '图片 · 4.2 MB', theme: 'campus' },
          { id: 'asset-01-b', type: 'video', title: '园区运营场景演示', meta: '视频 · 00:36', theme: 'video' },
        ],
        layout: [
          { id: 'layout-page-01-title', type: 'text', label: '页面主标题', x: 8, y: 18, w: 42, h: 24, text: '智慧园区建设\n可行性研究报告' },
          { id: 'layout-page-01-visual', type: 'image', label: '封面主视觉', x: 54, y: 10, w: 40, h: 70, theme: 'campus' },
        ],
      },
      {
        id: 'page-02',
        number: '02',
        title: '项目背景',
        eyebrow: 'PROJECT CONTEXT',
        headline: '政策、运营与空间升级共同驱动园区数字化建设',
        body: '政策要求、存量运营压力和产业服务升级构成项目建设的三重驱动力。',
        bullets: ['政策导向持续明确', '多系统割裂增加管理成本', '园区服务需要持续迭代'],
        metrics: [{ value: '3', label: '核心驱动力' }, { value: '12', label: '现有业务系统' }, { value: '6', label: '重点建设对象' }],
        script: [
          { time: '00:00', text: '项目背景应先从政策与行业环境切入，再落到园区自身问题。' },
          { time: '00:25', text: '当前主要矛盾是系统独立建设、数据不能复用、运营反馈链路过长。' },
        ],
        assets: [
          { id: 'asset-02-a', type: 'image', title: '园区现状照片组', meta: '图片 · 8 张', theme: 'building' },
          { id: 'asset-02-b', type: 'chart', title: '政策与市场趋势图', meta: '图表 · 折线图', theme: 'chart' },
        ],
        layout: [
          { id: 'layout-page-02-title', type: 'text', label: '页面标题', x: 7, y: 10, w: 55, h: 18, text: '三重驱动力共同推动园区数字化升级' },
          { id: 'layout-page-02-chart', type: 'chart', label: '趋势图表', x: 7, y: 35, w: 45, h: 45, theme: 'chart' },
          { id: 'layout-page-02-visual', type: 'image', label: '园区现状图', x: 57, y: 30, w: 36, h: 52, theme: 'building' },
        ],
      },
      {
        id: 'page-03',
        number: '03',
        title: '需求分析',
        eyebrow: 'NEEDS ANALYSIS',
        headline: '从业务痛点反推建设边界与优先级',
        body: '围绕管理、运营、服务和空间四类对象拆解需求，先解决跨系统协同和高频业务问题。',
        bullets: ['统一身份与权限', '统一事件与工单', '统一空间与设备数据'],
        metrics: [{ value: '4', label: '需求对象' }, { value: '9', label: '关键业务链路' }, { value: '3', label: '优先建设能力' }],
        script: [
          { time: '00:00', text: '需求分析不直接罗列功能，而是从真实业务链路反推系统能力。' },
          { time: '00:30', text: '第一优先级是跨系统协同，其次是数据复用，最后才是新增应用。' },
        ],
        assets: [
          { id: 'asset-03-a', type: 'chart', title: '业务痛点优先级矩阵', meta: '图表 · 矩阵图', theme: 'matrix' },
          { id: 'asset-03-b', type: 'image', title: '业务流程示意图', meta: '图片 · SVG', theme: 'workflow' },
        ],
        layout: [
          { id: 'layout-page-03-title', type: 'text', label: '页面标题', x: 7, y: 9, w: 50, h: 18, text: '从业务痛点反推建设边界与优先级' },
          { id: 'layout-page-03-matrix', type: 'chart', label: '优先级矩阵', x: 7, y: 33, w: 50, h: 50, theme: 'matrix' },
          { id: 'layout-page-03-list', type: 'text', label: '需求要点', x: 63, y: 34, w: 30, h: 42, text: '01 统一身份与权限\n02 统一事件与工单\n03 统一空间与设备数据' },
        ],
      },
      {
        id: 'page-04',
        number: '04',
        title: '技术方案',
        eyebrow: 'TECHNICAL FOUNDATION',
        headline: '构建统一、开放、可持续演进的智慧园区技术底座',
        body: '以“统一数据底座 + 业务能力中台 + 智能应用层”为核心，打通园区内各类系统与数据，形成可持续扩展的数字化基础设施。',
        bullets: ['重点解决系统割裂、数据孤岛和重复建设问题。', '面向后续业务扩展保留标准接口和能力复用机制。'],
        metrics: [{ value: '1 个', label: '统一数据底座' }, { value: '3 层', label: '技术能力架构' }, { value: '20+', label: '可扩展业务场景' }],
        script: [
          { time: '00:00', text: '这一页重点说明，技术建设不是简单叠加系统，而是先形成统一的数据与能力底座。' },
          { time: '00:18', text: '中间的数据底座承接各类设备、业务系统与空间模型，再向上支撑运营、管理与服务应用。' },
          { time: '00:42', text: '最终目标是让新业务可以快速接入，避免后续重复建设。' },
        ],
        assets: [
          { id: 'asset-04-a', type: 'image', title: '园区数字底座示意图', meta: '图片 · 4.2 MB', theme: 'architecture' },
          { id: 'asset-04-b', type: 'video', title: '园区系统联动演示', meta: '视频 · 00:36', theme: 'video' },
          { id: 'asset-04-c', type: 'image', title: '智慧园区建筑模型', meta: '图片 · PNG', theme: 'model' },
          { id: 'asset-04-d', type: 'chart', title: '建设效益对比图', meta: '图表 · 柱状图', theme: 'chart' },
        ],
        layout: [
          { id: 'layout-page-04-title', type: 'text', label: '页面标题', x: 7, y: 14, w: 38, h: 24, text: '统一数据底座，\n支撑园区持续演进' },
          { id: 'layout-page-04-body', type: 'text', label: '页面正文', x: 7, y: 43, w: 38, h: 22, text: '通过统一数据底座承接设备、业务系统和空间模型，向上形成可复用的业务能力。' },
          { id: 'layout-page-04-visual', type: 'image', label: '右侧主视觉', x: 51, y: 10, w: 42, h: 66, theme: 'architecture' },
          { id: 'layout-page-04-metrics', type: 'chart', label: '指标区', x: 7, y: 70, w: 38, h: 16, theme: 'metrics' },
        ],
      },
      {
        id: 'page-05',
        number: '05',
        title: '实施计划',
        eyebrow: 'DELIVERY ROADMAP',
        headline: '分阶段实施，先完成底座与高优先级业务闭环',
        body: '通过基础准备、平台建设、场景接入和持续运营四个阶段控制风险，并形成滚动迭代机制。',
        bullets: ['阶段一：基础准备', '阶段二：平台建设', '阶段三：场景接入', '阶段四：持续运营'],
        metrics: [{ value: '4', label: '实施阶段' }, { value: '12', label: '计划周期（月）' }, { value: '3', label: '关键验收节点' }],
        script: [
          { time: '00:00', text: '实施上不追求一次性大而全，而是先完成底座和关键链路。' },
          { time: '00:28', text: '每个阶段都需要形成独立可验收的成果，并为下一阶段提供稳定输入。' },
        ],
        assets: [
          { id: 'asset-05-a', type: 'chart', title: '实施路线图', meta: '图表 · 时间轴', theme: 'timeline' },
          { id: 'asset-05-b', type: 'image', title: '组织协同关系图', meta: '图片 · SVG', theme: 'workflow' },
        ],
        layout: [
          { id: 'layout-page-05-title', type: 'text', label: '页面标题', x: 7, y: 10, w: 65, h: 18, text: '分阶段实施，先完成底座与高优先级业务闭环' },
          { id: 'layout-page-05-timeline', type: 'chart', label: '实施路线图', x: 7, y: 34, w: 86, h: 48, theme: 'timeline' },
        ],
      },
    ]
  }

  function makeOutline() {
    return [
      { id: 'outline-01', number: '01', title: '项目背景与目标', expanded: true, children: [
        { id: 'outline-01-01', number: '1.1', title: '项目背景' },
        { id: 'outline-01-02', number: '1.2', title: '政策与市场环境' },
        { id: 'outline-01-03', number: '1.3', title: '建设目标与范围' },
        { id: 'outline-01-04', number: '1.4', title: '预期成果' },
      ] },
      { id: 'outline-02', number: '02', title: '需求分析', expanded: true, children: [
        { id: 'outline-02-01', number: '2.1', title: '现状与核心痛点' },
        { id: 'outline-02-02', number: '2.2', title: '业务需求拆解' },
        { id: 'outline-02-03', number: '2.3', title: '建设边界与优先级' },
      ] },
      { id: 'outline-03', number: '03', title: '技术方案', expanded: false, children: [
        { id: 'outline-03-01', number: '3.1', title: '总体技术架构' },
        { id: 'outline-03-02', number: '3.2', title: '统一数据底座' },
        { id: 'outline-03-03', number: '3.3', title: '业务能力中台' },
        { id: 'outline-03-04', number: '3.4', title: 'AI 能力中心' },
        { id: 'outline-03-05', number: '3.5', title: '安全与运维体系' },
      ] },
      { id: 'outline-04', number: '04', title: '实施计划', expanded: false, children: [
        { id: 'outline-04-01', number: '4.1', title: '实施阶段' },
        { id: 'outline-04-02', number: '4.2', title: '组织与分工' },
        { id: 'outline-04-03', number: '4.3', title: '进度与验收' },
        { id: 'outline-04-04', number: '4.4', title: '运营机制' },
      ] },
      { id: 'outline-05', number: '05', title: '预期效益与风险控制', expanded: false, children: [
        { id: 'outline-05-01', number: '5.1', title: '建设效益' },
        { id: 'outline-05-02', number: '5.2', title: '风险识别' },
        { id: 'outline-05-03', number: '5.3', title: '控制措施' },
      ] },
    ]
  }

  function createInitialState(options) {
    const opts = options || {}
    const state = {
      schemaVersion: 'report-studio.state.v2',
      project: { id: 'project-demo-001', title: '智慧园区建设可行性研究报告' },
      stage: 'outline',
      activePageByStage: { draft: 'page-04', layout: 'page-04' },
      outline: makeOutline(),
      pages: makePages(),
      commentsByScope: {},
      roundsByScope: {},
      agentMessagesByScope: {},
      batchExpansionByScope: {},
      selection: null,
      counters: { comment: 1, round: 1, submission: 1, asset: 1, message: 1 },
      lastSavedAt: null,
    }
    return opts.seedComments ? seedDemoComments(state) : state
  }

  function seedDemoComments(state) {
    let next = state
    next = setStage(next, 'outline')
    next = selectTarget(next, { id: 'outline-01', type: 'outline-section', label: '01 项目背景与目标', excerpt: '项目背景与目标' })
    next = addComment(next, { text: '这一章需要先说明政策驱动，再进入项目自身背景，顺序建议调整。', createdAt: '2026-09-01T09:40:00.000Z' }).state
    const outlineSubmit = submitRound(next, { now: '2026-09-01T09:42:00.000Z' })
    next = completeRound(outlineSubmit.state, outlineSubmit.round.id, {
      summary: '已生成大纲顺序调整建议。',
      changes: ['政策与市场环境前置', '项目背景随后展开'],
    }, { now: '2026-09-01T09:42:03.000Z' }).state
    next = setRoundExpanded(next, 'outline:root', outlineSubmit.round.id, false)

    next = setStage(next, 'draft')
    next = setPage(next, 'page-04')
    next = selectTarget(next, { id: 'draft-page-04-title', type: 'text-block', label: '页面标题', excerpt: '构建统一、开放、可持续演进的智慧园区技术底座' })
    next = addComment(next, { text: '标题信息完整，但还不够像这一页的核心结论，建议再压缩 20%。', createdAt: '2026-09-01T09:47:00.000Z' }).state
    next = selectTarget(next, { id: 'draft-page-04-body', type: 'text-block', label: '页面正文', excerpt: '统一数据底座 + 业务能力中台 + 智能应用层' })
    next = addComment(next, { text: '正文建议拆成三个并列要点，方便后续排版。', createdAt: '2026-09-01T09:48:00.000Z' }).state
    const draftSubmit = submitRound(next, { now: '2026-09-01T09:50:00.000Z' })
    next = completeRound(draftSubmit.state, draftSubmit.round.id, {
      summary: '已生成标题压缩与正文拆分建议。',
      changes: ['标题改为结论句', '正文拆分为三个并列要点'],
    }, { now: '2026-09-01T09:50:03.000Z' }).state
    next = setCommentCompleted(next, draftSubmit.round.commentIds[1], true, {
      now: '2026-09-01T09:52:00.000Z',
    })
    next = editComment(next, draftSubmit.round.commentIds[0], {
      text: '标题还需要进一步压缩，保留“统一数据底座”核心表达。',
      updatedAt: '2026-09-01T10:00:00.000Z',
    }).state
    next = setRoundExpanded(next, 'draft:page-04', draftSubmit.round.id, false)
    next = selectTarget(next, { id: 'asset-04-a', type: 'asset', label: '园区数字底座示意图', excerpt: '图片 · 4.2 MB' })
    next = addComment(next, { text: '保留这张图，但后续需要替换为更清晰的矢量版本。', createdAt: '2026-09-01T10:02:00.000Z' }).state

    next = setStage(next, 'layout')
    next = setPage(next, 'page-04')
    next = selectTarget(next, { id: 'layout-page-04-visual', type: 'layout-element', label: '右侧主视觉', excerpt: '图像元素' })
    next = addComment(next, { text: '主视觉占比略大，建议向右收窄约 8%。' }).state
    next = selectTarget(next, null)
    next = setStage(next, 'draft')
    return next
  }

  function scopeKeyFor(stage, pageId) {
    if (!VALID_STAGES.has(stage)) throw new Error(`未知阶段：${stage}`)
    if (stage === 'outline') return 'outline:root'
    if (!pageId) throw new Error(`${stage} 阶段需要 pageId`)
    return `${stage}:${pageId}`
  }

  function getActivePageId(state) {
    if (state.stage === 'outline') return null
    return state.activePageByStage[state.stage]
  }

  function currentScopeKey(state) {
    return scopeKeyFor(state.stage, getActivePageId(state))
  }

  function findRoundLocation(state, roundId) {
    for (const [scopeKey, rounds] of Object.entries(state.roundsByScope || {})) {
      const index = rounds.findIndex(round => round.id === roundId)
      if (index >= 0) return { scopeKey, index, round: rounds[index] }
    }
    return null
  }

  function isCompletedStatus(status) {
    return status === 'completed' || status === 'processed'
  }

  function isReviewStatus(status) {
    return status === 'responded' || status === 'review'
  }

  function getBatchProgress(comments) {
    const list = Array.isArray(comments) ? comments : []
    const completed = list.filter(comment => isCompletedStatus(comment.status)).length
    return { completed, unfinished: list.length - completed }
  }

  function commentsForBatch(state, scopeKey, roundId) {
    const comments = state.commentsByScope[scopeKey] || []
    if (!roundId) return comments.filter(comment => comment.status === 'staged' && !comment.submittedRoundId)
    const round = (state.roundsByScope[scopeKey] || []).find(item => item.id === roundId)
    if (!round) throw new Error(`未找到批注轮次：${roundId}`)
    const commentIds = new Set(round.commentIds || [])
    return comments.filter(comment => commentIds.has(comment.id))
  }

  function getBatchStats(state, scopeKey, roundId) {
    const comments = commentsForBatch(state, scopeKey, roundId)
    const progress = getBatchProgress(comments)
    const processing = comments.filter(comment => comment.status === 'submitted').length
    const submittable = comments.filter(comment => comment.status === 'staged' || isReviewStatus(comment.status)).length
    return {
      total: comments.length,
      completed: progress.completed,
      unfinished: progress.unfinished,
      submittable,
      processing,
    }
  }

  function getRoundCommentCounts(state, roundId) {
    const location = findRoundLocation(state, roundId)
    if (!location) throw new Error(`未找到批注轮次：${roundId}`)
    const stats = getBatchStats(state, location.scopeKey, roundId)
    return { completed: stats.completed, unfinished: stats.unfinished, total: stats.total }
  }

  function ensureBatchExpansion(state, scopeKey) {
    if (!state.batchExpansionByScope) state.batchExpansionByScope = {}
    if (!state.batchExpansionByScope[scopeKey]) state.batchExpansionByScope[scopeKey] = {}
    return state.batchExpansionByScope[scopeKey]
  }

  function setRoundExpanded(state, scopeKey, roundId, expanded) {
    const rounds = state.roundsByScope[scopeKey] || []
    if (!rounds.some(round => round.id === roundId)) throw new Error(`未找到批注轮次：${roundId}`)
    const next = clone(state)
    const expansion = ensureBatchExpansion(next, scopeKey)
    expansion[roundId] = Boolean(expanded)
    next.lastSavedAt = new Date().toISOString()
    return next
  }

  function isRoundExpanded(state, scopeKey, round) {
    const stored = state.batchExpansionByScope?.[scopeKey]?.[round.id]
    if (typeof stored === 'boolean') return stored
    return round.status === 'processing'
  }

  function findPage(state, pageId) {
    return state.pages.find(page => page.id === pageId)
  }

  function setStage(state, stage) {
    if (!VALID_STAGES.has(stage)) throw new Error(`未知阶段：${stage}`)
    const next = clone(state)
    next.stage = stage
    next.selection = null
    return next
  }

  function setPage(state, pageId) {
    if (!findPage(state, pageId)) throw new Error(`页面不存在：${pageId}`)
    if (state.stage === 'outline') throw new Error('大纲阶段不能切换页面')
    const next = clone(state)
    next.activePageByStage[next.stage] = pageId
    next.selection = null
    return next
  }

  function selectTarget(state, target) {
    const next = clone(state)
    next.selection = target ? clone(target) : null
    return next
  }

  function fallbackTarget(state) {
    if (state.stage === 'outline') {
      return { id: 'outline-root', type: 'outline', label: '整份大纲', excerpt: '整份大纲' }
    }
    const pageId = getActivePageId(state)
    const page = findPage(state, pageId)
    return { id: pageId, type: 'page', label: `第${page.number}页 · ${page.title}`, excerpt: page.headline }
  }

  function refreshRoundStatus(state, scopeKey, roundId) {
    const round = (state.roundsByScope[scopeKey] || []).find(item => item.id === roundId)
    if (!round) return
    const stats = getBatchStats(state, scopeKey, roundId)
    if (stats.processing > 0) round.status = 'processing'
    else if (stats.total > 0 && stats.unfinished === 0) round.status = 'completed'
    else if (round.status !== 'failed') round.status = 'ready'
  }

  function addComment(state, input) {
    const text = String(input && input.text ? input.text : '').trim()
    if (!text) throw new Error('批注不能为空')
    const next = clone(state)
    const scopeKey = currentScopeKey(next)
    const roundId = input && input.roundId ? String(input.roundId) : null
    let round = null
    if (roundId) {
      const location = findRoundLocation(next, roundId)
      if (!location || location.scopeKey !== scopeKey) throw new Error(`当前作用域未找到批注轮次：${roundId}`)
      if (location.round.status === 'processing') throw new Error('该轮正在处理中，暂时不能补充批注')
      round = location.round
    }
    const target = next.selection ? clone(next.selection) : fallbackTarget(next)
    const createdAt = input.createdAt || new Date().toISOString()
    const comment = {
      id: `comment-${String(next.counters.comment).padStart(3, '0')}`,
      number: (next.commentsByScope[scopeKey] || []).length + 1,
      scopeKey,
      stage: next.stage,
      pageId: getActivePageId(next),
      target,
      text,
      status: 'staged',
      createdAt,
      updatedAt: createdAt,
      submittedRoundId: roundId,
    }
    next.counters.comment += 1
    if (!next.commentsByScope[scopeKey]) next.commentsByScope[scopeKey] = []
    next.commentsByScope[scopeKey].push(comment)
    if (round) {
      if (!Array.isArray(round.commentIds)) round.commentIds = []
      if (!round.commentIds.includes(comment.id)) round.commentIds.push(comment.id)
      round.updatedAt = createdAt
      round.status = 'ready'
      ensureBatchExpansion(next, scopeKey)[round.id] = true
    }
    next.lastSavedAt = createdAt
    return { state: next, comment: clone(comment) }
  }

  function normalizeCommentUpdate(textOrInput, options) {
    if (textOrInput && typeof textOrInput === 'object') {
      return {
        text: String(textOrInput.text || '').trim(),
        now: textOrInput.updatedAt || textOrInput.now || options?.now || new Date().toISOString(),
      }
    }
    return {
      text: String(textOrInput || '').trim(),
      now: options?.now || new Date().toISOString(),
    }
  }

  function updateComment(state, commentId, textOrInput, options) {
    const input = normalizeCommentUpdate(textOrInput, options)
    if (!input.text) throw new Error('批注不能为空')
    const next = clone(state)
    let found = null
    let foundScope = null
    for (const [scopeKey, comments] of Object.entries(next.commentsByScope || {})) {
      const comment = comments.find(item => item.id === commentId)
      if (!comment) continue
      if (comment.status === 'submitted') throw new Error('该批注正在处理中，暂时不能编辑')
      comment.text = input.text
      comment.status = 'staged'
      comment.updatedAt = input.now
      found = comment
      foundScope = scopeKey
      break
    }
    if (!found || !foundScope) throw new Error(`未找到批注：${commentId}`)
    if (found.submittedRoundId) {
      const location = findRoundLocation(next, found.submittedRoundId)
      if (location) {
        location.round.status = 'ready'
        location.round.updatedAt = input.now
        ensureBatchExpansion(next, foundScope)[location.round.id] = true
      }
    }
    next.lastSavedAt = input.now
    return next
  }

  function editComment(state, commentId, input, options) {
    const next = updateComment(state, commentId, input, options)
    const comment = Object.values(next.commentsByScope || {}).flat().find(item => item.id === commentId)
    return { state: next, comment: clone(comment) }
  }

  function setCommentCompleted(state, commentId, completed, options) {
    const next = clone(state)
    const now = options?.now || new Date().toISOString()
    let found = null
    let foundScope = null
    for (const [scopeKey, comments] of Object.entries(next.commentsByScope || {})) {
      const comment = comments.find(item => item.id === commentId)
      if (!comment) continue
      if (comment.status === 'submitted') throw new Error('该批注正在处理中，暂时不能变更状态')
      comment.status = completed ? 'completed' : (comment.submittedRoundId ? 'responded' : 'staged')
      comment.updatedAt = now
      found = comment
      foundScope = scopeKey
      break
    }
    if (!found || !foundScope) throw new Error(`未找到批注：${commentId}`)
    if (found.submittedRoundId) refreshRoundStatus(next, foundScope, found.submittedRoundId)
    next.lastSavedAt = now
    return next
  }

  function setCommentResolved(state, commentId, resolved, options) {
    return setCommentCompleted(state, commentId, resolved, options)
  }

  function buildContext(state) {
    const pageId = getActivePageId(state)
    const page = pageId ? findPage(state, pageId) : null
    return {
      outline: clone(state.outline),
      page: page ? clone(page) : null,
      selectedAssets: page ? clone(page.assets) : [],
      layout: page ? clone(page.layout) : [],
    }
  }

  function roundSubmissionHistory(round) {
    if (Array.isArray(round.submissionHistory)) return round.submissionHistory
    if (Array.isArray(round.submissions)) return round.submissions
    return []
  }

  function syncSubmissionAliases(round, submissions) {
    round.submissionHistory = submissions
    round.submissions = clone(submissions)
    round.submissionCount = submissions.length
  }

  function submitRound(state, options) {
    const opts = options || {}
    const now = opts.now || new Date().toISOString()
    const next = clone(state)
    const scopeKey = currentScopeKey(next)
    const requestedRoundId = opts.roundId ? String(opts.roundId) : null
    let round
    let candidates

    if (requestedRoundId) {
      const location = findRoundLocation(next, requestedRoundId)
      if (!location || location.scopeKey !== scopeKey) throw new Error(`当前作用域未找到批注轮次：${requestedRoundId}`)
      round = location.round
      if (round.status === 'processing') throw new Error('该轮正在处理中，请等待 Agent 返回')
      candidates = commentsForBatch(next, scopeKey, round.id)
        .filter(comment => comment.status === 'staged' || isReviewStatus(comment.status))
      if (candidates.length === 0) throw new Error('该轮没有未完成的批注')
    } else {
      candidates = commentsForBatch(next, scopeKey, null)
      if (candidates.length === 0) throw new Error('当前作用域没有待提交的批注')
      round = {
        id: `round-${String(next.counters.round).padStart(3, '0')}`,
        scopeKey,
        stage: next.stage,
        pageId: getActivePageId(next),
        commentIds: candidates.map(comment => comment.id),
        status: 'processing',
        submittedAt: now,
        lastSubmittedAt: now,
        completedAt: null,
        updatedAt: now,
        result: null,
        submissionCount: 0,
        submissionHistory: [],
        submissions: [],
      }
      next.counters.round += 1
      if (!next.roundsByScope[scopeKey]) next.roundsByScope[scopeKey] = []
      next.roundsByScope[scopeKey].push(round)
    }

    const submissions = clone(roundSubmissionHistory(round))
    const submission = {
      id: `submission-${String(next.counters.submission || 1).padStart(3, '0')}`,
      number: submissions.length + 1,
      commentIds: candidates.map(comment => comment.id),
      status: 'processing',
      submittedAt: now,
      completedAt: null,
      result: null,
    }
    next.counters.submission = (next.counters.submission || 1) + 1
    submissions.push(submission)
    syncSubmissionAliases(round, submissions)
    round.status = 'processing'
    round.lastSubmittedAt = now
    round.updatedAt = now
    round.completedAt = null

    const commentIdSet = new Set(submission.commentIds)
    next.commentsByScope[scopeKey] = (next.commentsByScope[scopeKey] || []).map(comment => (
      commentIdSet.has(comment.id)
        ? { ...comment, status: 'submitted', submittedRoundId: round.id, updatedAt: now }
        : comment
    ))

    const expansion = ensureBatchExpansion(next, scopeKey)
    for (const existing of next.roundsByScope[scopeKey] || []) {
      if (existing.id !== round.id && existing.status !== 'processing') expansion[existing.id] = false
    }
    expansion[round.id] = true

    const payload = {
      schemaVersion: 'report-studio.prototype.v1',
      projectId: next.project.id,
      stage: round.stage,
      scopeKey,
      pageId: round.pageId,
      roundId: round.id,
      submissionId: submission.id,
      submissionNumber: submission.number,
      submittedAt: now,
      context: buildContext(next),
      comments: candidates.map(comment => clone(comment)),
    }
    next.lastSavedAt = now
    return { state: next, payload, round: clone(round), submission: clone(submission) }
  }

  function completeRound(state, roundId, result, options) {
    const opts = options || {}
    const now = opts.now || new Date().toISOString()
    const next = clone(state)
    const location = findRoundLocation(next, roundId)
    if (!location) throw new Error(`未找到批注轮次：${roundId}`)
    const round = location.round
    const submissions = clone(roundSubmissionHistory(round))
    const submissionIndex = [...submissions].map((item, index) => ({ item, index })).reverse()
      .find(entry => entry.item.status === 'processing')?.index
    if (submissionIndex === undefined) throw new Error(`批注轮次没有处理中提交：${roundId}`)
    const submission = submissions[submissionIndex]

    submission.status = 'completed'
    submission.completedAt = now
    submission.result = clone(result)
    syncSubmissionAliases(round, submissions)
    round.completedAt = now
    round.updatedAt = now
    round.result = clone(result)

    const commentIds = new Set(submission.commentIds)
    next.commentsByScope[location.scopeKey] = (next.commentsByScope[location.scopeKey] || []).map(comment => (
      commentIds.has(comment.id) && comment.status === 'submitted'
        ? { ...comment, status: 'responded', updatedAt: now }
        : comment
    ))
    refreshRoundStatus(next, location.scopeKey, roundId)

    const message = {
      id: `agent-message-${String(next.counters.message).padStart(3, '0')}`,
      roundId,
      submissionId: submission.id,
      submissionNumber: submission.number,
      scopeKey: location.scopeKey,
      createdAt: now,
      summary: result.summary || 'Agent 已完成本轮处理。',
      changes: Array.isArray(result.changes) ? clone(result.changes) : [],
    }
    next.counters.message += 1
    if (!next.agentMessagesByScope[location.scopeKey]) next.agentMessagesByScope[location.scopeKey] = []
    next.agentMessagesByScope[location.scopeKey].push(message)
    next.lastSavedAt = now
    return { state: next, round: clone(round), submission: clone(submission), message: clone(message) }
  }

  function failRound(state, roundId, message, options) {
    const opts = options || {}
    const now = opts.now || new Date().toISOString()
    const next = clone(state)
    const location = findRoundLocation(next, roundId)
    if (!location) throw new Error(`未找到批注轮次：${roundId}`)
    const round = location.round
    const submissions = clone(roundSubmissionHistory(round))
    const submissionIndex = [...submissions].map((item, index) => ({ item, index })).reverse()
      .find(entry => entry.item.status === 'processing')?.index
    if (submissionIndex === undefined) throw new Error(`批注轮次没有处理中提交：${roundId}`)
    const submission = submissions[submissionIndex]
    submission.status = 'failed'
    submission.completedAt = now
    submission.result = { summary: message, changes: [] }
    syncSubmissionAliases(round, submissions)
    round.status = 'failed'
    round.completedAt = now
    round.updatedAt = now
    round.result = clone(submission.result)
    const commentIds = new Set(submission.commentIds)
    next.commentsByScope[location.scopeKey] = (next.commentsByScope[location.scopeKey] || []).map(comment => (
      commentIds.has(comment.id) ? { ...comment, status: 'staged', updatedAt: now } : comment
    ))
    next.lastSavedAt = now
    return { state: next, round: clone(round), submission: clone(submission) }
  }

  function addAsset(state, pageId, asset) {
    const next = clone(state)
    const page = findPage(next, pageId)
    if (!page) throw new Error(`页面不存在：${pageId}`)
    const normalized = {
      id: asset.id || `asset-user-${String(next.counters.asset).padStart(3, '0')}`,
      type: asset.type || 'image',
      title: asset.title || '未命名素材',
      meta: asset.meta || '用户素材',
      theme: asset.theme || 'uploaded',
      dataUrl: asset.dataUrl || null,
    }
    next.counters.asset += 1
    page.assets.push(normalized)
    return { state: next, asset: clone(normalized) }
  }

  function removeAsset(state, pageId, assetId) {
    const next = clone(state)
    const page = findPage(next, pageId)
    if (!page) throw new Error(`页面不存在：${pageId}`)
    const before = page.assets.length
    page.assets = page.assets.filter(asset => asset.id !== assetId)
    if (before === page.assets.length) throw new Error(`素材不存在：${assetId}`)
    return next
  }

  function updateDraftPage(state, pageId, patch, options) {
    return updatePageContent(state, pageId, patch, options)
  }

  function normalizePageContentInput(input) {
    const source = input || {}
    const headline = String(source.headline ?? '').trim()
    const body = String(source.body ?? '').trim()
    if (!headline) throw new Error('页面标题不能为空')
    if (!body) throw new Error('页面正文不能为空')

    const bullets = (Array.isArray(source.bullets) ? source.bullets : [])
      .map(item => String(item ?? '').trim())
    if (bullets.some(item => !item)) throw new Error('页面要点不能为空')

    const metrics = (Array.isArray(source.metrics) ? source.metrics : []).map((item, index) => {
      const value = String(item?.value ?? '').trim()
      const label = String(item?.label ?? '').trim()
      if (!value || !label) throw new Error(`第 ${index + 1} 个关键指标不能为空`)
      return { value, label }
    })

    const script = (Array.isArray(source.script) ? source.script : []).map((item, index) => {
      const time = String(item?.time ?? '').trim()
      const text = String(item?.text ?? '').trim()
      if (!time || !text) throw new Error(`第 ${index + 1} 段讲解脚本不能为空`)
      return { time, text }
    })

    return { headline, body, bullets, metrics, script }
  }

  function updatePageContent(state, pageId, input, options) {
    const next = clone(state)
    const page = findPage(next, pageId)
    if (!page) throw new Error(`页面不存在：${pageId}`)
    const content = normalizePageContentInput(input)

    page.headline = content.headline
    page.body = content.body
    page.bullets = content.bullets
    page.metrics = content.metrics
    page.script = content.script

    const titleElement = page.layout.find(item => item.id === `layout-${pageId}-title`)
    const bodyElement = page.layout.find(item => item.id === `layout-${pageId}-body`)
    const listElement = page.layout.find(item => item.id === `layout-${pageId}-list`)
    if (titleElement) titleElement.text = content.headline
    if (bodyElement) bodyElement.text = content.body
    if (listElement) listElement.text = content.bullets.join('\n')

    next.lastSavedAt = options?.now || new Date().toISOString()
    return next
  }

  function updateLayoutElement(state, pageId, elementId, patch) {
    const next = clone(state)
    const page = findPage(next, pageId)
    if (!page) throw new Error(`页面不存在：${pageId}`)
    const element = page.layout.find(item => item.id === elementId)
    if (!element) throw new Error(`排版元素不存在：${elementId}`)
    Object.assign(element, patch)
    return next
  }

  return {
    createInitialState,
    scopeKeyFor,
    currentScopeKey,
    setRoundExpanded,
    isRoundExpanded,
    getActivePageId,
    findPage,
    setStage,
    setPage,
    selectTarget,
    addComment,
    updateComment,
    editComment,
    setCommentResolved,
    setCommentCompleted,
    getBatchProgress,
    getBatchStats,
    getRoundCommentCounts,
    submitRound,
    completeRound,
    failRound,
    addAsset,
    removeAsset,
    updateDraftPage,
    updatePageContent,
    updateLayoutElement,
  }
})
