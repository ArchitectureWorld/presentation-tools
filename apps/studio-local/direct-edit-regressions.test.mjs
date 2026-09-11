import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRepository} from './repository.mjs'
import {createReviewTaskRunner} from './review-task-runner.mjs'
import {createInitialState, executeAction, submitReviewRound, markSubmissionDispatch, applyCommandsFromAgent, beginReviewDispatch, recoverExpiredReviewDispatches} from '../../packages/studio-core/index.mjs'
import {canonicalFromState, createStudioId} from '../../packages/studio-contracts/index.mjs'

function sourceSnapshot() {
  let state = createInitialState()
  state = executeAction(state, {type:'outline.add', parentId:null, title:'上游标题'}).state
  return canonicalFromState(state)
}
async function repositoryFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'direct-edit-regression-'))
  const repository = await createRepository(root)
  t.after(async()=>{await repository.close(); await rm(root,{recursive:true,force:true})})
  return {root, repository}
}
function reviewFixture(count=3) {
  let state = createInitialState()
  state = executeAction(state,{type:'outline.add',parentId:null,title:'原始标题'}).state
  for(let n=0;n<count;n++) state=executeAction(state,{type:'annotation.add',scopeKey:'outline:root',instruction:`意见${n+1}`}).state
  const submitted=submitReviewRound(state,{scopeKey:'outline:root'})
  const begun=beginReviewDispatch(submitted.state,submitted.submission.id,{sessionId:'s1'})
  state=markSubmissionDispatch(begun.state,submitted.submission.id,{status:'dispatched',sessionId:'s1'}).state
  const submission=state.reviewSubmissions[0]
  const result={submissionId:submission.id,projectId:state.project.id,baseRevision:submission.baseRevision,scopeKey:submission.scopeKey,idempotencyKey:submission.idempotencyKey,message:'只处理第一条',commands:[{commandId:createStudioId('command'),type:'outline.rename',nodeId:state.outline[0].id,title:'已修改标题',scopeKey:submission.scopeKey,baseRevision:submission.baseRevision,riskLevel:'ordinary_reversible',sourceAnnotationIds:[state.annotations[0].id]}]}
  return {state,submission,result}
}

test('T03 saved local edits reject upstream replacement even after reopening',async t=>{
  const {root,repository}=await repositoryFixture(t)
  const snapshot=sourceSnapshot()
  await repository.publishUpstreamSnapshot({snapshot,fingerprint:'1'.repeat(64),workspaceRoot:root})
  await repository.transactContent({baseRevision:0,source:'human'},state=>executeAction(state,{type:'outline.rename',nodeId:state.outline[0].id,title:'用户已保存的标题'}).state)
  await repository.close()
  const reopened=await createRepository(root);t.after(()=>reopened.close())
  const upstream=structuredClone(snapshot);upstream.outline[0].title='上游新标题'
  await assert.rejects(reopened.publishUpstreamSnapshot({snapshot:upstream,fingerprint:'2'.repeat(64),workspaceRoot:root}),error=>error.code==='local_saved_conflict')
  assert.equal(reopened.getState().outline[0].title,'用户已保存的标题')
  assert.equal(reopened.getState().project.currentRevision,1)
})

test('T03 explicit discard updates baseline without deleting recoverable history',async t=>{
  const {root,repository}=await repositoryFixture(t);const snapshot=sourceSnapshot()
  await repository.publishUpstreamSnapshot({snapshot,fingerprint:'1'.repeat(64),workspaceRoot:root})
  await repository.transactContent({baseRevision:0},state=>executeAction(state,{type:'outline.rename',nodeId:state.outline[0].id,title:'人工版'}).state)
  const next=structuredClone(snapshot);next.outline[0].title='接受上游版'
  await repository.publishUpstreamSnapshot({snapshot:next,fingerprint:'2'.repeat(64),workspaceRoot:root,discardLocalChanges:true})
  assert.equal((await repository.getSnapshotAt(1)).outline[0].title,'人工版')
  const subsequent=structuredClone(next);subsequent.outline[0].title='下一次上游更新'
  await repository.publishUpstreamSnapshot({snapshot:subsequent,fingerprint:'3'.repeat(64),workspaceRoot:root})
  assert.equal(repository.getState().outline[0].title,'下一次上游更新')
})

