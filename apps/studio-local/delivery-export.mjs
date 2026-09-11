import { PREVIEW_CHECKS_VERSION } from '../../packages/studio-layout-core/preview-fingerprint.mjs'
import { mkdir,rm,rename,writeFile,access } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID,createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import { captureCheckedDelivery,checkDeliverySignal } from './delivery-snapshot.mjs'
import { previewBrowserCandidates } from './layout-preview.mjs'
import { createImagePptx } from '../../packages/studio-layout-core/export/image-pptx.mjs'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code,status:409})}
function htmlFor(snapshot){const {canvas,pages}=snapshot;return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><title>Report Studio</title><style>'+`@page{size:${canvas.width/96}in ${canvas.height/96}in;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:white}section{width:100%;max-width:${canvas.width}px;aspect-ratio:${canvas.width}/${canvas.height};margin:0 auto;break-after:page;page-break-after:always}section:last-child{break-after:auto;page-break-after:auto}img{display:block;width:100%;height:100%}@media print{section{width:${canvas.width}px;height:${canvas.height}px;max-width:none}}`+'</style></head><body>'+pages.map((p,i)=>`<section><img alt="Page ${i+1}" src="data:image/png;base64,${p.png.toString('base64')}"></section>`).join('')+'</body></html>'}
async function pdfFor(html,snapshot,{signal,timeoutMs,browserExecutable}){
 let browser,path;let stopped=false,stopError
 for(const candidate of previewBrowserCandidates(process.platform,browserExecutable??process.env.STUDIO_PREVIEW_BROWSER_EXECUTABLE)){try{await access(candidate);path=candidate;break}catch{}}
 if(!path)fail('delivery_browser_missing','PDF导出需要已安装的Chromium或Edge。')
 let rejectStop;const stopPromise=new Promise((_,reject)=>{rejectStop=reject})
 const stop=(code,message)=>{if(stopped)return;stopped=true;stopError=Object.assign(new Error(message),{code});void browser?.close().catch(()=>{});rejectStop(stopError)}
 const cancelled=()=>stop('delivery_cancelled','导出已取消。'),timer=setTimeout(()=>stop('delivery_timeout','PDF导出超时。'),timeoutMs)
 signal?.addEventListener('abort',cancelled,{once:true})
 try{
  checkDeliverySignal(signal)
  const work=(async()=>{browser=await chromium.launch({executablePath:path,headless:true,args:['--no-sandbox'],timeout:timeoutMs});if(stopped){await browser.close();throw stopError}
   const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',route=>route.abort())
   const page=await context.newPage();await page.setContent(html,{waitUntil:'load',timeout:timeoutMs});await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())))
   return page.pdf({printBackground:true,preferCSSPageSize:true,width:`${snapshot.canvas.width/96}in`,height:`${snapshot.canvas.height/96}in`,margin:{top:0,bottom:0,left:0,right:0}})
  })()
  return await Promise.race([work,stopPromise])
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancelled);await browser?.close().catch(()=>{})}
}
/** Finished delivery is explicitly image based, preserving the checked pixels across formats. */
export function createDeliveryExportService({repository,layoutService,maxBytes=256*1024*1024,maxPages=100,timeoutMs=60_000,browserExecutable,beforePublish=async()=>{}}){
 if(![maxBytes,maxPages,timeoutMs].every(n=>Number.isSafeInteger(n)&&n>0))throw new TypeError('Export limits must be positive integers')
 return Object.freeze({async export(input={}){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).some(k=>!['formats','signal'].includes(k))||!Array.isArray(input.formats)||!input.formats.length||input.formats.length>3||new Set(input.formats).size!==input.formats.length||input.formats.some(f=>!['html','pdf','pptx'].includes(f))||(input.signal!==undefined&&!(input.signal instanceof AbortSignal)))fail('delivery_invalid_input','导出格式或参数无效。')
  const snapshot=await captureCheckedDelivery({repository,layoutService,signal:input.signal,maxBytes,maxPages})
  const id=randomUUID(),root=join(repository.root,'deliveries'),staging=join(root,'.staging'),stage=join(staging,id),final=join(root,id)
  let claimed=false,published=false
  try{
   await mkdir(staging,{recursive:true});await mkdir(stage)
   const files=[],save=async(name,value)=>{checkDeliverySignal(input.signal);const data=Buffer.isBuffer(value)?value:Buffer.from(value);if(data.length>maxBytes*4)fail('delivery_size_limit','导出文件超过字节预算。');await writeFile(join(stage,name),data,{flag:'wx'});files.push({name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')})}
   const html=htmlFor(snapshot)
   if(input.formats.includes('html'))await save('report.html',html)
   if(input.formats.includes('pdf'))await save('report.pdf',await pdfFor(html,snapshot,{signal:input.signal,timeoutMs,browserExecutable}))
   if(input.formats.includes('pptx'))await save('report.pptx',await createImagePptx(snapshot))
   // Local edit source deliberately remains separate from audience-facing slide pixels.
   await save('source.json',JSON.stringify({schemaVersion:'1.0.0',projectId:snapshot.projectId,revision:snapshot.revision,canonical:snapshot.canonical,layouts:snapshot.pages.map(p=>p.layout)},null,2))
   const manifest={schemaVersion:'1.0.0',mode:'verified-preview-images',editableObjects:false,projectId:snapshot.projectId,revision:snapshot.revision,checksVersion:PREVIEW_CHECKS_VERSION,canvas:snapshot.canvas,pages:snapshot.pages.map(({png,layout,checks,...page})=>({...page,warnings:checks.warnings})),files}
   await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'})
   await beforePublish();checkDeliverySignal(input.signal)
   // Serialize the publication point with content changes, without advancing content Revision.
   await repository.transactOperational(async state=>{
    checkDeliverySignal(input.signal)
    if(state.project.currentRevision!==snapshot.revision)fail('delivery_stale_revision','项目在导出期间变化，已停止发布。')
    await mkdir(final);claimed=true
    await rename(stage,join(final,'report'));published=true
    return state
   })
   return {directory:join(final,'report'),deliveryId:id,revision:snapshot.revision,projectId:snapshot.projectId,pageCount:snapshot.pages.length,mode:manifest.mode,editableObjects:false,files,manifest}
  }catch(error){if(claimed&&!published)await rm(final,{recursive:true,force:true});throw error}
  finally{if(!published)await rm(stage,{recursive:true,force:true})}
 }})
}
