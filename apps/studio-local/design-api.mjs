import {assertDesignHostRequest} from './host-request.mjs'
import {batchPrompt} from './production-api.mjs'
function fail(message,status=403) {throw Object.assign(new Error(message),{code:'design_scope_denied',status})}
export async function readDesignImage({runtime,sessionId,proposalId,candidateId}){
 const repository=await runtime.repositoryFor(sessionId);const state=repository.getState()
 const row=proposalId?state.proposals.find(item=>item.id===proposalId):state.layoutCandidates.find(item=>item.candidateId===candidateId)
 if(!row||row.sessionId!==sessionId||row.projectId!==state.project.projectId)fail('图像不属于当前会话。')
 const ref=row.kind==='design.visual.v1'?row.objectRef:row.preview?.objectRef
 if(!ref||!['image/png','image/jpeg'].includes(ref.mimeType))fail('候选尚无真实图像预览。',404)
 const bytes=Buffer.concat(await Array.fromAsync(await repository.openBlob(ref)))
 return {bytes,mimeType:ref.mimeType}
}
export {assertDesignHostRequest} from './host-request.mjs'
export async function executeDesignApi({runtime,sessionId,operation,request,body={}}) {
  const keys={start:['pageIds','protectedPageIds','allowApply','allowVisualGeneration','instruction'],context:['pageId'],progress:['runId'],accept:['proposalId']}[operation]
  if(!keys)fail('设计 API 不存在。',404)
  if(!body||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))fail('设计参数含未知字段。',400)
  if(['start','accept'].includes(operation))assertDesignHostRequest(request)
  else if(request.method!=='GET')fail('设计读取仅支持 GET。',405)
  const service=await runtime.designFor(sessionId)
  if(operation==='context')return service.context({sessionId,pageId:body.pageId})
  if(operation==='progress')return runtime.designProgress ? runtime.designProgress(sessionId,body.runId) : service.progress({sessionId,runId:body.runId})
  if(operation==='accept')return runtime.acceptDesignProposal ? runtime.acceptDesignProposal(sessionId,body.proposalId) : service.accept({sessionId,proposalId:body.proposalId})
  if(typeof body.instruction!=='string'||!body.instruction.trim()||body.instruction.length>8000)fail('请填写设计要求。',400)
  if(body.allowApply===false)fail('旧客户端只读意图不能升级为直接修改，请刷新界面后重新提交。',409)
  const run=await service.start({sessionId,pageIds:body.pageIds,protectedPageIds:body.protectedPageIds??[],allowApply:true,executionMode:'direct',allowVisualGeneration:body.allowVisualGeneration??false,expiresAt:new Date(Date.now()+2*60*60*1000).toISOString()})
  const batch=runtime.batchFor?await (await runtime.batchFor(sessionId)).begin({sessionId,runId:run.runId,idempotencyKey:`host:${run.runId}`}):null
  return {run,...(batch?{batch}:{}),dshPrompt:{kind:'report_studio.design',sessionId,text:[
    '[Pre-design 报告修改任务 · Presentation 工具]',`runId: ${run.runId}`,`页面范围: ${JSON.stringify(run.pageIds)}`,`保护页: ${JSON.stringify(run.protectedPageIds)}`,
    '由 Pre-design 的报告 Skill 理解要求并选择版式；Presentation 只负责读取、修改、渲染、机械检查和保存。',
    ...(batch?[batchPrompt(sessionId,batch.batchId).text]:[]),
    '先通过 studio_get_context(scope=design,pageId) 或 studio_get_layout_context 读取当前来源、素材、版本和工具约束。',
    '本次用户指令已授予范围内直接修改权限；通过检查后直接保存，不再提交给用户接受 Proposal。工具返回的内部记录 ID 仅用于重试和追踪。',
    '补图工具为 studio_generate_design_visual、studio_adopt_design_visual 和 studio_resume_design_visual。生成权限独立；挂接失败后按原 runId、pageId、sourceStateHash、requestId 续接，不得重新生成。',
    '只使用当前 DSH 会话与模型；未加载 Pre 时不能宣称已执行 Pre Skill。不得绕过保护范围、版本校验或真实预览。',`用户要求：${body.instruction}`].join('\n')}}
}
