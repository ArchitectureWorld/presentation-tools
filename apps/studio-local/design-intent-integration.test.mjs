import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from '../../test-support/design-fixture.mjs'
test('structured intent survives candidate persistence and rejects invented references before writes',async t=>{
 const fx=await fixture();t.after(()=>fx.close());const run=await fx.start();const input=await fx.input(run);const ctx=await fx.service.context({sessionId:fx.sessionId,pageId:fx.pageId})
 const keys=ctx.sourceProjection.sources.map(s=>s.key)
 input.designIntent={schemaVersion:'1.0.0',pageId:fx.pageId,coreJudgment:'保留证据链',evidence:[],readingOrder:keys,hierarchy:[],visualRole:'证据',constraints:{}}
 const candidate=await fx.service.prepare(input);await fx.reopen()
 assert.deepEqual(fx.repository.getState().layoutCandidates[0].designIntent,input.designIntent)
 assert.deepEqual(await fx.service.prepare(input),candidate)
 await assert.rejects(fx.service.prepare({...input,idempotencyKey:'invalid',designIntent:{...input.designIntent,evidence:['invented']}}),{code:'design_intent_invalid'})
 assert.equal(fx.repository.getState().layoutCandidates.length,1)
 assert.equal(fx.repository.getState().project.currentRevision,0)
})
