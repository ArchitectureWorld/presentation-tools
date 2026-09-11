/** Objective geometry/DOM observations only. Warnings are not an aesthetic score. */
const area = r => Math.max(0,r.width)*Math.max(0,r.height)
const overlap = (a,b) => Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
const includes = (r,x,y) => x>=r.x && x<=r.x+r.width && y>=r.y && y<=r.y+r.height
function color(value) {
  if(typeof value!=='string')return null
  let v=value.toLowerCase().trim()
  const named={white:'#ffffff',black:'#000000',transparent:'#00000000'}; v=named[v]??v
  if(/^#[\da-f]{3,4}$/.test(v))v='#'+[...v.slice(1)].map(x=>x+x).join('')
  if(/^#[\da-f]{6}(?:[\da-f]{2})?$/.test(v))return [1,3,5].map(i=>parseInt(v.slice(i,i+2),16)).concat(v.length===9?parseInt(v.slice(7,9),16)/255:1)
  const m=v.match(/^rgba?\(([^)]+)\)$/);if(!m)return null
  const a=m[1].split(/[, /]+/).filter(Boolean).map(Number)
  return (a.length===3||a.length===4)&&a.every(Number.isFinite)?[...a.slice(0,3),a[3]??1]:null
}
const blend=(a,b,opacity=1)=>{const alpha=a[3]*opacity;return [0,1,2].map(i=>a[i]*alpha+b[i]*(1-alpha)).concat(1)}
const luminance=c=>c.slice(0,3).map(v=>{const x=v/255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4}).reduce((v,x,i)=>v+x*[0.2126,0.7152,0.0722][i],0)
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)}

