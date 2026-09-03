(() => {
  const sessionId = new URLSearchParams(window.location.search).get('sessionId')
  const reportStudioRoute = window.location.pathname.startsWith('/report-studio')
  const embedded = window.parent !== window
  const nativeMode = reportStudioRoute && Boolean(sessionId)

  if (reportStudioRoute && !embedded) {
    document.documentElement.classList.add('report-studio-standalone')
    const notice = document.querySelector('#report-studio-standalone-notice')
    if (notice) notice.hidden = false
  }
  if (nativeMode) document.documentElement.classList.add('report-studio-dsh-native')
  if (embedded) document.documentElement.classList.add('report-studio-dsh-embedded')
  if (!nativeMode) return

  const pendingPrompts = new Map()
  const nativeFetch = window.fetch.bind(window)

  function apiPath(path) {
    const url = new URL(`/report-studio${path}`, window.location.origin)
    url.searchParams.set('sessionId', sessionId)
    return `${url.pathname}${url.search}`
  }

  function updateNativeStatus() {
    const status = document.querySelector('#agent-status')
    if (status && status.textContent !== 'DSH 原生 Session 已连接') status.textContent = 'DSH 原生 Session 已连接'
  }

  function showRefreshNotice() {
    if (document.querySelector('#report-studio-dsh-refresh')) return
    const notice = document.createElement('button')
    notice.id = 'report-studio-dsh-refresh'
    notice.type = 'button'
    notice.textContent = 'Agent Proposal 已返回 · 点击刷新'
    notice.style.cssText = [
      'position:fixed', 'right:18px', 'top:82px', 'z-index:9999',
      'border:1px solid rgba(154,134,255,.55)', 'border-radius:10px',
      'background:#241f43', 'color:#f4f6fb', 'padding:10px 14px',
      'box-shadow:0 14px 40px rgba(0,0,0,.36)', 'cursor:pointer', 'font-weight:700',
    ].join(';')
    notice.addEventListener('click', () => window.location.reload())
    document.body.appendChild(notice)
  }

  async function watchForProposal(previousCount) {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 1500))
      try {
        const response = await nativeFetch(apiPath('/api/state'), { headers: { accept: 'application/json' } })
        if (!response.ok) continue
        const current = await response.json()
        if ((current.proposals?.length ?? 0) <= previousCount) continue
        const active = document.activeElement
        const editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
        if (editing) showRefreshNotice()
        else window.location.reload()
        return
      } catch {}
    }
  }

  function requestPrompt(prompt, previousProposalCount) {
    const target = window.parent !== window ? window.parent : window.opener
    if (!target) return Promise.reject(new Error('未找到承载 Report Studio 的 DSH 会话窗口。'))
    const requestId = `studio_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}`
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingPrompts.delete(requestId)
        reject(new Error('DSH Session 接收请求超时。'))
      }, 60000)
      pendingPrompts.set(requestId, { resolve, reject, timeout, previousProposalCount, kind: prompt.kind })
      target.postMessage({
        type: 'report-studio.prompt',
        requestId,
        sessionId,
        kind: prompt.kind,
        text: prompt.text,
      }, window.location.origin)
    })
  }

  async function reportDispatch(submissionId, status, error = null) {
    if (!submissionId) return null
    const response = await nativeFetch(apiPath(`/api/review/${encodeURIComponent(submissionId)}/dispatch`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, error }),
    })
    if (!response.ok) throw new Error('无法保存 DSH 投递状态。')
    return response.json()
  }

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
    if (pending.kind === 'report_studio.review_submission') void watchForProposal(pending.previousProposalCount)
  })

  window.fetch = async (input, init) => {
    const originalPath = typeof input === 'string' ? input : null
    const resolvedInput = originalPath?.startsWith('/api/') ? apiPath(originalPath) : input
    const response = await nativeFetch(resolvedInput, init)
    const isReviewRequest = originalPath === '/api/review/submit' || /^\/api\/review\/[^/]+\/retry$/.test(originalPath || '')
    if (!response.ok || !originalPath || !(isReviewRequest || originalPath === '/api/agent/chat')) return response
    const payload = await response.clone().json().catch(() => null)
    if (!payload?.dshPrompt) return response
    try {
      await requestPrompt(payload.dshPrompt, payload.state?.proposals?.length ?? 0)
      if (isReviewRequest) await reportDispatch(payload.submission?.id, 'dispatched')
    } catch (error) {
      if (isReviewRequest) await reportDispatch(payload.submission?.id, 'dispatch_failed', error.message).catch(() => undefined)
      throw error
    }
    const currentState = isReviewRequest
      ? await nativeFetch(apiPath('/api/state'), { headers: { accept: 'application/json' } }).then(result => result.json())
      : payload.state
    const adapted = isReviewRequest
      ? {
          ...payload,
          state: currentState,
          submission: currentState.reviewSubmissions.find(item => item.id === payload.submission?.id) ?? payload.submission,
          bridgeResult: { message: '已提交到当前 DSH Session', proposalId: null, sessionRef: sessionId },
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
