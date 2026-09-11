import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStudioDshRuntime } from '../../packages/studio-dsh-plugin/lib/runtime.js'
import { createStudioId } from '../../packages/studio-contracts/index.mjs'

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'native-direct-'))
  const runtime=createStudioDshRuntime({dataRoot:root})
  t.after(async()=>{await runtime.close(); await rm(root,{recursive:true,force:true})})
  const sessionId='native-review'
  const initial=await runtime.executeAction(sessionId,{type:'outline.add',parentId:null,title:'原始',baseRevision:0})
  await runtime.executeAction(sessionId,{type:'annotation.add',scopeKey:'outline:root',instruction:'改标题'})
  const task=await runtime.submitReview(sessionId,{scopeKey:'outline:root'})
  const s=task.submission
  const input={submissionId:s.id,projectId:s.projectId,baseRevision:s.baseRevision,scopeKey:s.scopeKey,idempotencyKey:s.idempotencyKey,message:'已改标题',commands:[{commandId:createStudioId('command'),type:'outline.rename',nodeId:initial.outline[0].id,title:'改后',scopeKey:s.scopeKey,baseRevision:s.baseRevision,riskLevel:'ordinary_reversible',sourceAnnotationIds:[s.annotationSnapshots[0].annotationId]}]}
  return {runtime,sessionId,task,input}
}

test('native Agent can finish before browser dispatch acknowledgement without waiting for approval',async t=>{
  const {runtime,sessionId,task,input}=await fixture(t)
  assert.equal(task.task.executionMode,'native')
  const result=await runtime.applyCommands(sessionId,input)
  assert.equal(result.status,'accepted')
  assert.equal(result.completionStatus,'completed')
  const ack=await runtime.updateDispatch(sessionId,task.submission.id,{status:'dispatched',reviewRunId:task.reviewRun.reviewRunId})
  assert.equal(ack.status,'accepted')
  assert.equal((await runtime.getState(sessionId)).proposals.length,0)
  assert.equal((await runtime.applyCommands(sessionId,input)).message,'已改标题')
})

test('native no-change completion remains truthful, idempotent, and does not increment revision',async t=>{
  const {runtime,sessionId,task,input}=await fixture(t)
  const request={...input,message:'缺少资料，暂未修改',commands:[],annotationResults:[{annotationId:task.submission.annotationSnapshots[0].annotationId,annotationVersion:1,status:'unresolved',reason:'缺少资料',commandIds:[]}]}
  const result=await runtime.applyCommands(sessionId,request)
  assert.equal(result.status,'no_changes')
  assert.equal(result.currentRevision,task.submission.baseRevision)
  const state=await runtime.getState(sessionId)
  assert.equal(state.annotations[0].resolution,'open')
  assert.equal(state.annotations[0].lifecycle,'draft')
  assert.equal(state.reviewRuns[0].phase,'no_changes')
  assert.equal((await runtime.applyCommands(sessionId,request)).reused,true)
  await assert.rejects(runtime.applyCommands(sessionId,{...request,message:'different'}),e=>e.code==='invalid_command')
})

test('native stale task retries with new frozen submission and late old ack cannot change it',async t=>{
  const {runtime,sessionId,task,input}=await fixture(t)
  await runtime.updateDispatch(sessionId,task.submission.id,{status:'dispatched',reviewRunId:task.reviewRun.reviewRunId})
  await runtime.executeAction(sessionId,{type:'outline.rename',nodeId:input.commands[0].nodeId,title:'用户已保存',baseRevision:input.baseRevision})
  await assert.rejects(runtime.applyCommands(sessionId,input),e=>e.code==='stale_revision')
  const retry=await runtime.retrySubmission(sessionId,task.submission.id)
  assert.notEqual(retry.submission.id,task.submission.id)
  assert.equal(retry.submission.baseRevision,input.baseRevision+1)
  assert.equal(retry.task.executionMode,'native')
  const before=(await runtime.getState(sessionId)).reviewSubmissions.at(-1)
  await runtime.updateDispatch(sessionId,task.submission.id,{status:'dispatched',reviewRunId:task.reviewRun.reviewRunId})
  assert.deepEqual((await runtime.getState(sessionId)).reviewSubmissions.at(-1),before)
})

test('native empty command cannot claim completed annotation',async t=>{
  const {runtime,sessionId,task,input}=await fixture(t)
  await assert.rejects(runtime.applyCommands(sessionId,{...input,commands:[],annotationResults:[{annotationId:task.submission.annotationSnapshots[0].annotationId,annotationVersion:1,status:'completed',reason:'不得假成功',commandIds:[]}]}),e=>e.code==='invalid_command')
  const state=await runtime.getState(sessionId)
  assert.equal(state.annotations[0].resolution,'open')
  assert.equal(state.project.currentRevision,input.baseRevision)
})