export function analyzeLayoutQuality({renderPlan,measurements=[],constraints={},canvasBackground='#ffffff'}) {
  const blockers=[],warnings=[],seen=new Set();const add=(list,code,detail={})=>{const key=JSON.stringify([code,detail]);if(!seen.has(key)&&list.length<400){seen.add(key);list.push({code,...detail})}}
  const elements=(renderPlan.elements??[]).slice().sort((a,b)=>a.zIndex-b.zIndex), {width,height}=renderPlan.canvas
  const metrics=new Map(measurements.map(row=>[row.layoutElementId,row])), canvas={x:0,y:0,width,height}
  const texts=elements.filter(e=>metrics.get(e.layoutElementId)?.textRects?.length && (e.style?.opacity??1)>0)
  for(const element of elements){
    const id=element.layoutElementId,frame=element.frame,m=metrics.get(id),s=element.style??{}
    const decorative=element.payload?.decorative===true || (element.type==='image'&&element.payload?.role==='background')
    if(frame.rotation && (m?.textRects?.length||element.type==='image'))add(warnings,'rotated_content_review',{layoutElementId:id})
    const margin=constraints.safeMargin??0
    if(!decorative&&margin>0&&Math.min(frame.x,frame.y,width-frame.x-frame.width,height-frame.y-frame.height)<margin)add(warnings,'safe_margin',{layoutElementId:id,minimum:margin})
    if(element.type==='image'&&m?.naturalWidth>0&&m.naturalHeight>0){
      const sx=frame.width/m.naturalWidth,sy=frame.height/m.naturalHeight,scale=s.fit==='contain'?Math.min(sx,sy):Math.max(sx,sy)
      if(scale>2)add(warnings,'image_upscaled',{layoutElementId:id,scale:Number(scale.toFixed(2))})
      if((s.fit??'cover')==='cover'){
        const crop=1-area(frame)/(m.naturalWidth*m.naturalHeight*scale*scale)
        if(crop>(constraints.maxCropFraction??0.35))add(warnings,'image_excessive_crop',{layoutElementId:id,croppedFraction:Number(crop.toFixed(3))})
      }
    }
  }
  for(let i=0;i<texts.length;i++){
    const a=texts[i],ma=metrics.get(a.layoutElementId);if(a.frame.rotation)continue
    for(const b of texts.slice(i+1)){
      if(b.frame.rotation)continue
      const mb=metrics.get(b.layoutElementId)
      if(ma.textRects.some(x=>mb.textRects.some(y=>overlap(x,y)>Math.min(area(x),area(y))*0.12)))add(blockers,'text_collision',{layoutElementId:a.layoutElementId,otherElementId:b.layoutElementId})
    }
    const position=elements.indexOf(a)
    const front=elements.slice(position+1)
    for(const b of front){
      if(b.frame.rotation)continue
      const intersects=ma.textRects.some(r=>overlap(r,b.frame)>area(r)*0.6)
      const fill=color(b.style?.fill)
      const opaque=(b.type==='shape'||b.type==='group')&&fill?.[3]>=0.98&&(b.style?.opacity??1)>=0.98
      if(opaque&&intersects)add(blockers,'text_occluded',{layoutElementId:a.layoutElementId,otherElementId:b.layoutElementId})
      // Image alpha and contain letterboxing are not known from the frame.
      if(b.type==='image'&&(b.style?.opacity??1)>0&&intersects)add(warnings,'image_text_overlap_review',{layoutElementId:a.layoutElementId,otherElementId:b.layoutElementId})
    }
    const fg=color(ma.color);if(!fg || fg[3]===0)continue
    let worst=Infinity,unknown=false
    for(const rect of ma.textRects.slice(0,200)){
      let bg=color(canvasBackground)??[255,255,255,1],known=true
      const x=rect.x+rect.width/2,y=rect.y+rect.height/2
      for(const b of elements.slice(0,position)){
        if(!includes(b.frame,x,y)||(b.style?.opacity??1)<=0)continue
        if(b.frame.rotation||b.type==='image'){known=false;continue}
        const fill=color(b.style?.fill)
        if(fill&&fill[3]>0){const opacity=b.style?.opacity??1;if(fill[3]*opacity>=0.999)known=true;bg=blend(fill,bg,opacity)}
      }
      if(!known){unknown=true;continue}
      worst=Math.min(worst,contrast(blend(fg,bg,ma.opacity??1),bg))
    }
    if(unknown)add(warnings,'contrast_requires_visual_review',{layoutElementId:a.layoutElementId})
    const threshold=ma.fontSize>=24 || (ma.fontSize>=18.66&&ma.fontWeight>=700)?3:4.5
    if(worst<threshold)add(warnings,'text_low_contrast',{layoutElementId:a.layoutElementId,ratio:Number(worst.toFixed(2)),minimum:threshold})
  }
  const foreground=elements.filter(e=>e.payload?.decorative!==true && !(e.type==='image'&&e.payload?.role==='background'))
  for(let i=0;i<foreground.length;i++)for(const b of foreground.slice(i+1)){
    const a=foreground[i];if(a.frame.rotation||b.frame.rotation)continue
    const x=Math.max(a.frame.x,b.frame.x)-Math.min(a.frame.x+a.frame.width,b.frame.x+b.frame.width)
    const y=Math.max(a.frame.y,b.frame.y)-Math.min(a.frame.y+a.frame.height,b.frame.y+b.frame.height)
    const gap=x>=0&&y<0?x:y>=0&&x<0?y:null
    if(gap!==null&&gap<(constraints.minGap??0))add(warnings,'element_gap',{layoutElementId:a.layoutElementId,otherElementId:b.layoutElementId,gap,minimum:constraints.minGap})
    const edgeDelta=Math.abs(a.frame.x-b.frame.x)
    if(edgeDelta>0.5&&edgeDelta<=4&&Math.max(a.frame.y,b.frame.y)>=Math.min(a.frame.y+a.frame.height,b.frame.y+b.frame.height))add(warnings,'near_alignment',{layoutElementId:a.layoutElementId,otherElementId:b.layoutElementId,delta:edgeDelta})
  }
  const textArea=texts.reduce((sum,e)=>sum+metrics.get(e.layoutElementId).textRects.reduce((n,r)=>n+overlap(r,canvas),0),0)
  if(textArea/area(canvas)>0.65)add(warnings,'high_text_density',{occupiedFraction:Number((textArea/area(canvas)).toFixed(3))})
  return {blockers,warnings}
}

// Serializable browser-side observer. No tool-reported dimensions are trusted here.
export function observeLayoutQuality() {
  const canvas=document.querySelector('[data-layout-canvas]'),base=canvas.getBoundingClientRect()
  const rect=r=>({x:r.left-base.left,y:r.top-base.top,width:r.width,height:r.height})
  return {canvasBackground:getComputedStyle(canvas).backgroundColor,measurements:[...canvas.querySelectorAll('[data-layout-element]')].map(node=>{
    const text=node.querySelector(':scope > .layout-text-content, :scope > span'),image=node.querySelector(':scope > img')
    const style=text?getComputedStyle(text):null;let textRects=[]
    if(text?.textContent.trim()){const range=document.createRange();range.selectNodeContents(text);textRects=[...range.getClientRects()].map(rect)}
    return {layoutElementId:node.dataset.layoutElement,textRects,color:style?.color??null,fontSize:parseFloat(style?.fontSize)||0,fontWeight:parseFloat(style?.fontWeight)||400,opacity:Number(getComputedStyle(node).opacity),naturalWidth:image?.naturalWidth??0,naturalHeight:image?.naturalHeight??0}
  })}
}
