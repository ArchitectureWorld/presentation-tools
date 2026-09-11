import { randomUUID } from 'node:crypto'
import { protectionFor } from './design-protection.mjs'
import { PREVIEW_CHECKS_VERSION, createPreviewFingerprint } from '../../packages/studio-layout-core/preview-fingerprint.mjs'
const clone=value=>structuredClone(value)
const fail=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status})}
function exact(input,keys){if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).some(k=>!keys.includes(k)))fail('batch_invalid_input','批量任务参数包含未知字段。',400)}
function own(state,{sessionId,batchId}){
 const batch=(state.designBatches??[]).find(b=>b.batchId===batchId)
 if(!batch||batch.sessionId!==sessionId||batch.projectId!==state.project.projectId)fail('design_scope_denied','批量任务不属于当前会话。',403)
 const run=state.designRuns.find(r=>r.runId===batch.runId&&r.sessionId===sessionId)
 if(!run)fail('design_scope_denied','批量任务授权不存在。',403)
 return {batch,run}
}
function summary(pages){return {total:pages.length,completed:pages.filter(p=>p.status==='completed').length,needsHuman:pages.filter(p=>p.status==='needs_human').length,skippedLocked:pages.filter(p=>p.status==='skipped_locked').length,pending:pages.filter(p=>p.status==='pending').length}}
/** A resumable tool protocol, not another Agent scheduler. DSH executes the returned next action. */
export function createDesignBatchService({repository,designService,layoutService,now=Date.now}){
 async function begin(input){
  exact(input,['sessionId','runId','idempotencyKey'])
  if(typeof input.idempotencyKey!=='string'||!input.idempotencyKey.trim()||input.idempotencyKey.length>200)fail('batch_invalid_input','批量任务需要有效幂等键。',400)
  let result
  await repository.transactOperational(state=>{
   const run=state.designRuns.find(r=>r.runId===input.runId&&r.sessionId===input.sessionId&&r.projectId===state.project.projectId)
   if(!run||run.status==='revoked'||!run.allowApply||run.executionMode!=='direct'||Date.parse(run.expiresAt)<=now())fail('design_scope_denied','需要有效的宿主直接修改授权。',403)
   state.designBatches??=[]
   let batch=state.designBatches.find(b=>b.runId===run.runId&&b.idempotencyKey===input.idempotencyKey)
   if(!batch){
    // One batch per grant; starting another batch cannot reset the per-page candidate budget.
    batch=state.designBatches.find(b=>b.runId===run.runId)
    if(batch)fail('batch_already_exists','该授权已有批量任务，请继续原任务。')
    batch={batchId:`design_batch_${randomUUID()}`,projectId:run.projectId,sessionId:run.sessionId,runId:run.runId,idempotencyKey:input.idempotencyKey,status:'active',activePageId:null,exceptions:[],receipts:[],pages:[],createdAt:new Date(now()).toISOString()};state.designBatches.push(batch)
   }
   result=clone(batch);return state
  });return result
 }
 async function refresh(input){
  exact(input,['sessionId','batchId']);const state=repository.getState(),{batch,run}=own(state,input)
  if(batch.status==='cancelled')return {...clone(batch),summary:summary(batch.pages),action:'done'}
  if(run.status==='revoked'||Date.parse(run.expiresAt)<=now())return {...clone(batch),status:'blocked_external',action:'done',summary:summary(batch.pages),reason:'host_grant_expired_or_revoked'}
  if(run.pageIds.length>100)fail('batch_scope_limit','任务页面超过100页上限。',400)
  const pages=[],receipts=[]
  for(const pageId of run.pageIds){
   if(!state.pages.some(p=>p.id===pageId)){pages.push({pageId,status:'needs_human',reason:'page_removed'});continue}
   const protection=protectionFor(state,pageId)
   if(protection.pageLocked||run.protectedPageIds.includes(pageId)){pages.push({pageId,status:'skipped_locked'});continue}
   const candidates=state.layoutCandidates.filter(c=>c.runId===run.runId&&c.pageId===pageId)
   let ctx
   try {
    ctx=await layoutService.designContext({pageId})
   } catch(error) {
    // A bad page is an exception, not a reason to abandon other pages.
    // Persist only a bounded error code; upstream messages can contain local paths.
    const reason=typeof error?.code==='string'&&/^[a-zA-Z0-9_]{1,100}$/.test(error.code)?error.code:'page_context_unavailable'
    pages.push({pageId,status:'needs_human',reason});continue
   }
   if(ctx.state.project.currentRevision!==state.project.currentRevision)fail('batch_stale_context','页面在检查中变化，请重试原批量任务。')
   const applied=candidates.slice().reverse().find(c=>c.status==='applied'&&c.candidateSha===ctx.layoutRef?.sha256&&c.sourceStateHash===ctx.projection.sourceStateHash&&ctx.layout?.sourceStateHash===ctx.projection.sourceStateHash)
   let valid=false
   if(applied?.validation?.valid&&applied.preview?.checks?.blockers?.length===0){
    const p=applied.preview,f=p.fingerprintInputs
    try{valid=f?.checksVersion===PREVIEW_CHECKS_VERSION&&f.candidateSha===applied.candidateSha&&f.sourceStateHash===ctx.projection.sourceStateHash&&f.sha256===p.objectRef?.sha256&&createPreviewFingerprint(f)===p.fingerprint
     if(valid)await repository.verifyBlob(p.objectRef)
    }catch{valid=false}
   }
   if(valid){pages.push({pageId,status:'completed',candidateId:applied.candidateId});receipts.push({pageId,candidateId:applied.candidateId,candidateSha:applied.candidateSha,sourceStateHash:applied.sourceStateHash,previewFingerprint:applied.preview.fingerprint,previewSha256:applied.preview.objectRef.sha256,acceptedRevision:applied.acceptedRevision});continue}
   const exception=batch.exceptions.find(p=>p.pageId===pageId)
   if(exception){pages.push({pageId,status:'needs_human',reason:exception.reason});continue}
   const latest=candidates.at(-1)
   const current=latest&&latest.baseProjectRevision===state.project.currentRevision&&latest.baseLayoutSha===(ctx.layoutRef?.sha256??null)&&latest.sourceStateHash===ctx.projection.sourceStateHash
   if(current&&['candidate','previewed','pending_review','applying'].includes(latest.status)){
    pages.push({pageId,status:'pending',action:latest.preview?'critique':'render',candidate:{candidateId:latest.candidateId,candidateSha:latest.candidateSha},checks:latest.preview?.checks??null,previewFingerprint:latest.preview?.fingerprint??null,attempts:candidates.length});continue
   }
   if(candidates.length>=3){pages.push({pageId,status:'needs_human',reason:'attempt_budget_exhausted',attempts:3});continue}
   pages.push({pageId,status:'pending',action:'design',attempts:candidates.length,idempotencyKey:`${batch.batchId}:${pageId}:${candidates.length+1}`,repairChecks:latest?.preview?.checks??null,previousError:latest?.lastError??null})
  }
  const active=pages.find(p=>p.pageId===batch.activePageId&&p.status==='pending')??pages.find(p=>p.status==='pending')
  const totals=summary(pages),status=totals.pending?'active':totals.needsHuman?'needs_human':totals.skippedLocked?'completed_with_locked_pages':'completed'
  let result
  await repository.transactOperational(draft=>{
   const {batch:stored,run:currentRun}=own(draft,input)
   if(stored.status==='cancelled'||currentRun.status==='revoked')fail('batch_cancelled','批量任务已取消。')
   if(draft.project.currentRevision!==state.project.currentRevision||JSON.stringify(draft.designProtections)!==JSON.stringify(state.designProtections))fail('batch_stale_context','批量检查基线已变化，请继续原任务。')
   stored.pages=pages;stored.receipts=receipts;stored.activePageId=active?.pageId??null;stored.status=status
   result={batchId:stored.batchId,runId:run.runId,status,summary:totals,pages:clone(pages),exceptions:clone(pages.filter(p=>p.status==='needs_human')),action:active?.action??'done',...(active?clone(active):{})};result.status=status;return draft
  });return result
 }
 async function exception(input){
  exact(input,['sessionId','batchId','pageId','reason'])
  if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)fail('batch_invalid_input','异常必须包含明确原因。',400)
  await repository.transactOperational(state=>{
   const {batch,run}=own(state,input)
   if(batch.status==='cancelled'||run.status==='revoked'||batch.activePageId!==input.pageId||!run.pageIds.includes(input.pageId))fail('design_scope_denied','只能记录当前批量任务活动页的异常。',403)
   const old=batch.exceptions.find(p=>p.pageId===input.pageId)
   if(old&&old.reason!==input.reason)fail('batch_idempotency_conflict','已记录异常不能被悄悄改写。')
   if(!old)batch.exceptions.push({pageId:input.pageId,reason:input.reason,reportedAt:new Date(now()).toISOString()})
   batch.activePageId=null;return state
  });return refresh({sessionId:input.sessionId,batchId:input.batchId})
 }
 async function retry(input){
  exact(input,['sessionId','batchId','pageId'])
  await repository.transactOperational(state=>{
   const {batch,run}=own(state,input)
   if(batch.status==='cancelled'||run.status==='revoked'||Date.parse(run.expiresAt)<=now()||!run.pageIds.includes(input.pageId))fail('design_scope_denied','当前任务不能重试该页面。',403)
   batch.exceptions=batch.exceptions.filter(e=>e.pageId!==input.pageId)
   batch.activePageId=input.pageId;return state
  })
  return refresh({sessionId:input.sessionId,batchId:input.batchId})
 }
 async function cancel(input){exact(input,['sessionId','batchId']);await repository.transactOperational(state=>{const {batch,run}=own(state,input);batch.status='cancelled';batch.activePageId=null;run.status='revoked';return state});return refresh(input)}
 return Object.freeze({begin,next:refresh,status:refresh,exception,cancel,retry})
}
