import { createLayoutPreviewRenderer } from '../vendor/apps/studio-local/layout-preview.mjs'
import { projectAssetCatalog } from '../vendor/apps/studio-local/asset-service.mjs'
// DSH 0.1.x accepts a deliberately small JSON Schema subset at tool registration.
// Runtime handlers keep the stronger semantic validation from the Studio contracts.
const string = { type: 'string' }
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
export function designSessionId(exec) {
  const id = exec?.agent?.id
  if (typeof id !== 'string' || !id.trim() || !exec.agent.session || String(exec.agent.session.id) !== id) throw new Error('设计工具必须在有效 DSH Agent Session 中调用。')
  return id
}
export async function requireImageModel(ctx, exec) {
  designSessionId(exec)
  const routed = exec.agent.session.requestHeader?.()?.config
  const provider = routed?.provider ?? exec.agent.options?.provider
  const model = routed?.model ?? exec.agent.options?.model
  const llm = ctx.get('llm')
  if (!provider || !model || !llm) throw new Error('当前 Session 模型路由无法解析，不能执行图像验收。')
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (!active?.inputModalities?.includes('image')) throw new Error(`当前模型 ${model} 未声明 image 输入，不能执行视觉验收。`)
  const attachments = ctx.get('attachments')
  if (!attachments?.saveImage) throw new Error('图像附件存储不可用。')
  return attachments
}
const imageSchema = { type:'object', properties:{attachmentId:string,mediaType:string,bytes:{type:'integer'},width:{type:'integer'},height:{type:'integer'},name:{type:'string'},originalDimensions:{type:'object'}},required:['attachmentId','mediaType','bytes','width','height'],additionalProperties:false }
export function registerDesignTools(ctx, { runtime, renderer = createLayoutPreviewRenderer() }) {
  const register = (name,description,parameters,execute,output = {schema:{},render:(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}]}) => ctx.tools.register({name,description,parameters,output,async execute(args,exec) {
    const sessionId = designSessionId(exec)
    if (!args || Object.keys(args).some(key=>!Object.hasOwn(parameters.properties,key))) throw new Error('设计工具参数包含未知字段；权限只能由宿主授予。')
    try { const result=await execute(args,exec,sessionId);await runtime.recordDesignFailure?.(sessionId,args,null);return result }
    catch(error){await runtime.recordDesignFailure?.(sessionId,args,error).catch(()=>undefined);throw error}
  }})
  register('studio_begin_design_batch','为已有宿主直接修改授权创建或读取批量任务；不产生新权限。',object({runId:string,idempotencyKey:string}),async(args,_exec,sessionId)=>(await runtime.batchFor(sessionId)).begin({...args,sessionId}))
  register('studio_next_design_batch','读取原任务下一动作与真实完成证据。design→生成候选；render→真实预览；critique→查看原预览后提交观察；done→汇总异常。不用人工逐页批准。',object({batchId:string}),async(args,_exec,sessionId)=>(await runtime.batchFor(sessionId)).next({...args,sessionId}))
  register('studio_report_design_exception','记录当前页无法自动处理的原因并继续其他页；不能伪造完成或重置重试预算。',object({batchId:string,pageId:string,reason:string}),async(args,_exec,sessionId)=>(await runtime.batchFor(sessionId)).exception({...args,sessionId}))
  register('studio_export_delivery','从当前无阻断已保存预览导出HTML/PDF/图像式PPTX和Studio源JSON；非对象可编辑PPTX。未通过或过期页面阻止导出。',object({formats:{type:'array',items:{type:'string',enum:['html','pdf','pptx']}}}),async(args,exec,sessionId)=>(await runtime.deliveryFor(sessionId)).export({...args,signal:exec.signal}))
  register('studio_get_layout_context','读取当前页真实来源、讲稿、素材、布局结构与设计规则；无写入。',object({pageId:string}),async(args,_exec,sessionId)=>(await runtime.designFor(sessionId)).context({sessionId,...args}))
  register('studio_read_design_image','查看当前页已保存布局，或当前项目已登记素材的真实图像；不支持图像预览的素材会明确报缺口。', {...object({pageId:string,assetId:string}),required:['pageId']},async(args,exec,sessionId)=>{
    const attachments=await requireImageModel(ctx,exec)
    const repository=await runtime.repositoryFor(sessionId)
    const service=await runtime.designFor(sessionId)
    await service.context({sessionId,pageId:args.pageId})
    const read=async ref=>Buffer.concat(await Array.fromAsync(await repository.openBlob(ref)))
    let data,mediaType,metadata
    if(args.assetId){
      const asset=projectAssetCatalog(repository.getState()).find(row=>row.id===args.assetId)
      if(!asset?.objectRef||!['image/png','image/jpeg'].includes(asset.objectRef.mimeType))throw new Error('该素材未登记或没有可用图像预览；保留原引用并记录缺口。')
      data=await read(asset.objectRef);mediaType=asset.objectRef.mimeType;metadata={assetId:asset.id}
    }else{
      const rendered=await renderer.render({...await service.currentPreview({pageId:args.pageId}),signal:exec.signal,readAsset:read})
      data=rendered.png;mediaType='image/png';metadata={pageId:args.pageId,checks:rendered.checks}
    }
    return {image:await attachments.saveImage({data,mediaType,name:'report-design-image'}),metadata}
  },{schema:{type:'object',properties:{image:imageSchema,metadata:{type:'object'}},required:['image','metadata'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value.metadata)},{type:'image',attachment:value.image}]})
  register('studio_prepare_layout_candidate','按授权 runId 创建不可变布局候选。先读 context；sourceMapping 是 element ID 到 sourceProjection key 数组；无权限字段。',object({runId:string,pageId:string,baseProjectRevision:{type:'integer'},baseLayoutRevision:{type:['integer','null']},baseLayoutSha:{type:['string','null']},sourceStateHash:string,layout:{type:'object'},sourceMapping:{type:'object',additionalProperties:{type:'array',items:string}},designIntent:{type:['string','object'],description:'Prefer structured designIntentSchema from context; legacy strings are supported.'},idempotencyKey:string}),async(args,_exec,sessionId)=>(await runtime.designFor(sessionId)).prepare({...args,sessionId}))
  register('studio_render_layout_preview','真实渲染冻结候选并返回原生图像附件、自动检查及预览指纹。必须查看图像后提交观察。',object({candidateId:string,candidateSha:string}),async(args,exec,sessionId)=>{
    const attachments = await requireImageModel(ctx,exec)
    const service = await runtime.designFor(sessionId)
    const repository = await runtime.repositoryFor(sessionId)
    const cached=await service.readPreview({...args,sessionId})
    if(cached){
      const data=Buffer.concat(await Array.fromAsync(await repository.openBlob(cached.objectRef)))
      const image=await attachments.saveImage({data,mediaType:'image/png',name:`${args.candidateId}.png`})
      return {image,preview:cached,reused:true}
    }
    const input = await service.previewInput({...args,sessionId})
    const rendered = await renderer.render({...input,candidateSha:args.candidateSha,signal:exec.signal,readAsset:async ref=>Buffer.concat(await Array.fromAsync(await repository.openBlob(ref)))})
    const image = await attachments.saveImage({data:rendered.png,mediaType:'image/png',name:`${args.candidateId}.png`})
    const preview = await service.recordPreview({...args,sessionId,preview:rendered})
    return {image,preview,reused:false}
  },{schema:{type:'object',properties:{image:imageSchema,preview:{type:'object'},reused:{type:'boolean'}},required:['image','preview'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify({preview:value.preview},null,2)},{type:'image',attachment:value.image}]})
  register('studio_submit_layout_review','提交看过真实预览后的观察；机械检查通过且宿主已有直接修改授权时立即保存，不再要求逐页批准。',object({candidateId:string,candidateSha:string,previewFingerprint:string,observations:string}),async(args,exec,sessionId)=>{
    await requireImageModel(ctx,exec)
    const proposal=await (await runtime.designFor(sessionId)).submitReview({...args,sessionId})
    const candidate=(await runtime.repositoryFor(sessionId)).getState().layoutCandidates.find(row=>row.candidateId===args.candidateId)
    return {...proposal,validation:structuredClone(candidate.validation)}
  })
  register('studio_generate_design_visual','在宿主允许补图的 run 内请求 Pre 当前页概念视觉；返回真实图像与内部操作记录，当前直接任务可继续挂接，无二次确认步骤。', {...object({runId:string,pageId:string,sourceStateHash:string,requestId:string,prompt:string,style:string}),required:['runId','pageId','sourceStateHash','requestId','prompt']},async(args,exec,sessionId)=>{
    const attachments=await requireImageModel(ctx,exec)
    const result=await runtime.visualFor().generate(exec.agent,args,exec.signal)
    const repository=await runtime.repositoryFor(sessionId)
    const image=await attachments.saveImage({data:Buffer.concat(await Array.fromAsync(await repository.openBlob(result.proposal.objectRef))),mediaType:result.proposal.objectRef.mimeType,name:'页面补充视觉'})
    return {...result,image}
  },{schema:{type:'object',properties:{proposal:{type:'object'},image:imageSchema},required:['proposal','image'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value.proposal)},{type:'image',attachment:value.image}]})
  register('studio_adopt_design_visual','把本次直接任务中已生成并看过的准确视觉记录挂接到当前页；保留版本、范围与来源校验。',object({proposalId:string}),async(args,exec)=>{await requireImageModel(ctx,exec);return runtime.visualFor().adopt(exec.agent,args,exec.signal)})
  register('studio_resume_design_visual','按原 run、页面、来源哈希和 requestId 续接已生成但未完成挂接的视觉；不重新生成，也不增加审批步骤。',object({runId:string,pageId:string,sourceStateHash:string,requestId:string}),async(args,exec)=>{await requireImageModel(ctx,exec);return runtime.visualFor().resume(exec.agent,args,exec.signal)})
  const strings={type:'array',items:string}
  const command=(type,properties,required=Object.keys(properties))=>({...object({type:{const:type},...properties}),required:['type',...required]})
  register('studio_prepare_design_content','在明确设计授权内整理内容、保留来源/讲稿、关联已登记素材或记录每页判断与展示/讲稿/缺口。合并拆分产生的已授权后代页面沿用当前直接任务范围，保护范围仍不可绕过。',object({runId:string,baseRevision:{type:'integer'},idempotencyKey:string,message:string,commands:{type:'array',items:{oneOf:[
    command('pages.merge',{pageIds:strings,title:string},['pageIds']),
    command('page.split',{pageId:string,parts:{type:'array',items:object({title:string,contentBlockIds:strings})}}),
    command('page.asset.link',{pageId:string,assetId:string,role:{enum:['primary','supporting','background','reference']}},['pageId','assetId']),
    command('page.design.plan',{pageId:string,mainJudgment:string,displayedContentIds:strings,scriptOrAppendixContentIds:strings,pendingGaps:{type:'array',items:{...object({reason:string,contentIds:strings,sourceRefKeys:strings}),required:['reason']}},sourceRefKeys:strings},['pageId','mainJudgment','displayedContentIds','scriptOrAppendixContentIds','pendingGaps']),
  ]}}}),async(args,_exec,sessionId)=>(await runtime.contentFor(sessionId)).prepare({...args,sessionId}))
}
