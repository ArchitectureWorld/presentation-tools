(() => {
  const sessionId = new URLSearchParams(window.location.search).get('sessionId')
  const reportStudioRoute = window.location.pathname.startsWith('/report-studio')
  const embedded = window.parent !== window
  const nativeMode = reportStudioRoute && Boolean(sessionId)

  if (!embedded) {
    document.documentElement.classList.add('report-studio-standalone')
    const notice = document.querySelector('#report-studio-standalone-notice')
    if (notice) notice.hidden = false
  }
  if (nativeMode) document.documentElement.classList.add('report-studio-dsh-native')
  if (embedded) document.documentElement.classList.add('report-studio-dsh-embedded')
  if (!nativeMode) return

  window.reportStudioNativeCapabilities = Object.freeze({ directReviewApply: true })

  const pendingPrompts = new Map()
  const watchedRuns = new Set()
  const nativeFetch = window.fetch.bind(window)

  function apiPath(path) {
    const url = new URL(`/report-studio${path}`, window.location.origin)
    url.searchParams.set('sessionId', sessionId)
    return `${url.pathname}${url.search}`
  }

  function updateNativeStatus() {
    for (const [selector, text] of [['#agent-status', '独立批注执行器'], ['#agent-chat-title', '批注处理任务'], ['.agent-chat-title-group small', 'Report Studio']]) {
      const element = document.querySelector(selector)
      if (element && element.textContent !== text) element.textContent = text
    }
    const composer = document.querySelector('.agent-chat-composer')
    if (composer) composer.hidden = true
    for (const selector of ['#agent-input', '#agent-send']) {
      const element = document.querySelector(selector)
      if (element) element.disabled = true
    }
    const fab = document.querySelector('#agent-fab')
    fab?.setAttribute('aria-label', '打开批注任务')
    fab?.setAttribute('title', '批注处理任务')
  }

  function showRefreshNotice() {
    if (document.querySelector('#report-studio-dsh-refresh')) return
    const notice = document.createElement('button')
    notice.id = 'report-studio-dsh-refresh'
    notice.type = 'button'
    notice.textContent = '批注 Agent 已完成 · 点击刷新'
    notice.style.cssText = [
      'position:fixed', 'right:18px', 'top:82px', 'z-index:9999',
      'border:1px solid rgba(154,134,255,.55)', 'border-radius:10px',
      'background:#241f43', 'color:#f4f6fb', 'padding:10px 14px',
      'box-shadow:0 14px 40px rgba(0,0,0,.36)', 'cursor:pointer', 'font-weight:700',
    ].join(';')
    notice.addEventListener('click', () => window.location.reload())
    document.body.appendChild(notice)
  }

  async function watchForReviewTask({ submissionId, reviewRunId, leaseExpiresAt }) {
    const key = reviewRunId || submissionId
    if (!key || watchedRuns.has(key)) return
    watchedRuns.add(key)
    let deadline = (Date.parse(leaseExpiresAt) || Date.now() + 120000) + 5000
    try {
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 1500))
      try {
        const response = await nativeFetch(apiPath('/api/state'), { headers: { accept: 'application/json' } })
        if (!response.ok) continue
        const current = await response.json()
        const legacyProposal = (current.proposals ?? []).find(item => item.submissionId === submissionId)
        const reviewRun = reviewRunId ? (current.reviewRuns ?? []).find(item => item.reviewRunId === reviewRunId) : null
        // A trusted native queue/turn has no execution lease. Keep its UI watcher alive while the host still reports progress.
        if (reviewRun?.executionMode === 'native' && Number.isInteger(reviewRun.nativeStartSeq) && reviewRun.leaseExpiresAt === null && !reviewRun.closedAt) {
          deadline = Date.now() + 125000
        }
        const taskTerminal = ['completed', 'partially_completed', 'no_changes', 'conflict', 'failed', 'timed_out'].includes(reviewRun?.phase)
          || reviewRun?.integrationState === 'dispatch_failed'
          || (!reviewRun?.phase && Boolean(legacyProposal))
        if (window.reportStudioApplyTaskState) {
          const appliedTerminal = window.reportStudioApplyTaskState(current, {
            submissionId,
            reviewRunId,
            autoApplyOrdinary: true,
          })
          if (appliedTerminal) return
          continue
        }
        if (!taskTerminal) continue
        const active = document.activeElement
        const editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
        if (editing) showRefreshNotice()
        else window.location.reload()
        return
      } catch {}
    }
    } finally { watchedRuns.delete(key) }
  }

  function requestPrompt(prompt, reviewTarget = {}) {
    const target = window.parent !== window ? window.parent : window.opener
    if (!target) return Promise.reject(new Error('未找到承载 Report Studio 的 DSH 会话窗口。'))
    const requestId = `studio_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}`
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingPrompts.delete(requestId)
        reject(new Error('DSH Session 接收请求超时。'))
      }, 60000)
      pendingPrompts.set(requestId, { resolve, reject, timeout, reviewTarget, kind: prompt.kind })
      target.postMessage({
        type: 'report-studio.prompt',
        requestId,
        sessionId,
        kind: prompt.kind,
        text: prompt.text,
      }, window.location.origin)
    })
  }

  async function reportDispatch(submissionId, status, error = null, reviewRunId = null) {
    if (!submissionId) return null
    const response = await nativeFetch(apiPath(`/api/review/${encodeURIComponent(submissionId)}/dispatch`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, error, reviewRunId }),
    })
    if (!response.ok) throw new Error('无法保存 DSH 投递状态。')
    return response.json()
  }
  window.reportStudioRequestPrompt = requestPrompt

  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return
    const message = event.data
    if (!message || message.type !== 'report-studio.prompt-result' || message.sessionId !== sessionId) return
    const pending = pendingPrompts.get(message.requestId)
    if (!pending) return
    window.clearTimeout(pending.timeout)
    pendingPrompts.delete(message.requestId)
    if (!message.ok) {
      pending.reject(new Error(message.error || 'DSH Session 拒绝了请求。'))
      return
    }
    pending.resolve(message)
    if (pending.kind === 'report_studio.review_submission') void watchForReviewTask(pending.reviewTarget)
  })

  window.fetch = async (input, init) => {
    const originalPath = typeof input === 'string' ? input : null
    const resolvedInput = originalPath?.startsWith('/api/') ? apiPath(originalPath) : input
    const response = await nativeFetch(resolvedInput, init)
    if (response.ok && originalPath === '/api/state') {
      const current = await response.clone().json().catch(() => null)
      for (const run of current?.reviewRuns ?? []) {
        if (run.taskId && run.parentSessionId === sessionId && !run.closedAt && ['queued', 'reading_context', 'processing'].includes(run.phase)) {
          void watchForReviewTask({ submissionId: run.reviewSubmissionId, reviewRunId: run.reviewRunId, leaseExpiresAt: run.leaseExpiresAt })
        }
      }
    }
    const isReviewRequest = originalPath === '/api/review/submit' || /^\/api\/review\/[^/]+\/retry$/.test(originalPath || '') || /^\/api\/proposal\/[^/]+\/return$/.test(originalPath || '')
    if (!response.ok || !originalPath || !(isReviewRequest || originalPath === '/api/agent/chat')) return response
    const payload = await response.clone().json().catch(() => null)
    if (isReviewRequest && payload?.task) void watchForReviewTask({ submissionId: payload.submission?.id, reviewRunId: payload.reviewRun?.reviewRunId, leaseExpiresAt: payload.reviewRun?.leaseExpiresAt })
    if (!payload?.dshPrompt) return response
    if (!isReviewRequest || !payload.task || payload.task.executionMode === 'native') {
      try {
        await requestPrompt(payload.dshPrompt, { submissionId: payload.submission?.id, reviewRunId: payload.reviewRun?.reviewRunId })
        if (isReviewRequest) await reportDispatch(payload.submission?.id, 'dispatched', null, payload.reviewRun?.reviewRunId)
      } catch (error) {
        if (isReviewRequest) await reportDispatch(payload.submission?.id, 'dispatch_failed', error.message, payload.reviewRun?.reviewRunId).catch(() => undefined)
        throw error
      }
    }
    const currentState = isReviewRequest
      ? await nativeFetch(apiPath('/api/state'), { headers: { accept: 'application/json' } }).then(result => result.json())
      : payload.state
    const adapted = isReviewRequest
      ? {
          ...payload,
          state: currentState,
          submission: currentState.reviewSubmissions.find(item => item.id === payload.submission?.id) ?? payload.submission,
          bridgeResult: { message: payload.task?.executionMode === 'native' ? '批注已交给当前 DSH 主会话' : payload.task ? '已创建批注任务' : '批注已记录，等待执行', proposalId: null, sessionRef: payload.task?.workerSessionRef ?? null },
        }
      : { ...payload, message: '已发送到当前 DSH Session', sessionRef: sessionId }
    return new Response(JSON.stringify(adapted), {
      status: response.status,
      statusText: response.statusText,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }

  const observer = new MutationObserver(updateNativeStatus)
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  window.addEventListener('DOMContentLoaded', updateNativeStatus, { once: true })
  updateNativeStatus()
})()
