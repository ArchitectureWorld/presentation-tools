import {projectRuleDependencies} from './source-dependencies.mjs'
import { canonicalFromState } from '../../packages/studio-contracts/index.mjs'
import { buildLayoutSourceProjection } from '../../packages/studio-layout-integration/index.mjs'
import { sourceRefKey } from '../../packages/studio-layout-contracts/index.mjs'
const clone=value=>structuredClone(value)
const canonical=value=>JSON.stringify(value,(key,value)=>value&&Object.getPrototypeOf(value)===Object.prototype?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value)
const fail=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status})}
export function protectionFor(state,pageId){return clone((state.designProtections??[]).find(r=>r.pageId===pageId)??{pageId,revision:0,pageLocked:false,elements:[]})}
function meaningful(element){if(!element)return null;const {lastSyncedSourceRevision,...rest}=element;return rest}
export function assertProtectedLayout(state,pageId,before,after){
 const protection=protectionFor(state,pageId)
 if(protection.pageLocked && canonical(before)!==canonical(after))fail('design_protected','页面已由人工锁定。',423)
 for(const lock of protection.elements){
  const a=before?.elements.find(e=>e.layoutElementId===lock.layoutElementId),b=after?.elements.find(e=>e.layoutElementId===lock.layoutElementId)
  if(!a||!b||canonical(meaningful(a))!==canonical(meaningful(b)))fail('design_protected','人工锁定的元素不可被自动修改或删除。',423)
 }
}
function sources(state,pageId){
 const snapshot=canonicalFromState(state),page=snapshot.pages.find(p=>p.id===pageId||p.pageId===pageId)
 if(!page)return null
 return buildLayoutSourceProjection({snapshot,pageId,projectRevision:state.project.currentRevision,sourceStateHash:null,resolvedPageAssets:page.pageAssets??[]}).sources
}
/** Called inside the Repository content CAS, covering design, ordinary Agent and upstream paths. */
export function assertProtectedContent(before,after,{human=false}={}){
 if(human)return
 const protections=(before.designProtections??[]).filter(p=>p.pageLocked||p.elements.length)
 if(!protections.length)return
 if(canonical(before.designProtections)!==canonical(after.designProtections))fail('design_protected','自动内容操作不得修改人工保护记录。',423)
 const a=canonicalFromState(before),b=canonicalFromState(after)
 if(canonical(projectRuleDependencies(a.project))!==canonical(projectRuleDependencies(b.project)))fail('design_protected','项目级规则变化影响已锁定内容，需要人工处理。',423)
 for(const p of protections){
  const pa=a.pages.find(r=>r.id===p.pageId),pb=b.pages.find(r=>r.id===p.pageId)
  if(!pa||!pb)fail('design_protected','自动操作不得移除已锁定页面。',423)
  if(p.pageLocked && canonical(pa)!==canonical(pb))fail('design_protected','自动操作不得改动已锁定页面内容。',423)
  const keys=[...new Set(p.elements.flatMap(e=>e.sourceKeys))]
  if(keys.length){const sa=sources(before,p.pageId),sb=sources(after,p.pageId)
   for(const key of keys)if(canonical(sa?.[key])!==canonical(sb?.[key]))fail('design_protected','自动源内容修改影响了已锁定元素。',423)
  }
 }
}
export function applyProtectionUpdate(state,input,layout){
 const keys=['pageId','baseRevision','expectedProtectionRevision','elementId','locked']
 if(!input||Object.keys(input).some(k=>!keys.includes(k))||typeof input.locked!=='boolean'||!Number.isSafeInteger(input.expectedProtectionRevision)||input.expectedProtectionRevision<0)fail('protection_invalid_input','保护设置输入无效。',400)
 if(state.project.currentRevision!==input.baseRevision)fail('protection_revision_conflict','项目版本已变化。')
 if(!state.pages.some(p=>p.id===input.pageId))fail('protection_target_missing','保护页面不存在。',404)
 const p=protectionFor(state,input.pageId)
 if(p.revision!==input.expectedProtectionRevision)fail('protection_revision_conflict','人工保护设置已变化。')
 const prior=canonical(p)
 if(input.elementId!==undefined){
  const element=layout?.elements.find(e=>e.layoutElementId===input.elementId)
  if(!element)fail('protection_target_missing','保护元素不存在。',404)
  p.elements=p.elements.filter(e=>e.layoutElementId!==input.elementId)
  if(input.locked)p.elements.push({layoutElementId:input.elementId,sourceKeys:element.syncPolicy==='live'?[sourceRefKey(element.sourceRef)]:[]})
  p.elements.sort((a,b)=>a.layoutElementId.localeCompare(b.layoutElementId))
 }else p.pageLocked=input.locked
 if(canonical(p)!==prior){p.revision++;p.updatedAt=new Date().toISOString();state.designProtections??=[];state.designProtections=state.designProtections.filter(r=>r.pageId!==p.pageId);state.designProtections.push(p)}
 return clone(p)
}
export function createDesignProtectionService({repository,layoutService}){
 return Object.freeze({
  get({pageId}){if(!repository.getState().pages.some(p=>p.id===pageId))fail('protection_target_missing','保护页面不存在。',404);return protectionFor(repository.getState(),pageId)},
  async update(input){const ctx=await layoutService.designContext({pageId:input.pageId});let result
   await repository.transactOperational(state=>{result=applyProtectionUpdate(state,input,ctx.layout);return state});return result
  },
 })
}
