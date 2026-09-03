import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from './repository.mjs';
import { createStudioServer } from './server.mjs';

test('repository persists state across reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-repo-'));
  try {
    const first = await createRepository(dir); const original = first.getState();
    await first.update(state => ({ ...state, project: { ...state.project, title: '测试项目' } }));
    await first.close();
    const second = await createRepository(dir);
    try { assert.equal(second.getState().project.title, '测试项目'); assert.equal(second.getState().project.id, original.project.id); }
    finally { await second.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('HTTP API exposes health, state and persisted actions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-server-'));
  const app = await createStudioServer({ dataDir: dir, port: 0 }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const health = await fetch(`${base}/api/health`).then(r => r.json()); assert.equal(health.ok, true); assert.equal(health.version, 'v0.1.0');
    let state = await fetch(`${base}/api/state`).then(r => r.json()); assert.equal(state.outline.length, 0);
    const response = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'outline.add', parentId: null, title: '第一章' }) });
    assert.equal(response.status, 200); state = await response.json(); assert.equal(state.outline[0].title, '第一章');
    await app.stop();
    const reloaded = await createRepository(dir);
    try { assert.equal(reloaded.getState().outline[0].title, '第一章'); }
    finally { await reloaded.close(); }
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('review submission through configured bridge creates a persisted proposal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-agent-'));
  const bridge = { configured: true, async submit({ submission }) { return { message: '建议修改标题', commands: [{ type: 'outline.rename', nodeId: 'placeholder', title: '新标题' }], submissionId: submission.id }; }, async chat() { return { message: 'ok', commands: [] }; } };
  const app = await createStudioServer({ dataDir: dir, port: 0, agentBridge: bridge }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    let state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'outline.add', parentId:null, title:'第一章' }) }).then(r=>r.json());
    const nodeId = state.outline[0].id;
    bridge.submit = async ({ submission }) => ({ message:'建议修改标题', commands:[{ type:'outline.rename', nodeId, title:'第一章：目标' }], submissionId:submission.id });
    state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'annotation.add', scopeKey:'outline:root', target:{type:'outline-node',id:nodeId,label:'第一章'}, instruction:'标题更具体' }) }).then(r=>r.json());
    const review = await fetch(`${base}/api/review/submit`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ scopeKey:'outline:root' }) }).then(r=>r.json());
    assert.equal(review.bridgeResult.message, '建议修改标题'); assert.ok(review.bridgeResult.proposalId); assert.equal(review.state.proposals.length, 1); assert.equal(review.state.outline[0].title, '第一章');
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});
