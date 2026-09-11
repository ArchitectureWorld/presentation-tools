import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createStudioDshRuntime} from '../../packages/studio-dsh-plugin/lib/runtime.js'
import {readStandardProject,writeStandardProject} from '../../packages/studio-standard-adapter/index.mjs'
import {validateProjectDirectoryWithAjv} from '../../contracts/presentation-standard-project/src/index.mjs'
const mod=await import('./design-visual.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
test('trusted Pre resolver filters foreign sources and exact accepted candidate does not grant another image',async()=>{
 assert.equal(typeof mod.createDesignVisualService,'function')
 const root=await mkdtemp(join(tmpdir(),'design-visual-'));const runtime=createStudioDshRuntime({dataRoot:root})
 try{
  const repository=await runtime.repositoryFor('s1');const imported=await readStandardProject(new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/',import.meta.url),{putBlob:repository.putBlob})
  // This fixture script references a global SVG not linked to its page; keep this test focused on AI asset reuse.
  imported.snapshot.pages[0].scriptBlocks[0].referencedAssetIds=[]
  await repository.initializeFromStandardProject({snapshot:imported.snapshot})
  const pageId=repository.getState().pages[1].id
  await repository.transactContent({baseRevision:0,source:'human'},state=>{state.pages[1].sourceRefs=[{provider:'pre-design',sourceProjectId:'pre-bound',sourceRevision:1,objectIds:['bound-object'],evidenceIds:[]},{provider:'pre-design',sourceProjectId:'pre-foreign',sourceRevision:1,objectIds:['foreign-object'],evidenceIds:[]}];return state})
  const designService=await runtime.designFor('s1');const run=await designService.start({sessionId:'s1',pageIds:[pageId],allowVisualGeneration:true,expiresAt:new Date(Date.now()+60000).toISOString()})
  let resolver;const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8wAAAABJRU5ErkJggg==','base64')
  const parent={id:'s1',session:{id:'s1'}}
  const pre={repository:{readContext:()=>({project:{projectId:'pre-bound'}})},standardProjects:{findByPreDesignProjectId:()=>({state:'ready',presentationProjectId:repository.getState().project.projectId,workspaceRoot:root})},designVisualBridge:{protocol:'pre-design.page-visual.v1',bindStudioResolver:r=>{resolver=r;return ()=>{resolver=null}},generate:async(_parent,input)=>({taskId:'task',assetId:input.requestId,status:'candidate',requestId:input.requestId,target:{studioProjectId:input.studioProjectId,pageId:input.pageId,sourceStateHash:input.sourceStateHash},image:{bytes:png,mimeType:'image/png',sha256:createHash('sha256').update(png).digest('hex'),width:1,height:1},provenance:{kind:'ai_concept',preDesignProjectId:'pre-bound',declarations:['AI 概念示意（非现场实拍）']}}),adopt:async(_parent,input)=>{await resolver.resolve({...input,parent,operation:'adopt',candidate:{requestId:input.requestId,assetId:input.assetId}});return {...await pre.designVisualBridge.generate(parent,input),status:'adopted_unlinked'}},confirmLinked:async(_parent,input)=>input.linkReceipt}}
  const generateContract=pre.designVisualBridge.generate
  pre.designVisualBridge.generate=async(...args)=>{assert.match(args[1].sourceStateHash,/^[a-f0-9]{64}$/,'actual Pre protocol requires a bare SHA-256');return generateContract(...args)}
  const service=mod.createDesignVisualService({runtime,preplanning:pre,workspaceFor:async()=>root});service.bind()
  const context=await designService.context({sessionId:'s1',pageId});const input={runId:run.runId,pageId,sourceStateHash:context.sourceStateHash,requestId:'first',prompt:'概念空间'}
  const deniedRun=await designService.start({sessionId:'s1',pageIds:[pageId],allowVisualGeneration:false,expiresAt:new Date(Date.now()+60000).toISOString()})
  await assert.rejects(service.generate(parent,{...input,runId:deniedRun.runId}),/未授权/)
  await assert.rejects(service.generate({id:'s2',session:{id:'s2'}},input),/页面|范围|不存在/)
  const resolved=await resolver.resolve({...input,studioProjectId:context.projectId,parent,operation:'inspect'})
  assert.deepEqual(resolved.sourceObjectIds,['bound-object'])
  const candidate=await service.generate(parent,input)
  const reordered=Object.fromEntries(Object.entries(input).reverse())
  assert.equal((await service.generate(parent,reordered)).proposal.id,candidate.proposal.id)
  assert.equal(repository.getState().proposals.filter(row=>row.kind==='design.visual.v1').length,1)
  await assert.rejects(service.adopt(parent,{proposalId:candidate.proposal.id}),/批准|权限/)
  await service.accept({sessionId:'s1',proposalId:candidate.proposal.id})
  const authority=await resolver.resolve({...input,studioProjectId:context.projectId,parent,operation:'adopt',candidate:{requestId:'first',assetId:'first'}})
  assert.equal(authority.grant.allowApply,true)
  await assert.rejects(resolver.resolve({...input,studioProjectId:context.projectId,parent,operation:'adopt',candidate:{requestId:'other',assetId:'other'}}),/批准|权限/)
  assert.equal((await designService.inspectGrant({sessionId:'s1',runId:run.runId,pageId})).allowApply,false)
  const linked=await service.adopt(parent,{proposalId:candidate.proposal.id});assert.equal(linked.status,'accepted')
  const stateAfterAdopt=repository.getState()
  const adoptedRecord=stateAfterAdopt.project.extensionPayload.standardArchive.documents['assets/manifest.json'].assets.find(row=>row.assetId===linked.linkedAssetId)
  assert.ok(adoptedRecord,'AI adoption must register the standard manifest in the same revision')
  assert.equal(adoptedRecord.origin.type,'generated_by_plugin')
  assert.deepEqual(adoptedRecord.sourceRefs,[stateAfterAdopt.pages[1].sourceRefs[0]])
  assert.deepEqual(stateAfterAdopt.pages[1].pageAssets.at(-1).sourceRefs,adoptedRecord.sourceRefs)
  const originMethod=JSON.parse(adoptedRecord.origin.method)
  assert.equal(originMethod.taskId,'task')
  assert.equal(originMethod.preAssetId,'first')
  assert.equal(originMethod.requestId,'first')
  assert.equal(originMethod.proposalId,candidate.proposal.id)
  assert.match(originMethod.disclosure,/AI.*非现场/)
  assert.ok(stateAfterAdopt.project.extensionPayload.standardArchive.files.some(row=>row.relativePath===adoptedRecord.relativePath&&row.objectRef.sha256===adoptedRecord.sha256))
  assert.equal(repository.getState().pages[1].pageAssets.at(-1).caption,'')
  assert.equal((await service.adopt(parent,{proposalId:candidate.proposal.id})).status,'accepted')
  const exported=await writeStandardProject({snapshot:repository.getState(),exportRoot:join(root,'export'),openBlob:repository.openBlob})
  const validation=await validateProjectDirectoryWithAjv(exported.projectRoot,{allowGitKeep:true});assert.equal(validation.valid,true,JSON.stringify(validation))
  const exportedManifest=JSON.parse(await readFile(join(exported.projectRoot,'assets','manifest.json'),'utf8'))
  const exportedRecord=exportedManifest.assets.find(row=>row.assetId===linked.linkedAssetId)
  assert.deepEqual(exportedRecord.origin,adoptedRecord.origin)
  assert.deepEqual(exportedRecord.sourceRefs,adoptedRecord.sourceRefs)
  const otherPageId=repository.getState().pages[0].id
  const linkRun=await designService.start({sessionId:'s1',pageIds:[otherPageId],expiresAt:new Date(Date.now()+60000).toISOString()})
  const content=await runtime.contentFor('s1')
  const proposal=await content.prepare({sessionId:'s1',runId:linkRun.runId,baseRevision:repository.getState().project.currentRevision,idempotencyKey:'reuse-ai',message:'复用已登记AI素材',commands:[{type:'page.asset.link',pageId:otherPageId,assetId:linked.linkedAssetId}]})
  await content.accept({sessionId:'s1',proposalId:proposal.proposal.id})
  assert.deepEqual(repository.getState().pages[0].pageAssets.at(-1).sourceRefs,adoptedRecord.sourceRefs)
  service.dispose();assert.equal(resolver,null)
 }finally{await runtime.close();await rm(root,{recursive:true,force:true})}
})
