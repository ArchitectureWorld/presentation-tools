import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from './repository.mjs';
import { createStudioServer } from './server.mjs';
import { createStudioId } from '../../packages/studio-contracts/index.mjs';

const png = (width = 1, height = 1) => Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,(width >>> 24)&255,(width >>> 16)&255,(width >>> 8)&255,width&255,(height >>> 24)&255,(height >>> 16)&255,(height >>> 8)&255,height&255,8,2,0,0,0]);

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
    const health = await fetch(`${base}/api/health`).then(r => r.json()); assert.equal(health.ok, true); assert.equal(health.version, 'v0.1.1');
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
  let receivedContext;
  const bridge = { configured: true, async submit({ submission }) { return { message: '建议修改标题', commands: [{ type: 'outline.rename', nodeId: 'placeholder', title: '新标题' }], submissionId: submission.id }; }, async chat() { return { message: 'ok', commands: [] }; } };
  const app = await createStudioServer({ dataDir: dir, port: 0, agentBridge: bridge }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    let state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'outline.add', parentId:null, title:'第一章', baseRevision:0 }) }).then(r=>r.json());
    const nodeId = state.outline[0].id;
    bridge.submit = async ({ submission, context }) => {
      receivedContext = context;
      const duringDispatch = app.repository.getState();
      assert.equal(duringDispatch.reviewRuns.length, 1);
      assert.equal(duringDispatch.reviewRuns[0].integrationState, 'pending_dispatch');
      return ({
      submissionId: submission.id,
      projectId: submission.projectId,
      baseRevision: submission.baseRevision,
      scopeKey: submission.scopeKey,
      sessionRef: 'dsh-session-bridge',
      message: '建议修改标题',
      commands: [{
        commandId: createStudioId('command'), type: 'outline.rename', nodeId, title: '第一章：目标',
        scopeKey: submission.scopeKey, baseRevision: submission.baseRevision, riskLevel: 'ordinary_reversible',
        sourceAnnotationIds: [submission.annotationSnapshots[0].annotationId],
      }],
      });
    };
    state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'annotation.add', scopeKey:'outline:root', target:{type:'outline-node',id:nodeId,label:'第一章'}, instruction:'标题更具体' }) }).then(r=>r.json());
    const review = await fetch(`${base}/api/review/submit`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ scopeKey:'outline:root' }) }).then(r=>r.json());
    assert.equal(review.bridgeResult.message, '建议修改标题'); assert.ok(review.bridgeResult.proposalId); assert.equal(review.state.proposals.length, 1); assert.equal(review.state.outline[0].title, '第一章');
    assert.equal(review.state.reviewSubmissions[0].status, 'proposal_created');
    assert.equal(review.state.reviewRuns.length, 1);
    assert.equal(review.state.reviewRuns[0].reviewSubmissionId, review.submission.id);
    assert.equal(review.state.reviewRuns[0].sessionId, 'dsh-session-bridge');
    assert.equal(review.state.reviewRuns[0].integrationState, 'proposal_created');
    assert.equal(review.state.reviewRuns[0].resultProposalId, review.bridgeResult.proposalId);
    assert.equal(receivedContext.submission.reviewSubmissionId, review.submission.id);
    assert.equal(receivedContext.taskScope.allowedCommands.includes('outline.delete'), false);
    assert.equal('pages' in receivedContext, false);
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('HTTP Proposal reject and return actions are persisted without creating a Revision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-proposal-actions-'));
  const app = await createStudioServer({ dataDir: dir, port: 0 }); await app.start();
  try {
    const state = app.repository.getState();
    await app.repository.transactOperational(current => ({
      ...current,
      reviewSubmissions: [
        { id: 'submission_reject', status: 'proposal_created', activeReviewRunId: 'run_reject' },
        { id: 'submission_return', status: 'proposal_created', activeReviewRunId: 'run_return' },
      ],
      reviewRuns: [
        { id: 'run_reject', reviewRunId: 'run_reject', reviewSubmissionId: 'submission_reject', dispatchAttempt: 1, integrationState: 'proposal_created', resultProposalId: 'proposal_reject' },
        { id: 'run_return', reviewRunId: 'run_return', reviewSubmissionId: 'submission_return', dispatchAttempt: 1, integrationState: 'proposal_created', resultProposalId: 'proposal_return' },
      ],
      proposals: [
        { id: 'proposal_reject', submissionId: 'submission_reject', status: 'pending', baseRevision: state.project.currentRevision },
        { id: 'proposal_return', submissionId: 'submission_return', status: 'pending', baseRevision: state.project.currentRevision },
      ],
    }));
    const base = `http://127.0.0.1:${app.port}`;
    const rejectedResponse = await fetch(`${base}/api/proposal/proposal_reject/reject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(rejectedResponse.status, 200, await rejectedResponse.text());
    const returnedResponse = await fetch(`${base}/api/proposal/proposal_return/return`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(returnedResponse.status, 200, await returnedResponse.text());
    const after = app.repository.getState();
    assert.equal(after.proposals.find(item => item.id === 'proposal_reject').status, 'rejected');
    assert.equal(after.proposals.find(item => item.id === 'proposal_return').status, 'returned_to_agent');
    assert.equal(after.project.currentRevision, state.project.currentRevision);
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('controlled asset ingestion stores binary outside state and serves only referenced assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-ingestion-'));
  const app = await createStudioServer({ dataDir: dir, port: 0 }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    let state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'outline.add', parentId:null, title:'图片页', baseRevision:0 }) }).then(r=>r.json());
    state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'draft.ensurePage', outlineNodeId:state.outline[0].id, baseRevision:state.project.currentRevision }) }).then(r=>r.json());
    const upload = await fetch(`${base}/api/assets/ingest?pageId=${encodeURIComponent(state.pages[0].id)}`, { method:'POST', headers:{'content-type':'image/png','x-file-name':'preview.png'}, body:png() });
    const uploadText = await upload.text();
    assert.equal(upload.status, 200, uploadText);
    const asset = JSON.parse(uploadText);
    state = await fetch(`${base}/api/state`).then(r=>r.json());
    assert.equal(JSON.stringify(state).includes('dataUrl'), false);
    assert.equal(JSON.stringify(state).includes('base64'), false);
    assert.equal(state.pages[0].assets[0].objectRef.sha256, asset.objectRef.sha256);
    assert.equal(state.pages[0].assets[0].widthPx, 1);
    assert.equal(state.pages[0].assets[0].heightPx, 1);
    assert.equal((await fetch(`${base}/api/assets/${asset.assetId}/content`)).status, 200);
    assert.equal((await fetch(`${base}/api/assets/not-current/content`)).status, 404);
  } finally { await app.stop(); await rm(dir, { recursive:true, force:true }); }
});

test('asset ingestion rejects truncated, zero-size and implausibly large image dimensions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-image-validation-'));
  const app = await createStudioServer({ dataDir: dir, port: 0 }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    let state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'outline.add', parentId:null, title:'图片页', baseRevision:0 }) }).then(r=>r.json());
    state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'draft.ensurePage', outlineNodeId:state.outline[0].id, baseRevision:state.project.currentRevision }) }).then(r=>r.json());
    for (const bytes of [png().subarray(0, 12), png(0, 1), png(20000, 20000)]) {
      const response = await fetch(`${base}/api/assets/ingest?pageId=${state.pages[0].id}`, { method:'POST', headers:{'content-type':'image/png','x-file-name':'bad.png'}, body:bytes });
      assert.equal(response.status, 400, await response.text());
    }
    const mismatch = await fetch(`${base}/api/assets/ingest?pageId=${state.pages[0].id}`, { method:'POST', headers:{'content-type':'image/jpeg','x-file-name':'mismatch.jpg'}, body:png() });
    assert.equal(mismatch.status, 400);
  } finally { await app.stop(); await rm(dir, { recursive:true, force:true }); }
});

test('HTTP draft updates cannot publish new inline Data URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-inline-reject-'));
  const app = await createStudioServer({ dataDir: dir, port: 0 }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    let state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'outline.add', parentId:null, title:'页面', baseRevision:0 }) }).then(r=>r.json());
    state = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'draft.ensurePage', outlineNodeId:state.outline[0].id, baseRevision:state.project.currentRevision }) }).then(r=>r.json());
    const response = await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'draft.update', pageId:state.pages[0].id, baseRevision:state.project.currentRevision, patch:{ assets:[{ id:'asset_inline', dataUrl:'data:image/png;base64,AAAA' }] } }) });
    assert.equal(response.status, 400, await response.text());
  } finally { await app.stop(); await rm(dir, { recursive:true, force:true }); }
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
    assert.equal(state.reviewRuns[0].dispatchAttempt, 1);
    assert.equal(state.reviewRuns[0].integrationState, 'dispatch_failed');
    shouldFail = false;
    const retried = await fetch(`${base}/api/review/${submissionId}/retry`, { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
    assert.equal(retried.status, 200);
    const retriedPayload = await retried.json();
    assert.equal(retriedPayload.submission.id, submissionId);
    assert.equal(retriedPayload.state.reviewSubmissions[0].status, 'dispatched');
    assert.deepEqual(retriedPayload.state.reviewRuns.map(run => run.dispatchAttempt), [1, 2]);
    assert.deepEqual(retriedPayload.state.reviewRuns.map(run => run.integrationState), ['dispatch_failed', 'dispatched']);
  } finally { await app.stop(); await rm(dir, { recursive:true, force:true }); }
});

test('pending Submission survives server restart and resumes without replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-pending-restart-'));
  let first;
  let second;
  try {
    first = await createStudioServer({ dataDir: dir, port: 0, agentBridge: { configured: false } }); await first.start();
    let base = `http://127.0.0.1:${first.port}`;
    await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'annotation.add', scopeKey:'outline:root', instruction:'重启恢复' }) });
    const submitted = await fetch(`${base}/api/review/submit`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ scopeKey:'outline:root' }) }).then(response => response.json());
    const originalId = submitted.submission.id;
    const originalKey = submitted.submission.idempotencyKey;
    assert.equal(submitted.submission.status, 'pending_dispatch');
    await first.stop(); first = null;

    const bridge = { configured: true, async submit() { return { message: '已恢复', commands: [] }; }, async chat() { return { message: 'ok', commands: [] }; } };
    second = await createStudioServer({ dataDir: dir, port: 0, agentBridge: bridge }); await second.start();
    base = `http://127.0.0.1:${second.port}`;
    const persisted = await fetch(`${base}/api/state`).then(response => response.json());
    assert.equal(persisted.reviewSubmissions[0].id, originalId);
    assert.equal(persisted.reviewSubmissions[0].status, 'pending_dispatch');
    const resumed = await fetch(`${base}/api/review/${originalId}/retry`, { method:'POST', headers:{'content-type':'application/json'}, body:'{}' }).then(response => response.json());
    assert.equal(resumed.submission.id, originalId);
    assert.equal(resumed.submission.idempotencyKey, originalKey);
    assert.equal(resumed.state.reviewSubmissions.length, 1);
    assert.equal(resumed.state.reviewSubmissions[0].status, 'dispatched');
    assert.equal(resumed.state.reviewRuns[0].dispatchAttempt, 1);
  } finally {
    await first?.stop().catch(() => undefined);
    await second?.stop().catch(() => undefined);
    await rm(dir, { recursive:true, force:true });
  }
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

test('HTTP standard import returns a structured conflict for a non-empty Workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-studio-standard-conflict-'));
  const app = await createStudioServer({ dataDir: dir, port: 0 }); await app.start();
  try {
    const base = `http://127.0.0.1:${app.port}`;
    await fetch(`${base}/api/action`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ type:'outline.add', parentId:null, title:'已有章节', baseRevision:0 }) });
    const projectRoot = new URL('../../contracts/presentation-standard-project/fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project/', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/u, '$1');
    const response = await fetch(`${base}/api/standard/import`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ projectRoot }) });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.error.code, 'standard_import_requires_new_workspace');
    assert.equal(payload.error.message, '当前工作区已有项目内容或评审历史。为避免覆盖数据，请在新的 DSH Session 或新的空白项目工作区中导入标准项目。');
    const state = await fetch(`${base}/api/state`).then(result => result.json());
    assert.equal(state.outline[0].title, '已有章节');
  } finally { await app.stop(); await rm(dir, { recursive: true, force: true }); }
});
