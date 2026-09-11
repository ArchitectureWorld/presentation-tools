import test from 'node:test'
import assert from 'node:assert/strict'
const module = await import('./design-intent.mjs').catch(e => {if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
const pageId='page-test',sourceKeys=['content-block:heading','content-block:body','page-asset:map']
const valid=()=>({schemaVersion:'1.0.0',pageId,coreJudgment:'一个核心判断',evidence:['page-asset:map'],readingOrder:sourceKeys,hierarchy:[{sourceKey:sourceKeys[0],level:1}],visualRole:'论证',preferredSkeleton:'evidence-map',constraints:{safeMargin:40,minGap:12,maxCropFraction:0.2}})
const check=intent=>{assert.equal(typeof module.validateDesignIntent,'function');return module.validateDesignIntent({intent,pageId,sourceKeys})}
test('structured intent preserves upstream decisions without executing a layout strategy',()=>{const i=valid();assert.deepEqual(check(i),i);assert.notEqual(check(i),i)})
test('legacy intent remains compatible',()=>assert.equal(check('整理本页'),'整理本页'))
for(const [name,edit] of Object.entries({
 'wrong version':i=>i.schemaVersion='2.0.0', 'foreign page':i=>i.pageId='other', 'authority':i=>i.allowApply=true,
 'nested authority':i=>i.constraints.allowApply=true, 'unknown evidence':i=>i.evidence.push('evidence:invented'),
 'duplicate order':i=>i.readingOrder.push(i.readingOrder[0]),'unknown hierarchy':i=>i.hierarchy[0].sourceKey='unknown',
 'invalid level':i=>i.hierarchy[0].level=7,'empty conclusion':i=>i.coreJudgment='', 'oversized':i=>i.coreJudgment='x'.repeat(4001),
 'negative margin':i=>i.constraints.safeMargin=-1,'invalid crop':i=>i.constraints.maxCropFraction=1.1,
 'nan':i=>i.constraints.minGap=NaN,'unknown field':i=>i.other='data',
}))test(`intent rejects ${name}`,()=>{const i=valid();edit(i);assert.throws(()=>check(i),{code:'design_intent_invalid'})})
