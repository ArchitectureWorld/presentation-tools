import assert from 'node:assert/strict'
import {mkdir,cp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fixture,inputForPage,applyCandidate,renderCandidate} from '../test-support/design-fixture.mjs'
import {createDesignBatchService} from '../apps/studio-local/design-batch.mjs'
import {createDeliveryExportService} from '../apps/studio-local/delivery-export.mjs'
import {executeAction} from '../packages/studio-core/index.mjs'
import {addLiveLayoutElement,createLayoutPage} from '../packages/studio-layout-core/index.mjs'
const out=resolve(process.argv[2]??'.tmp/unattended-verification'),fx=await fixture(),clock=()=>Date.parse('2026-09-06T00:00:00Z')
try{
 for(let i=2;i<12;i++){
  const added=await fx.repository.transactContent({baseRevision:fx.repository.getState().project.currentRevision,source:'human'},state=>executeAction(state,{type:'outline.add',parentId:null,title:`技术验收 ${String(i+1).padStart(2,'0')}`}).state)
  const nodeId=added.outline.at(-1).id
  const paged=await fx.repository.transactContent({baseRevision:added.project.currentRevision,source:'human'},state=>executeAction(state,{type:'draft.ensurePage',outlineNodeId:nodeId}).state)
  const page=paged.pages.find(p=>p.outlineNodeId===nodeId||p.sourceOutlineNodeId===nodeId)??paged.pages.at(-1)
  await fx.repository.transactContent({baseRevision:paged.project.currentRevision,source:'human'},state=>executeAction(state,{type:'draft.update',pageId:page.id,patch:{body:'自动执行、真实预览、证据核验、持久化与断点恢复。此页仅为技术测试，不构成专业策划成果。'}}).state)
 }
 const run=await fx.start({pageIds:fx.repository.getState().pages.map(p=>p.id),protectedPageIds:[],allowApply:true})
 const batchService=()=>createDesignBatchService({repository:fx.repository,layoutService:fx.layoutService,now:clock})
 const batch=await batchService().begin({sessionId:fx.sessionId,runId:run.runId,idempotencyKey:'12-pages-verification'}),input={sessionId:fx.sessionId,batchId:batch.batchId}
 let reusedCandidate=null
 for(let i=0;i<12;i++){
  const step=await batchService().next(input);assert.equal(step.action,'design')
  const context=await fx.service.context({sessionId:fx.sessionId,pageId:step.pageId}),sources=context.sourceProjection.sources
  const title=sources.find(row=>row.payload?.role==='page_title')??sources.find(row=>row.kind==='text')
  let layout=addLiveLayoutElement(createLayoutPage({projectId:context.projectId,pageId:step.pageId,baseDraftRevision:context.baseProjectRevision}),{type:'text',sourceRef:title.sourceRef,frame:{x:80,y:70,width:1440,height:120,rotation:0},style:{fontSize:48,textColor:'#20242a'}})
  const body=sources.find(row=>row.kind==='text'&&row.key!==title.key)
  if(body)layout=addLiveLayoutElement(layout,{type:'text',sourceRef:body.sourceRef,frame:{x:80,y:260,width:1400,height:520,rotation:0},style:{fontSize:28,textColor:'#20242a'}})
  const intent={schemaVersion:'1.0.0',pageId:step.pageId,coreJudgment:'验收工具链，不评价专业报告质量',evidence:[],readingOrder:[title.key,...(body?[body.key]:[])],hierarchy:[{sourceKey:title.key,level:1}],visualRole:'technical-verification',constraints:{safeMargin:40}}
  const candidate=await fx.service.prepare(await inputForPage(fx,run,step.pageId,{layout,designIntent:intent,idempotencyKey:step.idempotencyKey}))
  if(i===5){const preview=await renderCandidate(fx,candidate);assert.deepEqual(preview.checks.blockers,[]);await fx.service.recordPreview({sessionId:fx.sessionId,...candidate,preview});await fx.reopen()
   const resumed=await batchService().next(input);assert.equal(resumed.candidate.candidateId,candidate.candidateId);assert.equal(resumed.action,'critique');reusedCandidate=candidate.candidateId
   const cached=await fx.service.readPreview({sessionId:fx.sessionId,...candidate});assert.equal(cached.fingerprint,preview.fingerprint)
   await fx.service.submitReview({sessionId:fx.sessionId,...candidate,previewFingerprint:cached.fingerprint,observations:'Deterministic technical fixture: checked rendered text boxes only.'})
  }else await applyCandidate(fx,candidate)
 }
 const completed=await batchService().next(input);assert.equal(completed.status,'completed');assert.equal(completed.summary.completed,12)
 const output=await createDeliveryExportService({repository:fx.repository,layoutService:fx.layoutService}).export({formats:['html','pdf','pptx']})
 await mkdir(out,{recursive:true});await cp(output.directory,join(out,'delivery'),{recursive:true})
 const report={status:'passed',testKind:'deterministic-technical-fixture-not-live-DSH-or-professional-quality',pageCount:12,summary:completed.summary,restartAfterPage:6,reusedCandidate,formats:['html','pdf','pptx'],deliveryMode:output.mode,editableObjects:false,revision:output.revision,checks:'real Chromium current QA and persisted current-source receipts'}
 await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await fx.close()}
