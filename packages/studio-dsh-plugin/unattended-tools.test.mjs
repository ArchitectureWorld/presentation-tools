import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createStudioDshRuntime} from './lib/runtime.js'
import {registerDesignTools} from './lib/design-tools.js'
import {readStandardProject} from '../studio-standard-adapter/index.mjs'
const standard=new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/',import.meta.url)
test('DSH batch tools enforce session isolation and do not expose host lock/grant mutation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'studio-native-batch-')),runtime=createStudioDshRuntime({dataRoot:root});t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true})})
 const repo=await runtime.repositoryFor('s1'),imported=await readStandardProject(standard,{putBlob:repo.putBlob});await repo.initializeFromStandardProject({snapshot:imported.snapshot})
 const service=await runtime.designFor('s1'),pageId=repo.getState().pages[0].id,run=await service.start({sessionId:'s1',pageIds:[pageId],allowApply:true,expiresAt:new Date(Date.now()+60000).toISOString()})
 const tools=new Map();registerDesignTools({tools:{register:d=>tools.set(d.name,d)}},{runtime})
 for(const name of ['studio_begin_design_batch','studio_next_design_batch','studio_report_design_exception','studio_export_delivery'])assert.ok(tools.has(name),name)
 assert.equal([...tools.keys()].some(k=>/protection|unlock|grant/.test(k)),false)
 const exec={agent:{id:'s1',session:{id:'s1'}},signal:new AbortController().signal}
 const batch=await tools.get('studio_begin_design_batch').execute({runId:run.runId,idempotencyKey:'native-batch'},exec)
 const next=await tools.get('studio_next_design_batch').execute({batchId:batch.batchId},exec);assert.equal(next.pageId,pageId);assert.equal(next.action,'design')
 await assert.rejects(tools.get('studio_next_design_batch').execute({batchId:batch.batchId},{agent:{id:'other',session:{id:'other'}}}),/会话|scope/)
 await assert.rejects(tools.get('studio_export_delivery').execute({formats:['html'],passed:true},exec),/未知字段/)
 await assert.rejects(tools.get('studio_export_delivery').execute({formats:['html']},exec),{code:'standard_export_layout_blocked'})
 assert.ok((await service.context({sessionId:'s1',pageId})).designIntentSchema)
})
test('repeated native preview reuses the verified PNG instead of running Chromium again',async t=>{
 const {createLayoutPreviewRenderer}=await import('../../apps/studio-local/layout-preview.mjs');const {createLayoutPage,addLiveLayoutElement}=await import('../studio-layout-core/index.mjs')
 const root=await mkdtemp(join(tmpdir(),'studio-reuse-preview-')),runtime=createStudioDshRuntime({dataRoot:root});t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true})})
 const repository=await runtime.repositoryFor('s'),imported=await readStandardProject(standard,{putBlob:repository.putBlob});await repository.initializeFromStandardProject({snapshot:imported.snapshot})
 const design=await runtime.designFor('s'),pageId=repository.getState().pages[0].id,run=await design.start({sessionId:'s',pageIds:[pageId],allowApply:true,expiresAt:new Date(Date.now()+60000).toISOString()})
 const c=await design.context({sessionId:'s',pageId}),source=c.sourceProjection.sources.find(row=>row.kind==='text'),layout=addLiveLayoutElement(createLayoutPage({projectId:c.projectId,pageId,baseDraftRevision:c.baseProjectRevision}),{type:'text',sourceRef:source.sourceRef,frame:{x:80,y:80,width:1200,height:180,rotation:0},style:{fontSize:36,textColor:'#222222'}})
 const candidate=await design.prepare({sessionId:'s',runId:run.runId,pageId,baseProjectRevision:c.baseProjectRevision,baseLayoutRevision:c.baseLayoutRevision,baseLayoutSha:c.baseLayoutSha,sourceStateHash:c.sourceStateHash,layout,designIntent:'test',sourceMapping:{},idempotencyKey:'reuse'})
 const tools=new Map();let renders=0;const actual=createLayoutPreviewRenderer({browserExecutable:process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE})
 const ctx={tools:{register:t=>tools.set(t.name,t)},get:key=>key==='llm'?{resolveModelInfo:async()=>({inputModalities:['image']})}:key==='attachments'?{saveImage:async({data,mediaType})=>({attachmentId:'fixture-image',mediaType,bytes:data.length,width:1600,height:900})}:undefined}
 registerDesignTools(ctx,{runtime,renderer:{async render(input){renders++;return actual.render(input)}}})
 const exec={agent:{id:'s',session:{id:'s',requestHeader:()=>({config:{provider:'fixture',model:'fixture'}})}},signal:new AbortController().signal}
 const args={candidateId:candidate.candidateId,candidateSha:candidate.candidateSha}
 const first=await tools.get('studio_render_layout_preview').execute(args,exec),second=await tools.get('studio_render_layout_preview').execute(args,exec)
 assert.equal(renders,1);assert.equal(first.preview.fingerprint,second.preview.fingerprint);assert.equal(second.reused,true)
})
