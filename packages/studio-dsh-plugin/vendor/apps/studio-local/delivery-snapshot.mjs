import { StudioError, canonicalFromState } from '../../packages/studio-contracts/index.mjs'
import { PREVIEW_CHECKS_VERSION, createPreviewFingerprint } from '../../packages/studio-layout-core/preview-fingerprint.mjs'
const fail=(code,message,details={})=>{throw new StudioError(code,message,details,409)}
export function checkDeliverySignal(signal){if(signal?.aborted)fail('delivery_cancelled','导出已取消。')}
/** Capture one canonical revision and independently verify its current source and persisted PNG evidence. */
export async function captureCheckedDelivery({repository,layoutService,signal,maxBytes=256*1024*1024,maxPages=100}) {
 checkDeliverySignal(signal)
 const state=repository.getState(),revision=state.project.currentRevision
 const ordered=[...(state.pages??[])].sort((a,b)=>a.order-b.order)
 if(!ordered.length||ordered.length>maxPages)fail('delivery_page_limit','导出需要1到100页已检查排版。')
 const pages=[],failures=[];let bytes=0
 for(const page of ordered){
  checkDeliverySignal(signal)
  try{
   const ctx=await layoutService.designContext({pageId:page.id})
   if(ctx.state.project.currentRevision!==revision)fail('delivery_stale_revision','检查期间项目已变化。')
   const layout=ctx.layout,ref=ctx.layoutRef
   const candidate=(state.layoutCandidates??[]).slice().reverse().find(c=>c.pageId===page.id&&c.status==='applied'&&c.candidateSha===ref?.sha256&&c.sourceStateHash===ctx.projection.sourceStateHash)
   const preview=candidate?.preview,inputs=preview?.fingerprintInputs
   if(!layout||!candidate||candidate.validation?.valid!==true||layout.sourceStateHash!==ctx.projection.sourceStateHash||!Array.isArray(preview?.checks?.blockers)||preview.checks.blockers.length)throw Object.assign(new Error('没有与当前来源匹配、无阻断的已应用预览。'),{code:'layout_preview_stale_or_missing'})
   if(inputs?.checksVersion!==PREVIEW_CHECKS_VERSION||inputs.candidateSha!==ref.sha256||inputs.sourceStateHash!==ctx.projection.sourceStateHash||inputs.sha256!==preview.objectRef?.sha256||preview.objectRef?.mimeType!=='image/png'||createPreviewFingerprint(inputs)!==preview.fingerprint)throw Object.assign(new Error('预览证据或检查版本不匹配。'),{code:'layout_preview_evidence_invalid'})
   for(const asset of ctx.pageAssets){checkDeliverySignal(signal);await repository.verifyBlob(asset.objectRef)}
   await repository.verifyBlob(preview.objectRef)
   const chunks=[]
   for await(const chunk of await repository.openBlob(preview.objectRef)){checkDeliverySignal(signal);bytes+=chunk.length;if(bytes>maxBytes)fail('delivery_size_limit','导出图像超过字节预算。');chunks.push(chunk)}
   const png=Buffer.concat(chunks),canvas=inputs.canvas
   if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==canvas?.width||png.readUInt32BE(20)!==canvas?.height)throw Object.assign(new Error('预览PNG尺寸无效。'),{code:'layout_preview_png_invalid'})
   pages.push({pageId:page.id,canvas,layout,layoutSha:ref.sha256,png,previewSha256:preview.objectRef.sha256,previewFingerprint:preview.fingerprint,sourceStateHash:ctx.projection.sourceStateHash,checks:preview.checks})
  }catch(error){if(['delivery_cancelled','delivery_size_limit','delivery_stale_revision'].includes(error.code))throw error;failures.push({pageId:page.id,code:error.code??'layout_read_failed',message:error.message})}
 }
 if(failures.length)fail('standard_export_layout_blocked','导出已阻止：页面必须有当前来源、当前质量检查版本的已保存PNG预览。',{pages:failures})
 if(repository.getState().project.currentRevision!==revision)fail('delivery_stale_revision','导出检查期间项目已变化。')
 const canvas=pages[0].canvas
 if(pages.some(p=>p.canvas.width!==canvas.width||p.canvas.height!==canvas.height))fail('delivery_canvas_mismatch','同一交付文件的画布尺寸必须相同。')
 return {projectId:state.project.projectId,revision,canonical:canonicalFromState(state),canvas,pages,bytes}
}
