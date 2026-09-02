import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudioServer } from '../apps/studio-local/server.mjs';
import { createRepository } from '../apps/studio-local/repository.mjs';

const dir = await mkdtemp(join(tmpdir(), 'report-studio-verify-'));
const app = await createStudioServer({ dataDir: dir, port: 0 });
await app.start();
const base = `http://127.0.0.1:${app.port}`;
async function post(path, body) { const response = await fetch(`${base}${path}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) }); const json = await response.json(); if (!response.ok) throw new Error(`${path}: ${json.error || response.status}`); return json; }
try {
  const health = await fetch(`${base}/api/health`).then(r=>r.json()); assert.equal(health.ok,true); assert.equal(health.version,'v0.1.0');
  let state = await post('/api/action',{type:'project.rename',title:'v0.1.0 验收项目'});
  state = await post('/api/action',{type:'outline.add',parentId:null,title:'01 项目背景'}); const nodeId=state.outline[0].id;
  state = await post('/api/action',{type:'draft.ensurePage',outlineNodeId:nodeId}); const pageId=state.pages[0].id;
  state = await post('/api/action',{type:'draft.update',pageId,patch:{heading:'项目背景与目标',body:'这是可直接编辑的草案正文。',bullets:['现状','目标'],script:'这一页用于说明项目为什么要做。'}});
  const revisionAfterDraft=state.project.currentRevision;
  state = await post('/api/action',{type:'annotation.add',scopeKey:`draft:${pageId}`,target:{type:'page',id:pageId,label:'项目背景与目标'},instruction:'标题再聚焦一些'}); assert.equal(state.project.currentRevision,revisionAfterDraft);
  const first = await post('/api/review/submit',{scopeKey:`draft:${pageId}`}); const roundId=first.round.id; assert.equal(first.submission.number,1);
  state = await post('/api/action',{type:'annotation.add',scopeKey:`draft:${pageId}`,reviewRoundId:roundId,target:{type:'page',id:pageId,label:'项目背景与目标'},instruction:'正文补充使用对象'});
  const second = await post('/api/review/submit',{scopeKey:`draft:${pageId}`,reviewRoundId:roundId}); assert.equal(second.submission.number,2); assert.equal(second.state.reviewSubmissions.filter(s=>s.reviewRoundId===roundId).length,2);
  const beforeRestart=second.state; await app.stop(); const repo=await createRepository(dir); const recovered=repo.getState(); assert.equal(recovered.project.id,beforeRestart.project.id); assert.equal(recovered.pages[0].body,'这是可直接编辑的草案正文。'); assert.equal(recovered.reviewSubmissions.length,2);
  console.log('Report Studio v0.1.0 verification PASS'); console.log(`revision=${recovered.project.currentRevision}`); console.log(`outline_nodes=${recovered.outline.length}`); console.log(`draft_pages=${recovered.pages.length}`); console.log(`review_submissions=${recovered.reviewSubmissions.length}`);
} finally { await app.stop().catch(()=>{}); await rm(dir,{recursive:true,force:true}); }
