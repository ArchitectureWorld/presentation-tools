import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    const response = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'outline.add', parentId: null, title: '第一章', baseRevision: state.project.currentRevision }) });
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
    let state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'outline.add', parentId:null, title:'第一章', baseRevision:0 }) }).then(r=>r.json());
    const nodeId = state.outline[0].id;
    bridge.submit = async ({ submission }) => ({ message:'建议修改标题', commands:[{ type:'outline.rename', nodeId, title:'第一章：目标' }], submissionId:submission.id });
    state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'annotation.add', scopeKey:'outline:root', target:{type:'outline-node',id:nodeId,label:'第一章'}, instruction:'标题更具体' }) }).then(r=>r.json());
    const review = await fetch(`${base}/api/review/submit`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ scopeKey:'outline:root' }) }).then(r=>r.json());
    assert.equal(review.bridgeResult.message, '建议修改标题'); assert.ok(review.bridgeResult.proposalId); assert.equal(review.state.proposals.length, 1); assert.equal(review.state.outline[0].title, '第一章');
    assert.equal(review.state.reviewSubmissions[0].status, 'proposal_created');
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('configured bridge failure is persisted and the same submission can be retried', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-agent-failure-'));
  let shouldFail = true;
  const bridge = { configured:true, async submit() { if (shouldFail) throw new Error('bridge unavailable'); return { message:'恢复成功', commands:[], sessionRef:'bridge-test' }; }, async chat() { return { message:'ok', commands:[] }; } };
  const app = await createStudioServer({ dataDir: dir, port: 0, agentBridge: bridge }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    let state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'annotation.add', scopeKey:'outline:root', instruction:'需要重试' }) }).then(response => response.json());
    const failed = await fetch(`${base}/api/review/submit`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ scopeKey:'outline:root' }) });
    assert.equal(failed.status, 502);
    const failedPayload = await failed.json();
    assert.equal(failedPayload.error.code, 'dispatch_failed');
    const submissionId = failedPayload.submission.id;
    state = await fetch(`${base}/api/state`).then(response => response.json());
    assert.equal(state.reviewSubmissions[0].status, 'dispatch_failed');
    shouldFail = false;
    const retried = await fetch(`${base}/api/review/${submissionId}/retry`, { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
    assert.equal(retried.status, 200);
    const retriedPayload = await retried.json();
    assert.equal(retriedPayload.submission.id, submissionId);
    assert.equal(retriedPayload.state.reviewSubmissions[0].status, 'dispatched');
  } finally { await app.stop(); await rm(dir, { recursive:true, force:true }); }
});

test('HTTP API exposes migration status and blocks writes until confirmed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-migration-api-'));
  await writeFile(join(dir, 'state.json'), `${JSON.stringify({ schemaVersion:'report-studio.v0.1.0', project:{ id:'project_old', title:'旧数据', currentRevision:0, createdAt:'2026-09-01T00:00:00.000Z', updatedAt:'2026-09-01T00:00:00.000Z' }, outline:[], pages:[], annotations:[], reviewRounds:[], reviewSubmissions:[], proposals:[], revisions:[], ui:{ stage:'outline', activePageId:null } }, null, 2)}\n`);
  const app = await createStudioServer({ dataDir: dir, port: 0 }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const status = await fetch(`${base}/api/migration/status`).then(response => response.json());
    assert.equal(status.status, 'migration_required');
    const blocked = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'project.rename', title:'不应写入' }) });
    assert.equal(blocked.status, 428);
    assert.equal((await blocked.json()).error.code, 'migration_required');
    const migrated = await fetch(`${base}/api/migration/apply`, { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
    assert.equal(migrated.status, 200);
    assert.equal((await migrated.json()).status, 'ready');
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('HTTP API imports and exports a Contract-valid standard project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-standard-api-'));
  const app = await createStudioServer({ dataDir: dir, port: 0 }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const projectRoot = new URL('../../contracts/presentation-standard-project/fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project/', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/u, '$1');
    const imported = await fetch(`${base}/api/standard/import`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ projectRoot }) });
    const importedText = await imported.text(); assert.equal(imported.status, 200, importedText);
    const importedPayload = JSON.parse(importedText);
    assert.equal(importedPayload.state.project.id, 'project_01992a80-0000-7000-8000-000000000001');
    const exported = await fetch(`${base}/api/standard/export`, { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
    const exportedText = await exported.text(); assert.equal(exported.status, 200, exportedText);
    const exportedPayload = JSON.parse(exportedText);
    assert.equal(exportedPayload.validation.valid, true);
    assert.match(exportedPayload.projectRoot, /exports/);
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});
