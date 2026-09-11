import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture,inputForPage,applyCandidate } from '../../test-support/design-fixture.mjs'
import { createDesignProtectionService } from './design-protection.mjs'
const module=await import('./design-batch.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
const service=fx=>{assert.equal(typeof module.createDesignBatchService,'function');return module.createDesignBatchService({repository:fx.repository,designService:fx.service,layoutService:fx.layoutService,now:()=>Date.parse('2026-09-06T00:00:00Z')})}
async function setup(t){const fx=await fixture();t.after(()=>fx.close());const run=await fx.start({pageIds:fx.repository.getState().pages.map(p=>p.id),protectedPageIds:[],allowApply:true});const batch=await service(fx).begin({sessionId:fx.sessionId,runId:run.runId,idempotencyKey:'whole-report'});return {fx,run,batch,input:{sessionId:fx.sessionId,batchId:batch.batchId}}}
test('batch begin is idempotent and inherits only the existing host scope',async t=>{
 const {fx,run,batch}=await setup(t);assert.equal((await service(fx).begin({sessionId:fx.sessionId,runId:run.runId,idempotencyKey:'whole-report'})).batchId,batch.batchId)
 await assert.rejects(service(fx).begin({sessionId:fx.sessionId,runId:run.runId,idempotencyKey:'bad',allowApply:true}),{code:'batch_invalid_input'})
 await assert.rejects(service(fx).begin({sessionId:'foreign',runId:run.runId,idempotencyKey:'bad'}),{code:'design_scope_denied'})
 assert.equal(fx.repository.getState().project.currentRevision,0)
})
test('batch advances only after exact real preview is published, and uses fresh per-page CAS',async t=>{
 const {fx,run,batch,input}=await setup(t);const batchService=service(fx)
 for(let i=0;i<run.pageIds.length;i++){
  const next=await batchService.next(input);assert.equal(next.action,'design');assert.equal(next.pageId,run.pageIds[i])
  const candidate=await fx.service.prepare(await inputForPage(fx,run,next.pageId,{idempotencyKey:next.idempotencyKey}))
  const render=await batchService.next(input);assert.equal(render.action,'render');assert.equal(render.candidate.candidateId,candidate.candidateId)
  await applyCandidate(fx,candidate)
 }
 const done=await batchService.next(input);assert.equal(done.action,'done');assert.equal(done.status,'completed');assert.equal(done.summary.completed,run.pageIds.length)
 assert.equal(fx.repository.getState().designBatches.find(b=>b.batchId===batch.batchId).receipts.length,run.pageIds.length)
})
test('restart resumes the exact existing candidate instead of making another',async t=>{
 const {fx,run,input}=await setup(t);const next=await service(fx).next(input);const c=await fx.service.prepare(await inputForPage(fx,run,next.pageId,{idempotencyKey:next.idempotencyKey}))
 await fx.reopen();const resumed=await service(fx).next(input);assert.equal(resumed.action,'render');assert.equal(resumed.candidate.candidateId,c.candidateId);assert.equal(fx.repository.getState().layoutCandidates.length,1)
})
test('failed page isolation does not let an Agent report false completion',async t=>{
 const {fx,input,run}=await setup(t);const next=await service(fx).next(input)
 await assert.rejects(service(fx).exception({...input,pageId:next.pageId,reason:'done',status:'completed'}),{code:'batch_invalid_input'})
 await service(fx).exception({...input,pageId:next.pageId,reason:'Needs a missing source image'})
 const following=await service(fx).next(input);assert.equal(following.pageId,run.pageIds[1]);assert.equal(following.summary.needsHuman,1)
})
test('three failed candidates exhaust only their page and preserve all repair evidence',async t=>{
 const {fx,input,run}=await setup(t);const next=await service(fx).next(input)
 for(let i=0;i<3;i++){
  const c=await fx.service.prepare(await inputForPage(fx,run,next.pageId,{idempotencyKey:`attempt-${i}`}))
  // State fixture represents stored host blocker results, never an Agent success receipt.
  await fx.repository.transactOperational(s=>{const row=s.layoutCandidates.find(x=>x.candidateId===c.candidateId);row.status='needs_revision';return s})
 }
 const following=await service(fx).next(input);assert.equal(following.pageId,run.pageIds[1]);assert.equal(following.summary.needsHuman,1);assert.equal(fx.repository.getState().layoutCandidates.length,3)
})
test('page locks are skipped, not counted as successful design',async t=>{
 const {fx,run,input}=await setup(t)
 await createDesignProtectionService({repository:fx.repository,layoutService:fx.layoutService}).update({pageId:run.pageIds[0],baseRevision:0,expectedProtectionRevision:0,locked:true})
 const next=await service(fx).next(input);assert.equal(next.pageId,run.pageIds[1]);assert.equal(next.summary.skippedLocked,1);assert.equal(next.summary.completed,0)
})
test('cancellation survives restart and revokes late candidate application',async t=>{
 const {fx,input,run}=await setup(t);const next=await service(fx).next(input);const c=await fx.service.prepare(await inputForPage(fx,run,next.pageId))
 await service(fx).cancel(input);await fx.reopen();assert.equal((await service(fx).next(input)).status,'cancelled')
 await assert.rejects(fx.service.previewInput({sessionId:fx.sessionId,...c}),{code:'design_scope_denied'})
})
test('multiple calls return the same active page and key, never competing publication pages',async t=>{
 const {fx,input}=await setup(t);const [a,b]=await Promise.all([service(fx).next(input),service(fx).next(input)]);assert.equal(a.pageId,b.pageId);assert.equal(a.idempotencyKey,b.idempotencyKey)
})
test('manual exception retry resumes its original candidate and cannot reset three-attempt budget',async t=>{
 const {fx,input,run}=await setup(t);const next=await service(fx).next(input),c=await fx.service.prepare(await inputForPage(fx,run,next.pageId,{idempotencyKey:next.idempotencyKey}))
 await service(fx).exception({...input,pageId:next.pageId,reason:'Transient model capacity failure'})
 assert.equal(typeof service(fx).retry,'function')
 const resumed=await service(fx).retry({...input,pageId:next.pageId});assert.equal(resumed.pageId,next.pageId);assert.equal(resumed.action,'render');assert.equal(resumed.candidate.candidateId,c.candidateId);assert.equal(fx.repository.getState().layoutCandidates.length,1)
 await assert.rejects(service(fx).retry({...input,pageId:next.pageId,resetBudget:true}),{code:'batch_invalid_input'})
})
test('one unreadable page context becomes an exception while the next page stays runnable',async t=>{
 const {fx,input,run}=await setup(t)
 const actual=fx.layoutService,layoutService={...actual,async designContext(args){if(args.pageId===run.pageIds[0])throw Object.assign(new Error('missing source blob'),{code:'layout_asset_unresolved'});return actual.designContext(args)}}
 const worker=module.createDesignBatchService({repository:fx.repository,layoutService,now:()=>Date.parse('2026-09-06T00:00:00Z')})
 const next=await worker.next(input);assert.equal(next.pageId,run.pageIds[1]);assert.equal(next.summary.needsHuman,1)
})
