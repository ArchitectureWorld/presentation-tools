import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createStudioDshRuntime} from '../../packages/studio-dsh-plugin/lib/runtime.js'
import {createRepository} from './repository.mjs'
import {readStandardProject} from '../../packages/studio-standard-adapter/index.mjs'
import {executeDesignApi} from './design-api.mjs'
import {createDesignVisualService} from './design-visual.mjs'
import {createLayoutPreviewRenderer} from './layout-preview.mjs'
import {addLiveLayoutElement} from '../../packages/studio-layout-core/index.mjs'

const request={method:'POST',headers:{host:'127.0.0.1:3080',origin:'http://127.0.0.1:3080','sec-fetch-site':'same-origin','content-type':'application/json'}}
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'direct-design-'))
  let failCommit=false
  const runtime=createStudioDshRuntime({dataRoot:root,repositoryFactory:path=>createRepository(path,{faultInjector:async point=>{if(failCommit&&point==='before_head_publish'){failCommit=false;throw new Error('synthetic write failure')}}})})
  t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true})})
  const repository=await runtime.repositoryFor('s1')
  const imported=await readStandardProject(new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/',import.meta.url),{putBlob:repository.putBlob})
  imported.snapshot.pages[0].scriptBlocks[0].referencedAssetIds=[]
  for(const page of imported.snapshot.pages)page.sourceRefs=[{provider:'pre-design',sourceProjectId:'pre-bound',sourceRevision:1,objectIds:['PS01'],evidenceIds:[]}]
  await repository.initializeFromStandardProject({snapshot:imported.snapshot})
  const pageIds=repository.getState().pages.map(row=>row.id)
  const start=(extra={})=>executeDesignApi({runtime,sessionId:'s1',operation:'start',request,body:{pageIds:[pageIds[1]],instruction:'按批注修改',...extra}})
  return {root,runtime,repository,pageIds,start,failNextCommit(){failCommit=true}}
}

test('T00 host user task grants scoped direct editing, not a second approval step',async t=>{
  const fx=await fixture(t);const {run,dshPrompt}=await fx.start()
  await assert.rejects(fx.start({allowApply:false}),/只读|刷新/)
  assert.equal(run.allowApply,true)
  assert.equal(run.executionMode,'direct')
  assert.equal(run.allowVisualGeneration,false)
  assert.match(dshPrompt.text,/Pre-design/)
  assert.doesNotMatch(dshPrompt.text,/经宿主批准|等待.*批准/)
  const context=await (await fx.runtime.designFor('s1')).context({sessionId:'s1',pageId:fx.pageIds[1]})
  assert.equal(context.rules.strategyOwner,'pre-design')
  assert.equal(context.rules.concerns,undefined)
  assert.ok(context.capabilities.stylesByType.text)
})

test('T00 direct structural edit authorizes only descendants of its original scope',async t=>{
  const fx=await fixture(t);const {run}=await fx.start({pageIds:fx.pageIds.slice(0,2)})
  const service=await fx.runtime.contentFor('s1')
  const input={sessionId:'s1',runId:run.runId,baseRevision:0,idempotencyKey:'merge',message:'合并所选两页',commands:[{type:'pages.merge',pageIds:fx.pageIds.slice(0,2),title:'合并成果'}]}
  const result=await service.prepare(input)
  assert.equal(result.status,'accepted')
  assert.equal(result.scopeConfirmationRequired,false)
  assert.equal(result.newPageIds.length,1)
  const grant=await (await fx.runtime.designFor('s1')).inspectGrant({sessionId:'s1',runId:run.runId,pageId:result.newPageIds[0]})
  assert.equal(grant.allowApply,true)
  assert.ok(grant.pageIds.includes(result.newPageIds[0]))
  assert.equal((await service.prepare(input)).proposal.id,result.proposal.id)
  if(fx.pageIds[2])await assert.rejects((await fx.runtime.designFor('s1')).inspectGrant({sessionId:'s1',runId:run.runId,pageId:fx.pageIds[2]}),/范围/)
})

test('T00 actual preview plus observation saves directly and identical retry is idempotent',async t=>{
  const fx=await fixture(t);const {run}=await fx.start();const service=await fx.runtime.designFor('s1')
  const ctx=await service.context({sessionId:'s1',pageId:fx.pageIds[1]})
  const source=ctx.sourceProjection.sources.find(row=>row.kind==='text')
  const layout=addLiveLayoutElement(ctx.layoutTemplate,{type:'text',sourceRef:source.sourceRef,frame:{x:60,y:60,width:1450,height:750,rotation:0},style:{fontSize:36}})
  const candidate=await service.prepare({sessionId:'s1',runId:run.runId,pageId:fx.pageIds[1],baseProjectRevision:0,baseLayoutRevision:null,baseLayoutSha:null,sourceStateHash:ctx.sourceStateHash,layout,sourceMapping:{},designIntent:'保留来源内容',idempotencyKey:'layout'})
  const frozen=await service.previewInput({sessionId:'s1',candidateId:candidate.candidateId,candidateSha:candidate.candidateSha})
  const preview=await createLayoutPreviewRenderer().render({...frozen,candidateSha:candidate.candidateSha,readAsset:async ref=>Buffer.concat(await Array.fromAsync(await fx.repository.openBlob(ref)))})
  await service.recordPreview({sessionId:'s1',candidateId:candidate.candidateId,candidateSha:candidate.candidateSha,preview})
  const input={sessionId:'s1',candidateId:candidate.candidateId,candidateSha:candidate.candidateSha,previewFingerprint:preview.fingerprint,observations:'文字完整且没有越界。'}
  const result=await service.submitReview(input)
  assert.equal(result.status,'accepted')
  assert.equal(fx.repository.getState().layoutCandidates[0].status,'applied')
  assert.equal((await service.submitReview(input)).id,result.id)
  assert.equal(fx.repository.getState().project.currentRevision,1)
})

