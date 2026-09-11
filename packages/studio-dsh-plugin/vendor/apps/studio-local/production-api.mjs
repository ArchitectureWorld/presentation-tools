import {assertDesignHostRequest} from './host-request.mjs'
import {readFile,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status})}
export function batchPrompt(sessionId,batchId){return {kind:'report_studio.design',sessionId,text:[
 '[Pre-design 自动汇报任务 · Presentation 工具]',`batchId: ${batchId}`,
 '调用 studio_next_design_batch 继续同一任务，不创建新授权或重置预算。',
 'action=design：读取页context，按Pre设计方法产出结构化DesignIntent和候选；使用返回的idempotencyKey。',
 'action=render或critique：调用studio_render_layout_preview查看真实候选图片（已有相同有效预览自动复用），检查通过后studio_submit_layout_review直接保存。',
 '每次工具完成后再次调用studio_next_design_batch。机械检查失败交由Pre改版，最多3次候选；不要缩小字号或伪造证据。',
 '无法处理当前页时studio_report_design_exception并继续其他页；action=done只按已验证统计汇总，锁定或异常页不得声称完成。',
 'DSH是唯一模型与调度宿主，未加载Pre时明确缺口。任务中断后用原batchId恢复。不要每页要求人工审批。',
].join('\n')}}
export async function executeProductionApi({runtime,sessionId,operation,request,body={}}){
 const allowed={status:['batchId'],resume:['batchId'],cancel:['batchId'],retry:['batchId','pageId'],export:['formats']}[operation]
 if(!allowed||!body||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))fail('production_invalid_input','自动生产参数包含未知字段。')
 if(operation==='status'){if(request.method!=='GET')fail('production_method_not_allowed','状态读取仅支持GET。',405)}else assertDesignHostRequest(request)
 if(operation==='export')return (await runtime.deliveryFor(sessionId)).export(body)
 const batches=await runtime.batchFor(sessionId),input={...body,sessionId}
 if(operation==='cancel')return {batch:await batches.cancel(input)}
 const batch=await (operation==='retry'?batches.retry(input):batches.status(input))
 return {batch,...(['resume','retry'].includes(operation)&&batch.action!=='done'?{dshPrompt:batchPrompt(sessionId,body.batchId)}:{})}
}
export async function readDeliveryFile({repository,deliveryId,name}){
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(deliveryId??'')||!['report.html','report.pdf','report.pptx','manifest.json','source.json'].includes(name))fail('delivery_invalid_input','交付文件标识无效。')
 const directory=join(repository.root,'deliveries',deliveryId,'report'),file=join(directory,name)
 // Local storage is private; never follow a replaced export directory or file symlink.
 for(const part of [join(repository.root,'deliveries'),join(repository.root,'deliveries',deliveryId),directory,join(directory,'manifest.json'),file])if((await lstat(part)).isSymbolicLink())fail('delivery_invalid_input','交付路径不可为符号链接。')
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')),bytes=await readFile(file)
 if(name!=='manifest.json'){const entry=manifest.files.find(f=>f.name===name);if(!entry||entry.sha256!==createHash('sha256').update(bytes).digest('hex'))fail('delivery_corrupt','交付文件已损坏。',409)}
 const mimeType={'report.html':'text/html; charset=utf-8','report.pdf':'application/pdf','report.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','source.json':'application/json','manifest.json':'application/json'}[name]
 return {bytes,mimeType,name}
}
