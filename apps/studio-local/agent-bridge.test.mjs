import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentBridge } from './agent-bridge.mjs';

test('bridge is explicitly disabled when URL is absent', async () => {
  const bridge = createAgentBridge({ url: '' });
  assert.equal(bridge.configured, false);
  await assert.rejects(() => bridge.submit({ submission: { id: 's1' } }), /DSH Bridge 未配置/);
});

test('bridge sends structured review envelope and validates commands', async () => {
  let request;
  const bridge = createAgentBridge({ url: 'http://dsh.local/bridge', fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ message: '已处理', commands: [{ type: 'outline.rename', nodeId: 'o1', title: '新标题' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const result = await bridge.submit({ submission: { id: 's1' }, context: { projectId: 'p1' } });
  assert.equal(bridge.configured, true); assert.equal(request.url, 'http://dsh.local/bridge');
  const body = JSON.parse(request.options.body); assert.equal(body.kind, 'report_studio.review_submission'); assert.equal(body.submission.id, 's1'); assert.equal(result.commands[0].type, 'outline.rename');
});

test('bridge rejects malformed agent responses', async () => {
  const bridge = createAgentBridge({ url: 'http://dsh.local/bridge', fetchImpl: async () => new Response(JSON.stringify({ message: 42, commands: 'bad' }), { status: 200 }) });
  await assert.rejects(() => bridge.submit({ submission: { id: 's1' } }), /DSH Bridge 返回格式无效/);
});