test('T05/T06 failed image linking resumes without generation or approval and stores provenance internally',async t=>{
  const fx=await fixture(t);const {run}=await fx.start({allowVisualGeneration:true})
  const parent={id:'s1',session:{id:'s1'}};let resolver;let generations=0;let generated;let receiptFailures=1;let receiptCalls=0
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8wAAAABJRU5ErkJggg==','base64')
  const pre={repository:{readContext:()=>({project:{projectId:'pre-bound'}})},standardProjects:{findByPreDesignProjectId:()=>({state:'ready',presentationProjectId:fx.repository.getState().project.projectId,workspaceRoot:fx.root})},designVisualBridge:{protocol:'pre-design.page-visual.v1',bindStudioResolver(value){resolver=value;return()=>{}},async generate(_parent,input){generations++;generated={requestId:input.requestId,taskId:'task-1',assetId:'pre-asset-1',target:{studioProjectId:input.studioProjectId,pageId:input.pageId,sourceStateHash:input.sourceStateHash},image:{bytes,mimeType:'image/png',sha256:createHash('sha256').update(bytes).digest('hex'),width:1,height:1},provenance:{kind:'ai_concept',declarations:['AI 概念示意（非现场实拍）']}};return generated},async adopt(_parent,input){await resolver.resolve({...input,parent,operation:'adopt',candidate:{requestId:input.requestId,assetId:input.assetId}});return {...generated,status:'adopted_unlinked'}},async confirmLinked(_parent,input){receiptCalls++;if(receiptFailures-- > 0)throw new Error('synthetic receipt failure');return input.linkReceipt}}}
  const service=createDesignVisualService({runtime:fx.runtime,preplanning:pre,workspaceFor:async()=>fx.root});service.bind();t.after(()=>service.dispose())
  const ctx=await (await fx.runtime.designFor('s1')).context({sessionId:'s1',pageId:fx.pageIds[1]})
  const initialAssetCount=fx.repository.getState().pages.find(row=>row.id===fx.pageIds[1]).pageAssets.length
  const result=await service.generate(parent,{runId:run.runId,pageId:fx.pageIds[1],sourceStateHash:ctx.sourceStateHash,requestId:'request-1',prompt:'概念空间'})
  assert.equal(result.proposal.status,'ready')
  fx.failNextCommit()
  await assert.rejects(service.adopt(parent,{proposalId:result.proposal.id}),/synthetic write failure/)
  assert.equal(fx.repository.getState().proposals.find(row=>row.id===result.proposal.id).status,'link_failed')
  service.dispose()
  const resumedService=createDesignVisualService({runtime:fx.runtime,preplanning:pre,workspaceFor:async()=>fx.root});resumedService.bind();t.after(()=>resumedService.dispose())
  await assert.rejects(resumedService.resume(parent,{runId:run.runId,pageId:fx.pageIds[1],sourceStateHash:ctx.sourceStateHash,requestId:'request-1'}),/synthetic receipt failure/)
  const linkedPending=fx.repository.getState().proposals.find(row=>row.id===result.proposal.id)
  assert.equal(linkedPending.status,'accepted');assert.equal(linkedPending.receiptStatus,'pending');assert.equal(linkedPending.message,'图片已挂接，Pre 回执待重试');assert.equal(generations,1);assert.equal(receiptCalls,1)
  const adopted=await resumedService.resume(parent,{runId:run.runId,pageId:fx.pageIds[1],sourceStateHash:ctx.sourceStateHash,requestId:'request-1'})
  assert.equal(adopted.status,'accepted');assert.equal(adopted.receiptStatus,'confirmed');assert.equal(adopted.message,'图片已挂接，Pre 回执已确认');assert.equal(generations,1);assert.equal(receiptCalls,2)
  assert.deepEqual(adopted.linkReceipt,{kind:'presentation-tools.page-visual-link.v1',runId:run.runId,studioProjectId:fx.repository.getState().project.projectId,pageId:fx.pageIds[1],sourceStateHash:ctx.sourceStateHash.replace(/^sha256:/,''),requestId:'request-1',preAssetId:'pre-asset-1',studioAssetId:adopted.linkedAssetId,pageAssetId:adopted.linkedPageAssetId,projectRevision:1,linkedAt:adopted.acceptedAt})
  const asset=fx.repository.getState().pages.find(row=>row.id===fx.pageIds[1]).pageAssets.at(-1)
  assert.equal(asset.caption,'')
  assert.equal(asset.extensionPayload.standard.origin.type,'generated_by_plugin')
  assert.match(asset.extensionPayload.standard.origin.method,/ai_concept/)
  assert.equal((await resumedService.resume(parent,{runId:run.runId,pageId:fx.pageIds[1],sourceStateHash:ctx.sourceStateHash,requestId:'request-1'})).linkedAssetId,adopted.linkedAssetId)
  assert.equal(fx.repository.getState().pages.find(row=>row.id===fx.pageIds[1]).pageAssets.length,initialAssetCount+1)
})

test('T00 Studio uses the DSH-provided isolated review worker by default',async()=>{
  const source=await readFile(new URL('../../packages/studio-dsh-plugin/lib/index.js',import.meta.url),'utf8')
  assert.match(source,/createDshReviewWorker\(ctx/)
  assert.doesNotMatch(source,/never directly commits Project State/)
  const ui=await readFile(new URL('./public/design-ui.js',import.meta.url),'utf8')
  assert.doesNotMatch(ui,/data-design-accept|id="design-auto"/)
})
