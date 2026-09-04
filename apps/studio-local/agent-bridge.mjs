function validateResult(value) {
  if (!value || typeof value !== 'object' || typeof value.message !== 'string' || !Array.isArray(value.commands)) throw new Error('DSH Bridge 返回格式无效');
  for (const command of value.commands) if (!command || typeof command !== 'object' || typeof command.type !== 'string') throw new Error('DSH Bridge 返回格式无效');
  return {
    submissionId: value.submissionId,
    projectId: value.projectId,
    baseRevision: value.baseRevision,
    scopeKey: value.scopeKey,
    idempotencyKey: value.idempotencyKey,
    message: value.message,
    commands: structuredClone(value.commands),
    sessionRef: value.sessionRef ?? null,
  };
}

export function createAgentBridge({ url = process.env.REPORT_STUDIO_AGENT_URL || '', fetchImpl = fetch, timeoutMs = Number(process.env.REPORT_STUDIO_AGENT_TIMEOUT_MS || 60000) } = {}) {
  const endpoint = String(url || '').trim();
  async function call(payload) {
    if (!endpoint) throw new Error('DSH Bridge 未配置');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      if (!response.ok) throw new Error(`DSH Bridge HTTP ${response.status}`);
      return validateResult(await response.json());
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('DSH Bridge 请求超时');
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    configured: Boolean(endpoint), endpoint,
    submit({ submission, context = null }) { return call({ kind: 'report_studio.review_submission', submission, context }); },
    chat({ text, context = null }) {
      const clean = String(text || '').trim(); if (!clean) throw new Error('消息不能为空');
      return call({ kind: 'report_studio.chat', text: clean, context });
    },
  };
}
