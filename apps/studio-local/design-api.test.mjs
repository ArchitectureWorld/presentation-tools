import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm } from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {createStudioDshRuntime} from '../../packages/studio-dsh-plugin/lib/runtime.js'
import {readStandardProject} from '../../packages/studio-standard-adapter/index.mjs'
const mod = await import('./design-api.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
test('host design start validates browser origin, ignores no agent authority, and binds user scope to session',async()=>{
  assert.equal(typeof mod.executeDesignApi,'function')
  const root=await mkdtemp(join(tmpdir(),'design-api-'));const runtime=createStudioDshRuntime({dataRoot:root})
  try {
    const repository=await runtime.repositoryFor('s1');const input=await readStandardProject(new URL('../../contracts/presentation-standard-project/examples/unformatted-project/project_01992a80-0000-7000-8000-000000000101-campus-renewal-brief/',import.meta.url),{putBlob:repository.putBlob});await repository.initializeFromStandardProject({snapshot:input.snapshot})
    const pageId=repository.getState().pages[1].id
    const request={method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','sec-fetch-site':'same-origin','content-type':'application/json'}}
    const call=(extra={})=>mod.executeDesignApi({runtime,sessionId:'s1',operation:'start',request,body:{pageIds:[pageId],protectedPageIds:[],allowVisualGeneration:false,instruction:'整理页面'},...extra})
    await assert.rejects(call({request:{...request,headers:{...request.headers,origin:'http://evil.example'}}}),/宿主/)
    await assert.rejects(call({request:{...request,headers:{}}}),/宿主/)
    await assert.rejects(call({body:{pageIds:[pageId],actor:'human',allowApply:true}}),/参数/)
    const result=await call();assert.ok(result.run.runId);assert.equal(result.run.allowApply,true);assert.equal(result.run.executionMode,'direct');assert.match(result.dshPrompt.text,/studio_get_layout_context/)
    assert.equal(result.dshPrompt.sessionId,'s1')
    assert.match(result.dshPrompt.text,/studio_generate_design_visual/)
    assert.match(result.dshPrompt.text,/studio_adopt_design_visual/)
    await assert.rejects(mod.executeDesignApi({runtime,sessionId:'s2',operation:'progress',request:{method:'GET'},body:{runId:result.run.runId}}),/任务/)
    const context=await mod.executeDesignApi({runtime,sessionId:'s1',operation:'context',request:{method:'GET'},body:{pageId}})
    assert.ok(context.rules)
    assert.equal(typeof mod.readDesignImage,'function')
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8wAAAABJRU5ErkJggg==','base64')
    const objectRef=await repository.putBlob(Readable.from([png]),{mimeType:'image/png',originalFileName:'preview.png'})
    await repository.transactOperational(state=>{state.proposals.push({id:'preview',kind:'design.visual.v1',sessionId:'s1',projectId:state.project.projectId,objectRef});return state})
    assert.deepEqual((await mod.readDesignImage({runtime,sessionId:'s1',proposalId:'preview'})).bytes,png)
    await assert.rejects(mod.readDesignImage({runtime,sessionId:'s2',proposalId:'preview'}),/会话/)
  }finally{await runtime.close();await rm(root,{recursive:true,force:true})}
})
