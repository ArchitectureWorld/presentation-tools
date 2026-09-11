import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, renderCandidate } from '../../test-support/design-fixture.mjs'
import { executeAction } from '../../packages/studio-core/index.mjs'
const module=await import('./design-protection.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
const service=fx=>{assert.equal(typeof module.createDesignProtectionService,'function');return module.createDesignProtectionService({repository:fx.repository,layoutService:fx.layoutService})}
async function setup(t){const fx=await fixture();t.after(()=>fx.close());const run=await fx.start({allowApply:true});const input=await fx.input(run);const candidate=await fx.service.prepare(input);const preview=await renderCandidate(fx,candidate);await fx.service.recordPreview({sessionId:fx.sessionId,...candidate,preview});await fx.service.submitReview({sessionId:fx.sessionId,...candidate,previewFingerprint:preview.fingerprint,observations:'已检查真实预览'});return {fx,run,input}}
const lock=(fx,values={})=>service(fx).update({pageId:fx.pageId,baseRevision:fx.repository.getState().project.currentRevision,expectedProtectionRevision:0,...values})
test('element locks persist, are idempotent, and have their own CAS without content revisions',async t=>{
 const {fx,input}=await setup(t);const id=input.layout.elements[0].layoutElementId;const revision=fx.repository.getState().project.currentRevision
 const current=await lock(fx,{elementId:id,locked:true});assert.equal(current.revision,1)
 assert.equal((await service(fx).update({pageId:fx.pageId,baseRevision:revision,expectedProtectionRevision:1,elementId:id,locked:true})).revision,1)
 await assert.rejects(lock(fx,{elementId:id,locked:false}),{code:'protection_revision_conflict'})
 await fx.reopen();assert.equal(service(fx).get({pageId:fx.pageId}).elements[0].layoutElementId,id);assert.equal(fx.repository.getState().project.currentRevision,revision)
})
test('unknown element cannot be locked and agent authority flags cannot be supplied',async t=>{
 const {fx}=await setup(t);await assert.rejects(lock(fx,{elementId:'unknown',locked:true}),{code:'protection_target_missing'})
 await assert.rejects(lock(fx,{locked:true,actor:'agent'}),{code:'protection_invalid_input'})
})
test('agent cannot move or remove a locked element; unchanged protected geometry can pass',async t=>{
 const {fx,run,input}=await setup(t);const id=input.layout.elements[0].layoutElementId;await lock(fx,{elementId:id,locked:true})
 const next=await fx.input(run,{idempotencyKey:'second'});next.layout.elements[0].frame.x+=20
 await assert.rejects(fx.service.prepare(next),{code:'design_protected'})
 next.layout.elements=[];await assert.rejects(fx.service.prepare(next),{code:'design_protected'})
 const keep=await fx.input(run,{idempotencyKey:'keep'});assert.equal((await fx.service.prepare(keep)).status,'candidate')
})
test('lock added after the real preview prevents publication of modified geometry',async t=>{
 const {fx,run,input}=await setup(t);const next=await fx.input(run,{idempotencyKey:'second'});next.layout.elements[0].frame.x+=20
 const candidate=await fx.service.prepare(next);const preview=await renderCandidate(fx,candidate);await fx.service.recordPreview({sessionId:fx.sessionId,...candidate,preview})
 await lock(fx,{elementId:input.layout.elements[0].layoutElementId,locked:true})
 await assert.rejects(fx.service.submitReview({sessionId:fx.sessionId,...candidate,previewFingerprint:preview.fingerprint,observations:'检查完成'}),{code:'design_protected'})
 assert.equal((await fx.layoutService.get({pageId:fx.pageId})).layout.elements[0].frame.x,input.layout.elements[0].frame.x)
})
test('agent source edits and automatic upstream replacement cannot bypass locked content',async t=>{
 const {fx,input}=await setup(t);await lock(fx,{elementId:input.layout.elements[0].layoutElementId,locked:true})
 const change=current=>executeAction(current,{type:'draft.update',pageId:fx.pageId,patch:{heading:'覆盖了原标题'}}).state
 for(const source of ['agent','host-design','workspace_upstream'])await assert.rejects(fx.repository.transactContent({baseRevision:fx.repository.getState().project.currentRevision,source},change),{code:'design_protected'})
 await fx.repository.transactContent({baseRevision:fx.repository.getState().project.currentRevision,source:'human'},change)
 assert.equal(fx.repository.getState().pages.find(p=>p.id===fx.pageId).heading,'覆盖了原标题')
})
test('human mutation can atomically save geometry with an element lock',async t=>{
 const {fx,input}=await setup(t);const current=await fx.layoutService.get({pageId:fx.pageId});const e=current.layout.elements[0]
 const saved=await fx.layoutService.mutate({pageId:fx.pageId,baseRevision:current.state.project.currentRevision,expectedLayoutRevision:current.layout.layoutRevision,operation:{type:'frame',layoutElementId:e.layoutElementId,frame:{...e.frame,x:90}},lockEditedElement:true,expectedProtectionRevision:0})
 assert.equal(saved.layout.elements[0].frame.x,90);assert.equal(service(fx).get({pageId:fx.pageId}).elements[0].layoutElementId,input.layout.elements[0].layoutElementId)
})
test('page lock is visible in context and blocks automatic page removal',async t=>{
 const {fx}=await setup(t);await lock(fx,{locked:true});const context=await fx.service.context({sessionId:fx.sessionId,pageId:fx.pageId});assert.equal(context.protection.pageLocked,true)
 await assert.rejects(fx.repository.transactContent({baseRevision:fx.repository.getState().project.currentRevision,source:'host-design'},state=>{state.pages=state.pages.filter(p=>p.id!==fx.pageId);return state}),{code:'design_protected'})
})
