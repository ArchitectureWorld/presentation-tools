import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile,readdir,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture,inputForPage,applyCandidate } from '../../test-support/design-fixture.mjs'
import { executeAction } from '../../packages/studio-core/index.mjs'
const module=await import('./delivery-export.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
const service=(fx,options={})=>{assert.equal(typeof module.createDeliveryExportService,'function');return module.createDeliveryExportService({repository:fx.repository,layoutService:fx.layoutService,...options})}
async function ready(t){const fx=await fixture();t.after(()=>fx.close());const run=await fx.start({pageIds:fx.repository.getState().pages.map(p=>p.id),protectedPageIds:[],allowApply:true});for(const id of run.pageIds)await applyCandidate(fx,await fx.service.prepare(await inputForPage(fx,run,id)));return fx}
test('unreviewed or stale source cannot be exported as a finished delivery',async t=>{
 const fx=await fixture();t.after(()=>fx.close());await assert.rejects(service(fx).export({formats:['html']}),{code:'standard_export_layout_blocked'})
})
test('HTML PDF and image-based PPTX export the same frozen checked pages and a hashed manifest',async t=>{
 const fx=await ready(t),result=await service(fx).export({formats:['html','pdf','pptx']})
 assert.equal(result.mode,'verified-preview-images');assert.equal(result.pageCount,fx.repository.getState().pages.length)
 const files=await readdir(result.directory);for(const f of ['report.html','report.pdf','report.pptx','manifest.json','source.json'])assert.ok(files.includes(f),f)
 const manifest=JSON.parse(await readFile(join(result.directory,'manifest.json')));assert.equal(manifest.revision,result.revision);assert.equal(manifest.pages.length,result.pageCount)
 assert.match(await readFile(join(result.directory,'report.html'),'utf8'),/data:image\/png;base64/)
 assert.match((await readFile(join(result.directory,'report.pdf'))).subarray(0,8).toString(),/^%PDF-/)
 assert.equal((await readFile(join(result.directory,'report.pptx'))).readUInt32LE(0),0x04034b50)
 for(const item of manifest.files){const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(await readFile(join(result.directory,item.name))).digest('hex'),item.sha256)}
 assert.deepEqual(await readdir(join(fx.repository.root,'deliveries','.staging')),[])
})
test('a manual source edit invalidates the delivery even without reconciling its old layout',async t=>{
 const fx=await ready(t);await fx.repository.transactContent({baseRevision:fx.repository.getState().project.currentRevision,source:'human'},s=>executeAction(s,{type:'draft.update',pageId:fx.pageId,patch:{heading:'Changed since preview'}}).state)
 await assert.rejects(service(fx).export({formats:['html']}),{code:'standard_export_layout_blocked'})
})
test('corrupt preview bytes, obsolete QA, and caller-supplied success flags fail closed',async t=>{
 const fx=await ready(t);await assert.rejects(service(fx).export({formats:['html'],passed:true}),{code:'delivery_invalid_input'})
 const p=fx.repository.getState().layoutCandidates[0].preview
 await writeFile(join(fx.repository.root,'objects','sha256',`${p.objectRef.sha256}.blob`),Buffer.from('corrupted'))
 await assert.rejects(service(fx).export({formats:['html']}),{code:'standard_export_layout_blocked'})
})
test('cancellation and byte limits leave no published delivery',async t=>{
 const fx=await ready(t);const controller=new AbortController();controller.abort()
 await assert.rejects(service(fx).export({formats:['html'],signal:controller.signal}),{code:'delivery_cancelled'})
 await assert.rejects(service(fx,{maxBytes:1}).export({formats:['html']}),{code:'delivery_size_limit'})
})
test('source mutation during export aborts publication instead of mixing revisions',async t=>{
 const fx=await ready(t);const exporter=service(fx,{beforePublish:async()=>fx.repository.transactContent({baseRevision:fx.repository.getState().project.currentRevision,source:'human'},s=>executeAction(s,{type:'draft.update',pageId:fx.pageId,patch:{heading:'Concurrent edit'}}).state)})
 await assert.rejects(exporter.export({formats:['html']}),{code:'delivery_stale_revision'})
 const dirs=await readdir(join(fx.repository.root,'deliveries'));assert.deepEqual(dirs,['.staging'])
})
test('reopening retains export evidence and unique paths do not overwrite previous deliveries',async t=>{
 const fx=await ready(t);await fx.reopen();const exporter=service(fx)
 const [a,b]=await Promise.all([exporter.export({formats:['html']}),exporter.export({formats:['html']})]);assert.notEqual(a.directory,b.directory);assert.equal(a.revision,b.revision)
})
test('standard project output uses current measured source rather than the old stored layout hash',async t=>{
 const {createStandardProjectService}=await import('./standard-project.mjs');const fx=await ready(t)
 await fx.repository.transactContent({baseRevision:fx.repository.getState().project.currentRevision,source:'human'},s=>executeAction(s,{type:'draft.update',pageId:fx.pageId,patch:{heading:'Fresh source missing fresh preview'}}).state)
 await assert.rejects(createStandardProjectService(fx.repository,{layoutService:fx.layoutService}).exportProject(),{code:'standard_export_layout_blocked'})
})
test('obsolete mechanical QA evidence cannot be published as a finished delivery',async t=>{
 const fx=await ready(t)
 await fx.repository.transactOperational(state=>{state.layoutCandidates[0].preview.fingerprintInputs.checksVersion='layout-dom-checks-v2';return state})
 await assert.rejects(service(fx).export({formats:['html']}),{code:'standard_export_layout_blocked'})
})
