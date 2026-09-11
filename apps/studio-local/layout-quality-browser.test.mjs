import test from 'node:test'
import assert from 'node:assert/strict'
import { createLayoutPreviewRenderer } from './layout-preview.mjs'
const text=(id,y)=>({layoutElementId:id,type:'text',zIndex:2,frame:{x:20,y,width:280,height:50,rotation:0},style:{fontSize:24,textColor:'#222222'},payload:{content:'Overlapping words'}})
const fixture=()=>({layout:{sourceStateHash:'sha256:'+'a'.repeat(64)},candidateSha:'b'.repeat(64),renderPlan:{canvas:{width:320,height:180},elements:[text('a',20),text('b',25)]},pageAssets:[]})
test('offline real Chromium preview reports actual text collisions and no external resources',async()=>{
 const r=await createLayoutPreviewRenderer().render(fixture());assert.ok(r.png.length>1000);assert.ok(r.checks.blockers.some(x=>x.code==='text_collision'));assert.equal(r.checks.blockers.some(x=>x.code==='external_resource_rejected'),false)
})
test('real Chromium detects opaque text occlusion and preserves decorative backgrounds',async()=>{
 const input=fixture();input.renderPlan.elements=[text('a',20),{layoutElementId:'cover',type:'shape',zIndex:5,frame:{x:0,y:0,width:320,height:100,rotation:0},style:{fill:'#ffffff'},payload:{decorative:true}}]
 const renderer=createLayoutPreviewRenderer();assert.ok((await renderer.render(input)).checks.blockers.some(x=>x.code==='text_occluded'))
 input.renderPlan.elements[1].zIndex=0;assert.deepEqual((await renderer.render(input)).checks.blockers,[])
})
test('real Chromium reports contrast and minimum edge distance without shrinking typography',async()=>{
 const input=fixture();input.renderPlan.elements=[{...text('a',2),style:{fontSize:24,textColor:'#fafafa'}}];input.designIntent={constraints:{safeMargin:20}}
 const r=await createLayoutPreviewRenderer().render(input);assert.ok(r.checks.warnings.some(x=>x.code==='text_low_contrast'));assert.ok(r.checks.warnings.some(x=>x.code==='safe_margin'))
})
