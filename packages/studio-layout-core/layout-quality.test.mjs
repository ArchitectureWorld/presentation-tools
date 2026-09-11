import test from 'node:test'
import assert from 'node:assert/strict'
const module=await import('./layout-quality.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
const frame=(x=10,y=10,w=150,h=30)=>({x,y,width:w,height:h,rotation:0})
const text=(id,x=10)=>({layoutElementId:id,type:'text',frame:frame(x),zIndex:2,style:{fontSize:24,textColor:'#222222'},payload:{content:'Actual words'}})
const measurement=(id,x=10)=>({layoutElementId:id,textRects:[frame(x,10,80,28)],color:'rgb(34, 34, 34)',fontSize:24,fontWeight:400,opacity:1})
const check=(elements,measurements=[],constraints={})=>{assert.equal(typeof module.analyzeLayoutQuality,'function');return module.analyzeLayoutQuality({renderPlan:{canvas:{width:320,height:180},elements},measurements,constraints})}
test('actual text intersections are blockers; frame intersections alone are not',()=>{
 assert.ok(check([text('a'),text('b',40)],[measurement('a'),measurement('b',40)]).blockers.some(x=>x.code==='text_collision'))
 assert.equal(check([text('a'),text('b',100)],[measurement('a'),measurement('b',100)]).blockers.length,0)
})
test('opaque foreground hides text, while decorative backgrounds behind text remain valid',()=>{
 const background={layoutElementId:'cover',type:'shape',frame:frame(0,0,300,160),zIndex:3,style:{fill:'#ffffff'},payload:{decorative:true}}
 assert.ok(check([text('a'),background],[measurement('a')]).blockers.some(x=>x.code==='text_occluded'))
 background.zIndex=0;assert.equal(check([text('a'),background],[measurement('a')]).blockers.length,0)
})
test('measurable low contrast is reported without inventing a visual score',()=>{
 const m=measurement('a');m.color='rgb(250, 250, 250)'
 const result=check([text('a')],[m]);assert.ok(result.warnings.some(x=>x.code==='text_low_contrast'));assert.equal('score' in result,false)
})
test('images behind text require visual review instead of guessed contrast',()=>{
 const image={layoutElementId:'i',type:'image',frame:frame(0,0,320,180),zIndex:0,payload:{assetId:'img'}}
 assert.ok(check([image,text('a')],[measurement('a')]).warnings.some(x=>x.code==='contrast_requires_visual_review'))
})
test('safe margin and explicit spacing constraints are deterministic warnings',()=>{
 const r=check([text('a'),{...text('b'),frame:frame(164)}],[],{safeMargin:24,minGap:12});assert.ok(r.warnings.some(x=>x.code==='safe_margin'));assert.ok(r.warnings.some(x=>x.code==='element_gap'))
})
test('image cover crop and upscaling are measurable; contain is not reported as crop',()=>{
 const img={layoutElementId:'i',type:'image',frame:frame(20,20,200,100),zIndex:0,style:{fit:'cover'},payload:{assetId:'img'}}
 const r=check([img],[{layoutElementId:'i',naturalWidth:10,naturalHeight:100}],{maxCropFraction:0.2})
 assert.ok(r.warnings.some(x=>x.code==='image_excessive_crop'));assert.ok(r.warnings.some(x=>x.code==='image_upscaled'))
 img.style.fit='contain';assert.equal(check([img],[{layoutElementId:'i',naturalWidth:10,naturalHeight:100}]).warnings.some(x=>x.code==='image_excessive_crop'),false)
})
test('rotated text requires visual review rather than false bounding-box collision',()=>{
 const a=text('a');a.frame.rotation=25;const r=check([a,text('b')],[measurement('a'),measurement('b')]);assert.equal(r.blockers.length,0);assert.ok(r.warnings.some(x=>x.code==='rotated_content_review'))
})
test('an image intersection is not proof of opaque occlusion because PNGs and contain letterboxes can be transparent',()=>{
 const renderPlan={canvas:{width:1600,height:900},elements:[{layoutElementId:'text',type:'text',frame:{x:50,y:50,width:300,height:60},zIndex:0,style:{}},{layoutElementId:'image',type:'image',frame:{x:50,y:50,width:300,height:60},zIndex:1,style:{fit:'contain'}}]}
 const result=module.analyzeLayoutQuality({renderPlan,measurements:[{layoutElementId:'text',textRects:[{x:50,y:50,width:100,height:30}],color:'rgb(0,0,0)',fontSize:30,fontWeight:400,opacity:1}]})
 assert.ok(!result.blockers.some(b=>b.code==='text_occluded'));assert.ok(result.warnings.some(b=>b.code==='image_text_overlap_review'))
})
