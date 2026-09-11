import {createHash} from 'node:crypto'
import {Readable} from 'node:stream'
import {realpath} from 'node:fs/promises'
import {createStudioId} from '../../packages/studio-contracts/index.mjs'
import {imageDimensions,MAX_ASSET_BYTES} from './asset-service.mjs'
const protocol='pre-design.page-visual.v1'
const clone=value=>structuredClone(value)
const inputKey=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)))
function fail(message){throw Object.assign(new Error(message),{code:'design_visual_denied',status:403})}
function preSourceHash(value){
 if(typeof value!=='string'||!/^(?:sha256:)?[a-f0-9]{64}$/.test(value))fail('视觉来源哈希无效。')
 return value.replace(/^sha256:/,'')
}
function sessionOf(parent){if(!parent?.id||String(parent.session?.id)!==String(parent.id))fail('缺少有效 DSH Session。');return String(parent.id)}
export function createDesignVisualService({runtime,preplanning,workspaceFor=sessionId=>runtime.workspaceStatus(sessionId).then(row=>row.workspaceRoot)}) {
 let release
 const bridge=()=>{if(preplanning?.designVisualBridge?.protocol!==protocol)fail('Pre 当前页视觉桥不可用。');return preplanning.designVisualBridge}
 async function resolve(input){
  const sessionId=sessionOf(input.parent);const repository=await runtime.repositoryFor(sessionId)
  const design=await runtime.designFor(sessionId);const grant=await design.inspectGrant({sessionId,runId:input.runId,pageId:input.pageId})
  const state=repository.getState();const page=state.pages.find(row=>row.id===input.pageId)
  if(input.studioProjectId!==state.project.projectId||preSourceHash(input.sourceStateHash)!==preSourceHash(grant.sourceStateHash))fail('视觉目标来源已经变化。')
  const preId=preplanning.repository.readContext(sessionId).project.projectId
  const binding=preplanning.standardProjects.findByPreDesignProjectId(preId)
  const workspaceRoot=await workspaceFor(sessionId)
  if(!binding||binding.state!=='ready'||binding.presentationProjectId!==input.studioProjectId||await realpath(binding.workspaceRoot??binding.directoryRoot)!==await realpath(workspaceRoot))fail('Pre 项目绑定不匹配。')
  const sourceObjectIds=[...new Set(grant.sourceRefs.filter(ref=>ref.sourceProjectId===preId).flatMap(ref=>ref.objectIds))].sort()
  if(!sourceObjectIds.length)fail('当前页没有属于已绑定 Pre 项目的来源，需补齐映射。')
  let allowApply=grant.allowApply===true
  if(input.operation==='generate'&&!grant.allowVisualGeneration)fail('宿主未授权补图。')
  if(input.operation==='adopt'){
   const candidate=input.candidate
   const proposal=state.proposals.find(row=>row.kind==='design.visual.v1'&&row.sessionId===sessionId&&row.runId===input.runId&&row.pageId===input.pageId&&row.input.sourceStateHash===preSourceHash(input.sourceStateHash)&&row.input.requestId===candidate?.requestId&&row.preAssetId===candidate?.assetId)
   allowApply=Boolean(proposal&&(allowApply||['approved','accepted'].includes(proposal.status)))
   if(!allowApply)fail('该图像候选尚未获得用户批准或有效自动应用权限。')
  }
  return {preDesignProjectId:preId,studioProjectId:input.studioProjectId,pageId:input.pageId,workspaceRoot,studioProjectRevision:state.project.currentRevision,sourceStateHash:preSourceHash(grant.sourceStateHash),sourceObjectIds,title:page.heading||page.title||'汇报页面',keyMessage:page.body||page.heading||page.title||'页面概念表达',grant:{runId:grant.runId,sessionId,allowApply,allowVisualGeneration:grant.allowVisualGeneration,expiresAt:grant.expiresAt}}
 }
 async function proposalFor(sessionId,proposalId){const repository=await runtime.repositoryFor(sessionId);const proposal=repository.getState().proposals.find(row=>row.id===proposalId&&row.kind==='design.visual.v1'&&row.sessionId===sessionId);if(!proposal)fail('图像提案不属于当前 Session。');return {repository,proposal}}
 async function generate(parent,args,signal){
  const sessionId=sessionOf(parent);const repository=await runtime.repositoryFor(sessionId)
  const input={...clone(args),sourceStateHash:preSourceHash(args.sourceStateHash),studioProjectId:repository.getState().project.projectId}
  const authority=await resolve({...input,parent,operation:'generate'})
  const old=repository.getState().proposals.find(row=>row.kind==='design.visual.v1'&&row.runId===input.runId&&row.sessionId===sessionId&&row.input.requestId===input.requestId)
  if(old){if(inputKey(old.input)!==inputKey(input))fail('同一视觉请求不能修改参数。');return {proposal:clone(old)}}
  const result=await bridge().generate(parent,input,signal)
  await resolve({...input,parent,operation:'generate'})
  const currentGrant=await (await runtime.designFor(sessionId)).inspectGrant({sessionId,runId:input.runId,pageId:input.pageId})
  const sourceRefs=currentGrant.sourceRefs.filter(ref=>ref.sourceProjectId===authority.preDesignProjectId)
  const bytes=Buffer.from(result.image.bytes);const dimensions=imageDimensions(result.image.mimeType,bytes)
  if(!dimensions||bytes.length>MAX_ASSET_BYTES||createHash('sha256').update(bytes).digest('hex')!==result.image.sha256||dimensions.widthPx!==result.image.width||dimensions.heightPx!==result.image.height)fail('视觉结果不是可验证的 PNG/JPEG，无法登记。')
  if(result.requestId!==input.requestId||result.target.pageId!==input.pageId||result.target.studioProjectId!==input.studioProjectId||result.target.sourceStateHash!==input.sourceStateHash)fail('视觉结果目标不匹配。')
  const objectRef=await repository.putBlob(Readable.from([bytes]),{mimeType:result.image.mimeType,sha256:result.image.sha256,sizeBytes:bytes.length,originalFileName:`${result.assetId}.png`})
  const proposal={id:createStudioId('proposal'),kind:'design.visual.v1',status:repository.getState().designRuns.find(row=>row.runId===input.runId)?.executionMode==='direct'?'ready':'pending',sessionId,runId:input.runId,pageId:input.pageId,projectId:input.studioProjectId,baseRevision:authority.studioProjectRevision,input,preAssetId:result.assetId,preTaskId:result.taskId,sourceRefs:clone(sourceRefs),objectRef,dimensions,provenance:clone(result.provenance),scopeKey:`draft:${input.pageId}`,message:'图片已生成，等待挂接',aggregateRiskLevel:'structural_review_required',sourceAnnotationIds:[],affectedObjectIds:[input.pageId],hasDeletion:false,diff:{changes:[],before:[],after:[]},createdAt:new Date().toISOString()}
  await repository.transactOperational(state=>{if(state.project.currentRevision!==proposal.baseRevision)fail('视觉生成期间页面版本已变化。');if(state.proposals.some(row=>row.kind===proposal.kind&&row.runId===proposal.runId&&row.input.requestId===input.requestId))fail('视觉请求正在被另一调用保存。');state.proposals.push(proposal);return state})
  return {proposal:clone(proposal)}
 }
 async function accept({sessionId,proposalId}){
  const {repository,proposal}=await proposalFor(sessionId,proposalId)
  await (await runtime.designFor(sessionId)).inspectGrant({sessionId,runId:proposal.runId,pageId:proposal.pageId})
  await repository.transactOperational(state=>{const row=state.proposals.find(p=>p.id===proposalId);if(['approved','accepted'].includes(row.status))return state;if(row.status!=='pending'||state.project.currentRevision!==row.baseRevision)fail('图像提案版本已变化，不能批准。');row.status='approved';row.approvedAt=new Date().toISOString();return state})
  return {proposal:clone(repository.getState().proposals.find(row=>row.id===proposalId)),status:'approved',dshPrompt:{kind:'report_studio.design',sessionId,text:`用户已批准图像 Proposal ${proposalId}。调用 studio_adopt_design_visual({proposalId:"${proposalId}"}) 完成当页素材登记；不得采用其它候选。`}}
 }
 async function confirmLinkReceipt(parent,proposal,signal){
  const sessionId=sessionOf(parent);const repository=await runtime.repositoryFor(sessionId)
  const current=repository.getState().proposals.find(row=>row.id===proposal.id&&row.kind==='design.visual.v1'&&row.sessionId===sessionId)
  if(!current||current.status!=='accepted'||!current.linkReceipt)fail('图像挂接回执状态无效。')
  if(current.receiptStatus==='confirmed')return clone(current)
  try{
   const target=bridge()
   if(typeof target.confirmLinked!=='function')fail('Pre 当前页视觉桥尚不支持挂接回执。')
   const receipt=await target.confirmLinked(parent,{...current.input,assetId:current.preAssetId,linkReceipt:clone(current.linkReceipt)},signal)
   if(inputKey(receipt)!==inputKey(current.linkReceipt))fail('Pre 返回的挂接回执与 Studio 记录不一致。')
   await repository.transactOperational(state=>{const row=state.proposals.find(item=>item.id===current.id&&item.sessionId===sessionId);if(!row||row.status!=='accepted'||inputKey(row.linkReceipt)!==inputKey(current.linkReceipt))fail('图像挂接回执期间状态已变化。');row.receiptStatus='confirmed';row.receiptConfirmedAt=new Date().toISOString();row.message='图片已挂接，Pre 回执已确认';delete row.receiptLastError;return state})
  }catch(error){
   await repository.transactOperational(state=>{const row=state.proposals.find(item=>item.id===current.id&&item.sessionId===sessionId);if(row?.status==='accepted'&&inputKey(row.linkReceipt)===inputKey(current.linkReceipt)){row.receiptStatus='pending';row.message='图片已挂接，Pre 回执待重试';row.receiptLastError=String(error?.message??error).slice(0,2000)}return state}).catch(()=>undefined)
   throw error
  }
  return clone(repository.getState().proposals.find(row=>row.id===current.id))
 }
 async function adoptImpl(parent,{proposalId},signal){
  const sessionId=sessionOf(parent);const {repository,proposal}=await proposalFor(sessionId,proposalId)
  if(proposal.status==='accepted')return confirmLinkReceipt(parent,proposal,signal)
  const authority=await resolve({...proposal.input,parent,operation:'adopt',candidate:{requestId:proposal.input.requestId,assetId:proposal.preAssetId}})
  const direct=repository.getState().designRuns.find(row=>row.runId===proposal.runId)?.executionMode==='direct'
  if(!direct&&authority.studioProjectRevision!==proposal.baseRevision)fail('视觉提案版本已变化。')
  const applyBaseRevision=authority.studioProjectRevision
  const result=await bridge().adopt(parent,{...proposal.input,assetId:proposal.preAssetId},signal)
  if(result.assetId!==proposal.preAssetId||result.requestId!==proposal.input.requestId||result.image.sha256!==proposal.objectRef.sha256)fail('已采用视觉候选与批准对象不一致。')
  await resolve({...proposal.input,parent,operation:'adopt',candidate:{requestId:proposal.input.requestId,assetId:proposal.preAssetId}})
  await repository.verifyBlob(proposal.objectRef)
  await repository.transactContent({baseRevision:applyBaseRevision,source:'agent',detail:{proposalId,actionType:'design.visual.link'}},state=>{
   const row=state.proposals.find(p=>p.id===proposalId);const run=state.designRuns.find(r=>r.runId===row.runId);if(!run||Date.parse(run.expiresAt)<=Date.now()||run.status==='revoked'||!run.pageIds.includes(row.pageId)||run.protectedPageIds.includes(row.pageId)||(!run.allowApply&&row.status!=='approved'))fail('图像采用权限已失效。')
   const page=state.pages.find(p=>p.id===proposal.pageId);const asset={id:createStudioId('asset'),name:'概念示意',mimeType:proposal.objectRef.mimeType,objectRef:clone(proposal.objectRef),sha256:proposal.objectRef.sha256,sizeBytes:proposal.objectRef.sizeBytes,...proposal.dimensions}
   if(!proposal.sourceRefs?.length||!proposal.preTaskId)fail('视觉提案缺少冻结来源和生成关联，请重新登记候选。')
   const adoptedAt=new Date().toISOString();const pageAssetId=createStudioId('pageAsset')
   const linkReceipt={kind:'presentation-tools.page-visual-link.v1',runId:proposal.runId,studioProjectId:proposal.projectId,pageId:proposal.pageId,sourceStateHash:proposal.input.sourceStateHash,requestId:proposal.input.requestId,preAssetId:proposal.preAssetId,studioAssetId:asset.id,pageAssetId,projectRevision:applyBaseRevision+1,linkedAt:adoptedAt}
   const record={assetId:asset.id,displayName:asset.name,mediaType:'image',category:'image',semanticRole:'AI 概念示意（非现场实拍）',relativePath:`assets/images/${asset.id}${asset.mimeType==='image/jpeg'?'.jpg':'.png'}`,mimeType:asset.mimeType,sizeBytes:asset.sizeBytes,sha256:asset.sha256,metadata:clone(proposal.dimensions),adoptionStatus:'adopted',origin:{type:'generated_by_plugin',sourceMaterialIds:[],parentAssetIds:[],method:JSON.stringify({disclosure:'AI 概念示意（非现场实拍）',protocol,taskId:proposal.preTaskId,preAssetId:proposal.preAssetId,requestId:proposal.input.requestId,proposalId,linkReceipt,provenance:proposal.provenance}),sourceTool:{name:'pre-design.page-visual',version:'1'}},sourceRefs:clone(proposal.sourceRefs),createdAt:proposal.createdAt,adoptedAt,retiredAt:null}
   state.project.extensionPayload??={}
   const archive=state.project.extensionPayload.standardArchive??={documents:{},files:[]}
   archive.documents??={};archive.files??=[]
   const manifest=archive.documents['assets/manifest.json']??={$schema:'https://contracts.architecture.world/presentation-standard-project/0.1.0/asset-manifest.schema.json',documentType:'AssetManifest',standardVersion:'0.1.0',projectId:state.project.projectId,assets:[]}
   manifest.assets.push(record)
   archive.files.push({relativePath:record.relativePath,objectRef:clone(asset.objectRef),sizeBytes:asset.sizeBytes,mimeType:asset.mimeType,sha256:asset.sha256})
   page.assets=[...(page.assets??[]),asset];page.pageAssets=[...(page.pageAssets??[]),{...clone(asset),pageAssetId,assetId:asset.id,role:'supporting',caption:'',order:(page.pageAssets??[]).length,sourceRefs:clone(proposal.sourceRefs),extensionPayload:{standard:clone(record)},provenance:clone(proposal.provenance)}]
   row.status='accepted';row.acceptedAt=adoptedAt;row.linkedAssetId=asset.id;row.linkedPageAssetId=pageAssetId;row.linkReceipt=linkReceipt;row.receiptStatus='pending';row.message='图片已挂接，等待 Pre 回执';return state
  })
  return confirmLinkReceipt(parent,repository.getState().proposals.find(row=>row.id===proposalId),signal)
 }
 const activeAdoptions=new Map()
 function adopt(parent,input,signal){
  const sessionId=sessionOf(parent);const key=`${sessionId}:${input.proposalId}`
  if(activeAdoptions.has(key))return activeAdoptions.get(key)
  const pending=adoptImpl(parent,input,signal).catch(async error=>{
   const repository=await runtime.repositoryFor(sessionId)
   await repository.transactOperational(state=>{
    const row=state.proposals.find(item=>item.id===input.proposalId&&item.sessionId===sessionId)
    const run=state.designRuns.find(item=>item.runId===row?.runId)
    if(row&&run?.executionMode==='direct'&&row.status!=='accepted'){row.status='link_failed';row.lastError=String(error.message).slice(0,2000)}
    return state
   }).catch(()=>undefined)
   throw error
  }).finally(()=>activeAdoptions.delete(key))
  activeAdoptions.set(key,pending);return pending
 }
 async function resume(parent,args,signal){
  const sessionId=sessionOf(parent);const repository=await runtime.repositoryFor(sessionId)
  const sourceStateHash=preSourceHash(args?.sourceStateHash)
  if(!args||typeof args.runId!=='string'||!args.runId||typeof args.pageId!=='string'||!args.pageId||typeof args.requestId!=='string'||!args.requestId)fail('视觉续接参数无效。')
  const proposal=repository.getState().proposals.find(row=>row.kind==='design.visual.v1'&&row.sessionId===sessionId&&row.runId===args.runId&&row.pageId===args.pageId&&row.input?.requestId===args.requestId&&preSourceHash(row.input?.sourceStateHash)===sourceStateHash)
  if(!proposal)fail('未找到可续接的视觉记录；不得改用新 requestId 重复生成。')
  return adopt(parent,{proposalId:proposal.id},signal)
 }
 return {resolve,generate,adopt,resume,accept,bind(){if(!release)release=bridge().bindStudioResolver({protocol,resolve})},dispose(){release?.();release=undefined}}
}