test('T04 only annotations covered by actual commands are completed',()=>{
  const {state,submission,result}=reviewFixture()
  const applied=applyCommandsFromAgent(state,submission.id,result)
  assert.deepEqual(applied.state.annotations.map(a=>a.resolution),['resolved','open','open'])
  assert.deepEqual(applied.state.annotations.map(a=>a.lifecycle),['submitted','draft','draft'])
  assert.equal(applied.state.reviewSubmissions[0].completionStatus,'partially_completed')
  assert.equal(applied.state.reviewSubmissions[0].annotationResults.length,3)
  assert.equal(applied.state.proposals.length,0)
})

test('T04 changed annotation is not closed by an old response',()=>{
  const {state,submission,result}=reviewFixture(1)
  const updated=executeAction(state,{type:'annotation.update',annotationId:state.annotations[0].id,instruction:'用户已经改成另一条要求'}).state
  const applied=applyCommandsFromAgent(updated,submission.id,result)
  assert.equal(applied.state.annotations[0].resolution,'open')
  assert.equal(applied.state.annotations[0].lifecycle,'draft')
  assert.equal(applied.state.reviewSubmissions[0].annotationResults[0].status,'superseded')
})

test('T04 completed request rejects a changed payload instead of falsely reporting reused success',()=>{
  const {state,submission,result}=reviewFixture(1)
  const applied=applyCommandsFromAgent(state,submission.id,result)
  assert.equal(applyCommandsFromAgent(applied.state,submission.id,result).reused,true)
  assert.throws(()=>applyCommandsFromAgent(applied.state,submission.id,{...result,message:'不同请求'}),error=>error.code==='invalid_command')
})

test('T04 explicit partial outcome never resolves its annotation',()=>{
  const {state,submission,result}=reviewFixture(1)
  result.annotationResults=[{annotationId:state.annotations[0].id,annotationVersion:1,status:'partial',reason:'标题已改，资料仍不足',commandIds:[result.commands[0].commandId]}]
  const applied=applyCommandsFromAgent(state,submission.id,result)
  assert.equal(applied.state.annotations[0].resolution,'open')
  assert.equal(applied.state.reviewSubmissions[0].annotationResults[0].status,'partial')
})

test('T04 a post-dispatch CAS failure is recoverable and keeps current content',async t=>{
  const {repository}=await repositoryFixture(t)
  await repository.transactContent({baseRevision:0},state=>executeAction(state,{type:'outline.add',parentId:null,title:'原始'}).state)
  let begun
  await repository.transactOperational(state=>{
    state=executeAction(state,{type:'annotation.add',scopeKey:'outline:root',instruction:'修改标题'}).state
    const submitted=submitReviewRound(state,{scopeKey:'outline:root'})
    begun=beginReviewDispatch(submitted.state,submitted.submission.id,{sessionId:'s1'});return begun.state
  })
  const runner=createReviewTaskRunner({getRepository:async()=>repository,agentBridge:{configured:true,async submit(){
    await repository.transactContent({baseRevision:1},state=>executeAction(state,{type:'outline.rename',nodeId:state.outline[0].id,title:'正在执行时用户又保存了'}).state)
    const s=begun.submission
    return {submissionId:s.id,projectId:s.projectId,baseRevision:s.baseRevision,scopeKey:s.scopeKey,idempotencyKey:s.idempotencyKey,message:'旧结果',commands:[{commandId:createStudioId('command'),type:'outline.rename',nodeId:repository.getState().outline[0].id,title:'不应覆盖',scopeKey:s.scopeKey,baseRevision:s.baseRevision,riskLevel:'ordinary_reversible',sourceAnnotationIds:[s.annotationSnapshots[0].annotationId]}]}
  }}})
  t.after(()=>runner.close())
  await runner.start({sessionId:'s1',submissionId:begun.submission.id,reviewRunId:begun.reviewRun.reviewRunId})
  const outcome=await runner.wait(begun.reviewRun.taskId)
  assert.ok(outcome.error)
  const current=repository.getState()
  assert.equal(current.reviewSubmissions[0].status,'conflict')
  assert.equal(current.reviewRuns[0].integrationState,'conflict')
  assert.equal(current.outline[0].title,'正在执行时用户又保存了')
  assert.equal(current.annotations[0].resolution,'open')
})

test('T04 process interruption after dispatch is recovered after lease expiry',()=>{
  const {state}=reviewFixture(1)
  const recovered=recoverExpiredReviewDispatches(state,{at:'2099-01-01T00:00:00Z'})
  assert.equal(recovered.state.reviewSubmissions[0].status,'apply_failed')
  assert.equal(recovered.recoveredReviewRunIds.length,1)
})
