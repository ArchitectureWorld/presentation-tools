import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from '../../test-support/design-fixture.mjs'
import { createDesignBatchService } from './design-batch.mjs'
const mod=await import('./production-api.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
const req={method:'POST',headers:{host:'localhost',origin:'http://localhost','sec-fetch-site':'same-origin','content-type':'application/json'}}
const api=input=>{assert.equal(typeof mod.executeProductionApi,'function');return mod.executeProductionApi(input)}
test('batch host API resumes the same persisted task and never mints another grant',async t=>{
 const fx=await fixture();t.after(()=>fx.close());const run=await fx.start({allowApply:true}),batch=createDesignBatchService({repository:fx.repository,layoutService:fx.layoutService,now:()=>Date.parse('2026-09-06T00:00:00Z')})
 const b=await batch.begin({sessionId:fx.sessionId,runId:run.runId,idempotencyKey:'host'}),runtime={batchFor:async()=>batch}
 const result=await api({runtime,sessionId:fx.sessionId,operation:'resume',request:req,body:{batchId:b.batchId}})
 assert.equal(result.batch.batchId,b.batchId);assert.match(result.dshPrompt.text,/studio_next_design_batch/);assert.equal(fx.repository.getState().designRuns.length,1)
 await assert.rejects(api({runtime,sessionId:fx.sessionId,operation:'resume',request:{...req,headers:{...req.headers,origin:'http://evil.test'}},body:{batchId:b.batchId}}),{code:'design_scope_denied'})
 await assert.rejects(api({runtime,sessionId:fx.sessionId,operation:'resume',request:req,body:{batchId:b.batchId,allowApply:true}}),{code:'production_invalid_input'})
})
test('layout protection API exposes manual locks through a version checked path',async t=>{
 const fx=await fixture();t.after(()=>fx.close());const {matchLayoutApiPath,executeLayoutApi}=await import('./layout-api.mjs')
 const match=matchLayoutApiPath(`/api/layout/pages/${fx.pageId}/protection`);assert.ok(match)
 const result=await executeLayoutApi({service:fx.layoutService,method:'POST',match,body:{baseRevision:0,expectedProtectionRevision:0,locked:true}})
 assert.equal(result.protection.pageLocked,true)
 await assert.rejects(executeLayoutApi({service:fx.layoutService,method:'POST',match,body:{baseRevision:0,expectedProtectionRevision:0,locked:false}}),{code:'protection_revision_conflict'})
})
test('delivery reads reject a replaced manifest symlink before reading foreign bytes',async t=>{
 const {mkdtemp,mkdir,writeFile,symlink,rm}=await import('node:fs/promises')
 const {tmpdir}=await import('node:os'),{join}=await import('node:path'),{createHash}=await import('node:crypto')
 const root=await mkdtemp(join(tmpdir(),'studio-delivery-read-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const id='12345678-1234-1234-1234-123456789abc',directory=join(root,'deliveries',id,'report'),body='private view'
 await mkdir(directory,{recursive:true});await writeFile(join(directory,'report.html'),body)
 const manifest=join(root,'foreign.json');await writeFile(manifest,JSON.stringify({files:[{name:'report.html',sha256:createHash('sha256').update(body).digest('hex')}]}))
 try{await symlink(manifest,join(directory,'manifest.json'))}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('Platform denies symlink creation');return}throw error}
 await assert.rejects(mod.readDeliveryFile({repository:{root},deliveryId:id,name:'report.html'}),{code:'delivery_invalid_input'})
})
