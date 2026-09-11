import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from './lib/index.js'
test('native host start creates a recoverable batch, same-origin locks apply, and cancellation revokes it',async t=>{
 const root=await mkdtemp(join(tmpdir(),'studio-production-route-'));let route;const cleanups=[]
 const ctx={tools:{register(){}},systemPrompt:{section(){}},sessions:{get:id=>id==='s'?{header:{cwd:root}}:undefined},get(){},webServer:{host:'127.0.0.1',register:r=>{route=r;return ()=>{}}},effect:f=>{cleanups.push(f())}}
 apply(ctx,{dataDir:join(root,'data'),allowNativeReview:true});t.after(async()=>{for(const close of cleanups.reverse())await close?.();await rm(root,{recursive:true,force:true})})
 async function call(path,body,origin='http://localhost'){
  const request=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(request,{method:body?'POST':'GET',url:`/report-studio/api/${path}${path.includes('?')?'&':'?'}sessionId=s`,headers:{host:'localhost',origin,'sec-fetch-site':'same-origin','content-type':'application/json'}})
  let bytes='',status;const response={setHeader(){},end:b=>{bytes+=b??''},set statusCode(n){status=n},get statusCode(){return status}}
  await route.handler(request,response);return {status,body:JSON.parse(bytes)}
 }
 const imported=await call('standard/import',{projectRoot:resolve('contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief')});assert.equal(imported.status,200,JSON.stringify(imported.body))
 const state=(await call('state')).body,pageId=state.pages[0].id
 const started=await call('design/start',{pageIds:state.pages.map(p=>p.id),instruction:'技术联调，不生成新证据'});assert.equal(started.status,200);assert.ok(started.body.batch?.batchId)
 const batchId=started.body.batch.batchId;assert.match(started.body.dshPrompt.text,/studio_next_design_batch/)
 assert.equal((await call('production/resume',{batchId},'http://evil.test')).status,403)
 const lock=await call(`layout/pages/${pageId}/protection`,{baseRevision:0,expectedProtectionRevision:0,locked:true});assert.equal(lock.status,200);assert.equal(lock.body.protection.pageLocked,true)
 const progress=await call(`production/status?batchId=${batchId}`);assert.equal(progress.status,200);assert.equal(progress.body.batch.summary.skippedLocked,1)
 assert.equal((await call('production/cancel',{batchId})).body.batch.status,'cancelled')
 const denied=await call(`delivery/file?deliveryId=..&name=source.json`);assert.equal(denied.body.error.code,'delivery_invalid_input')
})
