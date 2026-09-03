window.__ModuleLoader__.load({
  id: '@architectureworld/report-studio-dsh',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')

    const inject = ['slots', 'sessions']

    function resultMessage(result) {
      if (result?.ok) return { ok: true }
      const error = result?.error
      return {
        ok: false,
        error: error ? `${error.code || 'dsh_error'}: ${error.message || String(error)}` : 'DSH Session 拒绝了请求。',
      }
    }

    function usePromptBridge({ sessionId, sessions, source }) {
      React.useEffect(() => {
        const onMessage = async event => {
          const expected = source()
          if (!expected || event.source !== expected || event.origin !== window.location.origin) return
          const message = event.data
          if (!message || message.type !== 'report-studio.prompt' || message.sessionId !== sessionId) return
          const binding = sessions.binding(sessionId)
          const session = binding?.session
          let reply
          if (!session) {
            reply = { ok: false, error: '当前 DSH Session 不可用。' }
          } else {
            try {
              const text = String(message.text || '').trim()
              if (!text) throw new Error('Report Studio 提交了空任务。')
              reply = resultMessage(await session.prompt([{ type: 'text', text }], 'queue'))
            } catch (error) {
              reply = { ok: false, error: error?.message || String(error) }
            }
          }
          expected.postMessage({
            type: 'report-studio.prompt-result',
            requestId: message.requestId,
            sessionId,
            ...reply,
          }, window.location.origin)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [sessionId, sessions, source])
    }

    function ReportStudioView({ sessionId, sessions }) {
      const frameRef = React.useRef(null)
      const source = React.useCallback(() => frameRef.current?.contentWindow || null, [])
      usePromptBridge({ sessionId, sessions, source })
      return React.createElement('iframe', {
        ref: frameRef,
        src: `/report-studio/?sessionId=${encodeURIComponent(sessionId)}`,
        title: 'Report Studio',
        style: { width: '100%', height: '100%', minHeight: 0, border: 0, display: 'block', background: '#080b11' },
        allow: 'clipboard-read; clipboard-write',
      })
    }

    function HeaderAction({ sessionId, sessions }) {
      const childRef = React.useRef(null)
      const source = React.useCallback(() => childRef.current && !childRef.current.closed ? childRef.current : null, [])
      usePromptBridge({ sessionId, sessions, source })
      return React.createElement('button', {
        type: 'button',
        title: '独立窗口不显示 DSH 模型与会话控制；正式使用请点击会话内的 Report Studio 标签',
        onClick: () => {
          const confirmed = window.confirm(
            '即将在独立窗口打开 Report Studio。\n\n独立窗口不显示 DSH 模型、推理等级和会话控制；请在 DSH 主界面完成模型和推理等级选择。\n\n是否继续？',
          )
          if (!confirmed) return
          childRef.current = window.open(
            `/report-studio/?sessionId=${encodeURIComponent(sessionId)}`,
            `report-studio-${sessionId}`,
          )
          childRef.current?.focus()
        },
        style: {
          border: '1px solid rgba(255,255,255,.14)',
          borderRadius: 8,
          background: 'rgba(115,87,245,.16)',
          color: 'inherit',
          padding: '6px 10px',
          cursor: 'pointer',
          fontWeight: 650,
        },
      }, 'Report Studio · 独立打开')
    }

    function apply(ctx) {
      const sessions = ctx.get('sessions')
      if (!sessions) throw new Error('report-studio-dsh: sessions service unavailable')

      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'report-studio',
        order: 50,
        label: 'Report Studio',
        inject: () => ({ sessions }),
      }, ReportStudioView))

      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'report-studio',
        order: 70,
        label: 'Report Studio · 独立打开',
        inject: () => ({ sessions }),
      }, HeaderAction))
    }

    module.exports = { inject, apply }
    return module.exports
  },
})
